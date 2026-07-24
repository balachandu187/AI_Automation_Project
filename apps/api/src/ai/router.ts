// ============================================================================
// FlowMind AI — Multi-Model Router
// ============================================================================
// Routes prompts to the best model based on task type, cost, latency, and
// capability requirements. Supports fallback chains and workspace-level
// routing policies.

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ModelInfo,
  ToolDefinition,
} from "./providers/types.js";
import { resolveModelProvider } from "./providers/adapter-factory.js";
import type { ProviderId } from "./providers/adapter-factory.js";
import { FatalError, RetryableError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

/** Task categories that influence routing decisions */
export type TaskType =
  | "classification"
  | "extraction"
  | "summarization"
  | "reasoning"
  | "agent"
  | "chat"
  | "vision"
  | "embeddings";

/** Routing policy per workspace */
export interface RoutingPolicy {
  /** "cost" → cheapest capable model, "quality" → most capable model, "balanced" → middle */
  optimization: "cost" | "quality" | "balanced";
  /** Preferred provider order (empty = auto) */
  preferredProviders: ProviderId[];
  /** Disallowed models */
  blockedModels: string[];
  /** Custom model mappings: taskType → model */
  modelOverrides: Partial<Record<TaskType, string>>;
  /** Fallback enabled */
  enableFallback: boolean;
  /** Max fallback attempts */
  maxFallbackAttempts: number;
}

/** Default routing policy */
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  optimization: "balanced",
  preferredProviders: [],
  blockedModels: [],
  modelOverrides: {},
  enableFallback: true,
  maxFallbackAttempts: 2,
};

/** Routing result with metadata */
export interface RoutingResult {
  response: ChatResponse;
  modelUsed: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackChain: string[];
  costEstimateCents: number;
}

// ============================================================================
// Model Selection
// ============================================================================

/**
 * Route a prompt to the appropriate model using the configured policy.
 */
export class ModelRouter {
  private policy: RoutingPolicy;
  private apiKeys: Partial<Record<ProviderId, string>>;

  constructor(
    policy: Partial<RoutingPolicy> = {},
    apiKeys: Partial<Record<ProviderId, string>> = {},
  ) {
    this.policy = { ...DEFAULT_ROUTING_POLICY, ...policy };
    this.apiKeys = apiKeys;
  }

  /**
   * Send a chat completion, automatically routing to the best model.
   */
  async chat(
    options: ChatOptions & { taskType?: TaskType },
  ): Promise<RoutingResult> {
    const taskType = options.taskType || inferTaskType(options);
    const primaryModel = this.selectModel(taskType, options);

    const modelChain = this.buildFallbackChain(primaryModel, taskType);

    return this.tryModelChain(modelChain, options);
  }

  /**
   * Stream a chat completion, automatically routing to the best model.
   */
  async streamChat(
    options: ChatOptions & { taskType?: TaskType },
  ): Promise<{ stream: AsyncIterable<import("./providers/types.js").ChatChunk>; routing: Omit<RoutingResult, "response"> }> {
    const taskType = options.taskType || inferTaskType(options);
    const primaryModel = this.selectModel(taskType, options);
    const modelChain = this.buildFallbackChain(primaryModel, taskType);

    const { provider } = resolveModelProvider(modelChain[0]!, this.apiKeys);

    // For streaming, we don't build fallback — streams are harder to retry
    const stream = provider.streamChat({
      ...options,
      model: modelChain[0]!,
    });

    return {
      stream,
      routing: {
        modelUsed: modelChain[0]!,
        provider: provider.provider,
        fallbackUsed: false,
        fallbackChain: modelChain,
        costEstimateCents: estimateCost(modelChain[0]!, provider),
      },
    };
  }

  /**
   * Select the best model for a given task + options.
   */
  selectModel(taskType: TaskType, options?: ChatOptions): string {
    // 1. Check workspace overrides
    if (this.policy.modelOverrides[taskType]) {
      const override = this.policy.modelOverrides[taskType]!;
      if (!this.policy.blockedModels.includes(override)) {
        return override;
      }
    }

    // 2. Determine capability requirements from options
    const needsVision = false; // Could inspect messages for image content
    const needsTools = options?.tools && options.tools.length > 0;
    const needsLongContext = false; // Could estimate from message lengths

    // 3. Choose model by task type
    let candidates: string[];

    switch (taskType) {
      case "classification":
      case "extraction":
        candidates = ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash"];
        break;
      case "summarization":
        candidates = ["claude-3-haiku-20240307", "gpt-4o-mini", "gemini-1.5-flash"];
        break;
      case "reasoning":
      case "agent":
        candidates = ["claude-3-5-sonnet-20241022", "gpt-4o", "gemini-1.5-pro"];
        break;
      case "chat":
        candidates = ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash"];
        break;
      case "vision":
        candidates = ["gpt-4o", "claude-3-5-sonnet-20241022", "gemini-1.5-pro"];
        break;
      case "embeddings":
        candidates = ["text-embedding-3-small", "text-embedding-004"];
        break;
      default:
        candidates = ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash"];
    }

    // 4. Filter out blocked models
    candidates = candidates.filter((m) => !this.policy.blockedModels.includes(m));

    // 5. Reorder by preferred providers
    if (this.policy.preferredProviders.length > 0) {
      candidates.sort((a, b) => {
        const aIdx = this.policy.preferredProviders.findIndex((p) =>
          modelMatchesProvider(a, p),
        );
        const bIdx = this.policy.preferredProviders.findIndex((p) =>
          modelMatchesProvider(b, p),
        );
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    // 6. Apply optimization bias
    if (this.policy.optimization === "cost") {
      candidates.sort((a, b) => compareModelCost(a, b));
    } else if (this.policy.optimization === "quality") {
      // More capable first (rough heuristic based on model names)
      candidates.sort((a, b) => compareModelQuality(a, b));
    }
    // "balanced" keeps default ordering

    if (candidates.length === 0) {
      throw new FatalError("No available models after filtering");
    }

    return candidates[0]!;
  }

  /**
   * Build the fallback chain starting from the primary model.
   */
  buildFallbackChain(primaryModel: string, taskType: TaskType): string[] {
    if (!this.policy.enableFallback) return [primaryModel];

    const chain: string[] = [primaryModel];
    const maxAttempts = this.policy.maxFallbackAttempts + 1; // primary + fallbacks

    // Same task-based candidates but exclude primary
    const allCandidates = this.getCandidatesForTask(taskType);
    for (const candidate of allCandidates) {
      if (chain.length >= maxAttempts) break;
      if (!chain.includes(candidate) && !this.policy.blockedModels.includes(candidate)) {
        chain.push(candidate);
      }
    }

    return chain;
  }

  private getCandidatesForTask(taskType: TaskType): string[] {
    switch (taskType) {
      case "classification":
      case "extraction":
        return ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash", "gpt-4o"];
      case "summarization":
        return ["claude-3-haiku-20240307", "gpt-4o-mini", "gemini-1.5-flash", "gpt-4o"];
      case "reasoning":
      case "agent":
        return [
          "claude-3-5-sonnet-20241022",
          "gpt-4o",
          "gemini-1.5-pro",
          "claude-3-opus-20240229",
          "gpt-4-turbo",
        ];
      case "chat":
        return ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash", "gpt-4o"];
      case "vision":
        return [
          "gpt-4o",
          "claude-3-5-sonnet-20241022",
          "gemini-1.5-pro",
          "gemini-2.0-flash",
        ];
      case "embeddings":
        return ["text-embedding-3-small", "text-embedding-004", "text-embedding-3-large"];
      default:
        return ["gpt-4o-mini", "claude-3-haiku-20240307", "gemini-2.0-flash"];
    }
  }

  /**
   * Try a chain of models until one succeeds.
   */
  private async tryModelChain(
    modelChain: string[],
    options: ChatOptions,
  ): Promise<RoutingResult> {
    let lastError: Error | null = null;
    const triedModels: string[] = [];

    for (let i = 0; i < modelChain.length; i++) {
      const modelId = modelChain[i]!;
      triedModels.push(modelId);

      try {
        const { provider, model } = resolveModelProvider(modelId, this.apiKeys);

        const response = await provider.chat({
          ...options,
          model,
        });

        return {
          response,
          modelUsed: modelId,
          provider: provider.provider,
          fallbackUsed: i > 0,
          fallbackChain: triedModels,
          costEstimateCents: estimateCost(modelId, provider, response.usage),
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only continue to next model if error is retryable
        if (err instanceof FatalError) {
          // If it's an auth error, no point trying more
          break;
        }

        // Continue to next model in chain
        console.warn(
          `[router] Model ${modelId} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    throw new FatalError(
      `All models in chain failed. Last error: ${lastError?.message}`,
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

function inferTaskType(options: ChatOptions): TaskType {
  if (options.tools && options.tools.length > 0) return "agent";
  if (options.responseFormat?.type === "json_object") return "extraction";
  return "chat";
}

function modelMatchesProvider(modelId: string, providerId: string): boolean {
  const lower = modelId.toLowerCase();
  switch (providerId) {
    case "openai": return lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-") || lower.startsWith("text-embedding-3");
    case "anthropic": return lower.startsWith("claude-");
    case "gemini": return lower.startsWith("gemini-") || lower === "text-embedding-004";
    default: return false;
  }
}

function compareModelCost(a: string, b: string): number {
  const costA = getApproxCost(a);
  const costB = getApproxCost(b);
  return costA - costB;
}

function compareModelQuality(a: string, b: string): number {
  // Rough quality heuristic: bigger models = higher quality
  const qualityScore = (m: string): number => {
    if (m.includes("opus")) return 100;
    if (m.includes("pro") || m.includes("sonnet")) return 80;
    if (m.includes("turbo")) return 70;
    if (m.includes("flash") || m.includes("mini") || m.includes("haiku")) return 40;
    if (m.includes("gpt-4o")) return 85;
    if (m.includes("gpt-4")) return 75;
    if (m.includes("gpt-3.5")) return 30;
    return 50;
  };
  return qualityScore(b) - qualityScore(a);
}

function getApproxCost(modelId: string): number {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus")) return 90;
  if (lower.includes("sonnet")) return 18;
  if (lower.includes("pro") && lower.includes("gemini")) return 6.25;
  if (lower.includes("gpt-4o") && !lower.includes("mini")) return 12.5;
  if (lower.includes("gpt-4-turbo")) return 40;
  if (lower.includes("gpt-4")) return 90;
  if (lower.includes("gpt-4o-mini")) return 0.75;
  if (lower.includes("haiku")) return 1.5;
  if (lower.includes("flash") && lower.includes("2.0")) return 0.5;
  if (lower.includes("flash") && lower.includes("1.5")) return 0.375;
  if (lower.includes("gpt-3.5")) return 2;
  return 10; // default estimate
}

function estimateCost(
  modelId: string,
  provider: LLMProvider,
  usage?: { promptTokens: number; completionTokens: number },
): number {
  const modelInfo = provider.modelList().find((m) => m.id === modelId);
  if (!modelInfo || !usage) return 0;

  const inputCost = (usage.promptTokens / 1_000_000) * modelInfo.costPerMillionInput;
  const outputCost = (usage.completionTokens / 1_000_000) * modelInfo.costPerMillionOutput;
  return Math.round((inputCost + outputCost) * 100); // in cents
}

// ============================================================================
// Usage Tracker
// ============================================================================

export interface UsageRecord {
  timestamp: Date;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  workspaceId?: string;
  workflowId?: string;
}

/**
 * In-memory usage tracker for the current process.
 * In production, this would write to the billing_usage table.
 */
export class UsageTracker {
  private records: UsageRecord[] = [];

  record(entry: UsageRecord): void {
    this.records.push(entry);
  }

  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costCents, 0);
  }

  getTotalTokens(): { prompt: number; completion: number } {
    return this.records.reduce(
      (acc, r) => ({
        prompt: acc.prompt + r.promptTokens,
        completion: acc.completion + r.completionTokens,
      }),
      { prompt: 0, completion: 0 },
    );
  }

  getRecords(limit?: number): UsageRecord[] {
    const sorted = [...this.records].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  clear(): void {
    this.records = [];
  }
}
