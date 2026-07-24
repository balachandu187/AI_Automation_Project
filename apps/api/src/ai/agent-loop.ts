// ============================================================================
// FlowMind AI — Agent Execution Loop
// ============================================================================
// Full autonomous agent implementation: Plan → Act → Observe → Replan.
// Supports tool calling, memory, iteration limits, timeout, and output synthesis.

import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ToolDefinition,
  ToolCall,
} from "./providers/types.js";
import type { RoutingPolicy } from "./router.js";
import { ModelRouter } from "./router.js";
import type { ProviderId } from "./providers/adapter-factory.js";
import type { ToolRegistry, ToolExecutionContext, ToolResult } from "./tools.js";
import type { PromptTemplate } from "./prompts.js";
import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

/** Configuration for an agent execution */
export interface AgentConfig {
  /** Maximum iterations (default: 10) */
  maxIterations: number;
  /** Maximum execution time in ms (default: 5 minutes) */
  timeoutMs: number;
  /** Confidence threshold for auto-completion (0-1, default: 0.7) */
  confidenceThreshold: number;
  /** Tools the agent is allowed to use */
  toolAllowlist?: string[];
  /** System prompt template */
  systemPrompt?: PromptTemplate;
  /** User task prompt template */
  taskPrompt?: PromptTemplate;
  /** Variables to interpolate into prompts */
  promptVariables?: Record<string, unknown>;
  /** Approval gates: tool calls that require human approval */
  approvalGates?: ApprovalGate[];
  /** Model to use (default: auto-routed) */
  model?: string;
  /** Provider API keys */
  apiKeys?: Partial<Record<ProviderId, string>>;
  /** Routing policy override */
  routingPolicy?: Partial<RoutingPolicy>;
}

/** A single approval gate rule */
export interface ApprovalGate {
  /** Tool name to gate */
  toolName?: string;
  /** Action category to gate (e.g., "integration", "email") */
  actionType?: string;
  /** Condition: gate if this expression is truthy (uses agent state) */
  condition?: string;
}

/** The current state of the agent loop */
export interface AgentState {
  iteration: number;
  messages: ChatMessage[];
  toolResults: Map<string, ToolResult>;
  variables: Map<string, unknown>;
  status: "running" | "completed" | "failed" | "awaiting_approval" | "timeout";
  startedAt: Date;
}

/** Final result from an agent execution */
export interface AgentResult {
  output: string;
  status: AgentState["status"];
  iterations: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: ToolResult }[];
  totalTokens: { prompt: number; completion: number };
  confidence: number;
  costCents: number;
  durationMs: number;
  approvalRequests: ApprovalRequest[];
}

/** An approval request generated during execution */
export interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  timestamp: Date;
}

// ============================================================================
// Agent Executor
// ============================================================================

const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant executing a workflow automation task.
You have access to various tools to help complete the task. Follow this approach:

1. PLAN: Analyze the task and decide what needs to be done.
2. ACT: Use the appropriate tools to gather information or perform actions.
3. OBSERVE: Review the results of your actions.
4. REPLAN: Decide the next step based on what you've learned.

Guidelines:
- Be thorough but efficient. Don't over-engineer solutions.
- When you have enough information to answer, do so clearly and concisely.
- Include a confidence score (0.0-1.0) in your final response.
- If you're uncertain, request clarification instead of guessing.
- Never fabricate information or make up tool results.`;

export class AgentExecutor {
  private config: AgentConfig;
  private state: AgentState;
  private router: ModelRouter;
  private toolRegistry: ToolRegistry;
  private provider!: LLMProvider;
  private approvalRequests: ApprovalRequest[] = [];
  private tokenUsage = { prompt: 0, completion: 0 };
  private costCents = 0;

  constructor(
    toolRegistry: ToolRegistry,
    config: AgentConfig,
  ) {
    this.config = {
      maxIterations: 10,
      timeoutMs: 300_000,
      confidenceThreshold: 0.7,
      ...config,
    };
    this.toolRegistry = toolRegistry;
    this.router = new ModelRouter(config.routingPolicy, config.apiKeys);

    this.state = {
      iteration: 0,
      messages: [],
      toolResults: new Map(),
      variables: new Map(),
      status: "running",
      startedAt: new Date(),
    };
  }

  /**
   * Run the agent loop to completion.
   */
  async run(task: string, context?: ToolExecutionContext): Promise<AgentResult> {
    const startTime = Date.now();

    // Build system prompt
    const systemPrompt = this.buildSystemPrompt();
    this.state.messages.push({ role: "system", content: systemPrompt });

    // Add the user task
    this.state.messages.push({ role: "user", content: task });

    // Determine model and provider
    const modelId = this.config.model || this.router.selectModel("agent");
    try {
      const { resolveModelProvider } = await import("./providers/adapter-factory.js");
      const { provider } = resolveModelProvider(modelId, this.config.apiKeys);
      this.provider = provider;
    } catch {
      throw new FatalError(`Cannot resolve provider for model: ${modelId}`);
    }

    // Main agent loop
    const timeout = setTimeout(() => {
      this.state.status = "timeout";
    }, this.config.timeoutMs);

    try {
      while (this.shouldContinue()) {
        this.state.iteration++;

        // Get tool definitions (filtered by allowlist)
        const toolDefs = this.getAvailableTools();

        // Send to LLM
        const response = await this.provider.chat({
          model: modelId,
          messages: this.state.messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          temperature: 0.7,
        });

        // Track usage
        this.tokenUsage.prompt += response.usage.promptTokens;
        this.tokenUsage.completion += response.usage.completionTokens;

        const assistantMsg = response.message;

        // Add assistant message to state
        this.state.messages.push(assistantMsg);

        // Check for tool calls
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          await this.handleToolCalls(assistantMsg.toolCalls, context);

          // After tool execution, continue the loop
          continue;
        }

        // No tool calls — agent is done. Check confidence.
        const confidence = this.extractConfidence(assistantMsg.content || "");

        if (
          confidence >= this.config.confidenceThreshold ||
          this.state.iteration >= this.config.maxIterations
        ) {
          this.state.status = "completed";
          break;
        }

        // Low confidence but still within iterations — ask agent to be more specific
        this.state.messages.push({
          role: "user",
          content:
            "Your confidence is below the threshold. Please provide a more definitive answer or request clarification if truly uncertain.",
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    // Handle timeout
    if (this.state.status === "timeout") {
      return {
        output: "Agent execution timed out.",
        status: "timeout",
        iterations: this.state.iteration,
        toolCalls: this.getToolCallHistory(),
        totalTokens: this.tokenUsage,
        confidence: 0,
        costCents: this.costCents,
        durationMs: Date.now() - startTime,
        approvalRequests: this.approvalRequests,
      };
    }

    // Synthesize final output
    const lastAssistantMsg = [...this.state.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    const output = lastAssistantMsg?.content || "Task completed.";
    const confidence = this.extractConfidence(output);

    return {
      output,
      status: this.state.status,
      iterations: this.state.iteration,
      toolCalls: this.getToolCallHistory(),
      totalTokens: this.tokenUsage,
      confidence,
      costCents: this.costCents,
      durationMs: Date.now() - startTime,
      approvalRequests: this.approvalRequests,
    };
  }

  /**
   * Check if the loop should continue.
   */
  private shouldContinue(): boolean {
    if (this.state.status !== "running") return false;
    if (this.state.iteration >= this.config.maxIterations) return false;
    return true;
  }

  /**
   * Build the system prompt for the agent.
   */
  private buildSystemPrompt(): string {
    if (this.config.systemPrompt) {
      const { system, user } = this.renderPrompt(
        this.config.systemPrompt,
        this.config.promptVariables || {},
      );
      const taskPrompt = this.config.taskPrompt
        ? this.renderPrompt(this.config.taskPrompt, this.config.promptVariables || {})
        : { system: "", user: "" };

      return `${system}\n${taskPrompt.system}`.trim();
    }
    return DEFAULT_SYSTEM_PROMPT;
  }

  private renderPrompt(
    template: PromptTemplate,
    vars: Record<string, unknown>,
  ): { system: string; user: string } {
    const system = interpolateSimple(template.systemPrompt, vars);
    const user = interpolateSimple(template.userPrompt, vars);
    return { system, user };
  }

  /**
   * Get tools available to the agent (filtered by allowlist + approval gates).
   */
  private getAvailableTools(): ToolDefinition[] {
    const tools = this.toolRegistry.list();

    const filtered = this.config.toolAllowlist
      ? tools.filter((t) => this.config.toolAllowlist!.includes(t.name))
      : tools;

    return filtered.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Handle tool calls from an assistant message.
   */
  private async handleToolCalls(
    toolCalls: ToolCall[],
    context?: ToolExecutionContext,
  ): Promise<void> {
    for (const call of toolCalls) {
      // Check approval gates
      if (this.requiresApproval(call.function.name)) {
        this.approvalRequests.push({
          toolName: call.function.name,
          args: JSON.parse(call.function.arguments || "{}"),
          reason: `Tool "${call.function.name}" requires human approval`,
          timestamp: new Date(),
        });

        // Add tool result indicating approval is needed
        this.state.messages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({
            success: false,
            error: "This action requires human approval. An approval request has been submitted.",
          }),
        });
        continue;
      }

      // Execute the tool
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }

      const result = await this.toolRegistry.execute(call.function.name, args, context);

      // Add tool result to conversation
      this.state.messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result),
      });

      // Store result
      this.state.toolResults.set(call.function.name, result);
    }
  }

  /**
   * Check if a tool call requires human approval.
   */
  private requiresApproval(toolName: string): boolean {
    if (!this.config.approvalGates) return false;

    return this.config.approvalGates.some((gate) => {
      if (gate.toolName && gate.toolName === toolName) return true;
      if (gate.actionType) {
        const tool = this.toolRegistry.get(toolName);
        if (tool?.category === gate.actionType) return true;
      }
      return false;
    });
  }

  /**
   * Extract a confidence score from the assistant's output.
   * Looks for explicit confidence fields and falls back to heuristics.
   */
  private extractConfidence(content: string): number {
    // Try to extract explicit confidence from JSON-like output
    const confidenceMatch = content.match(/"confidence"\s*:\s*([0-9.]+)/i);
    if (confidenceMatch) {
      const score = parseFloat(confidenceMatch[1]!);
      return Math.max(0, Math.min(1, score));
    }

    // Try "confidence: X.X" pattern
    const textMatch = content.match(/confidence\s*[:=]\s*([0-9.]+)/i);
    if (textMatch) {
      const score = parseFloat(textMatch[1]!);
      return Math.max(0, Math.min(1, score));
    }

    // Heuristic: consider output length, presence of caveats
    let confidence = 0.7; // baseline

    // Longer outputs that don't hedge → higher confidence
    if (content.length > 200) confidence += 0.1;
    if (content.length > 500) confidence += 0.05;

    // Hedging language → lower confidence
    const hedgingPatterns = [
      /I('m|\s+am)?\s+not\s+sure/i,
      /I\s+think/i,
      /possibly/i,
      /might\s+be/i,
      /uncertain/i,
      /could\s+be/i,
    ];
    const hedgeCount = hedgingPatterns.filter((p) => p.test(content)).length;
    confidence -= hedgeCount * 0.1;

    // Empty output → very low confidence
    if (content.trim().length === 0) confidence = 0.1;

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Get the history of tool calls for reporting.
   */
  private getToolCallHistory(): AgentResult["toolCalls"] {
    const history: AgentResult["toolCalls"] = [];

    for (const msg of this.state.messages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const call of msg.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch { /* empty */ }

          const result = this.state.toolResults.get(call.function.name) || {
            success: false,
            error: "No result recorded",
          };

          history.push({
            name: call.function.name,
            args,
            result,
          });
        }
      }
    }

    return history;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function interpolateSimple(
  text: string,
  vars: Record<string, unknown>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (name in vars) {
      const value = vars[name];
      if (value === null || value === undefined) return `{{${name}}}`;
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    }
    return `{{${name}}}`;
  });
}
