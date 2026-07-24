// ============================================================================
// FlowMind Workflow Engine — AI Agent Node Handler
// ============================================================================
// Executes AI operations as workflow nodes. Wires the engine's execution
// context into the AI Orchestrator for LLM calls, agent loops, routing,
// extraction, and summarization.

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { FatalError } from "../errors.js";
import { resolveConfig } from "../context.js";
import {
  createOrchestrator,
  type AIOrchestrator,
  type AgentConfig,
  type OrchestratorConfig,
} from "../../ai/index.js";
import { createDefaultToolRegistry } from "../../ai/tools.js";
import { ConfidenceScorer } from "../../ai/confidence.js";

/** Cached orchestrator instance (reused across executions) */
let _orchestrator: AIOrchestrator | null = null;

function getOrchestrator(): AIOrchestrator {
  if (!_orchestrator) {
    _orchestrator = createOrchestrator({
      apiKeys: {
        openai: process.env.OPENAI_API_KEY,
        anthropic: process.env.ANTHROPIC_API_KEY,
        gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      },
    });

    // Register default tools
    const defaultTools = createDefaultToolRegistry();
    for (const tool of defaultTools.list()) {
      _orchestrator.tools.register(tool);
    }
  }
  return _orchestrator;
}

/** Reset the orchestrator (useful for testing with mocked providers) */
export function resetOrchestrator(): void {
  _orchestrator = null;
}

/** Inject a pre-configured orchestrator (for testing) */
export function setOrchestrator(o: AIOrchestrator): void {
  _orchestrator = o;
}

export class AIAgentHandler implements NodeHandler {
  readonly type = "ai_agent" as const;

  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.model || typeof config.model !== "string") {
      errors.push("model is required (e.g., 'gpt-4o', 'claude-3.5-sonnet')");
    }

    if (!config.prompt && !config.task) {
      errors.push("either 'prompt' or 'task' is required");
    }

    const validModes = [
      "single_call",
      "agent_loop",
      "router",
      "extract",
      "summarize",
    ];
    if (config.mode && !validModes.includes(config.mode as string)) {
      errors.push(`mode must be one of: ${validModes.join(", ")}`);
    }

    if (config.maxIterations !== undefined) {
      const maxIter = Number(config.maxIterations);
      if (isNaN(maxIter) || maxIter < 1 || maxIter > 50) {
        errors.push("maxIterations must be between 1 and 50");
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(
    context: ExecutionContext,
    node: DAGNode,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const config = resolveConfig(
      node.config as Record<string, unknown>,
      context,
    ) as Record<string, unknown>;

    const mode = (config.mode as string) || "single_call";
    const model = config.model as string;
    const prompt = (config.prompt as string) || (config.task as string) || "";
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 4096;
    const systemPrompt = config.systemPrompt as string | undefined;
    const outputSchema = config.outputSchema as Record<string, unknown> | undefined;

    const orchestrator = getOrchestrator();

    try {
      let output: Record<string, unknown>;

      switch (mode) {
        case "single_call":
          output = await this.executeSingleCall(
            orchestrator,
            model,
            prompt,
            systemPrompt,
            temperature,
            maxTokens,
            outputSchema,
          );
          break;

        case "agent_loop":
          output = await this.executeAgentLoop(
            orchestrator,
            model,
            prompt,
            systemPrompt,
            config,
          );
          break;

        case "router":
          output = await this.executeRoute(
            orchestrator,
            model,
            prompt,
            systemPrompt,
            temperature,
            config,
          );
          break;

        case "extract":
          output = await this.executeExtract(
            orchestrator,
            model,
            prompt,
            systemPrompt,
            temperature,
            outputSchema,
          );
          break;

        case "summarize":
          output = await this.executeSummarize(
            orchestrator,
            model,
            prompt,
            systemPrompt,
            temperature,
            maxTokens,
          );
          break;

        default:
          throw new FatalError(`Unknown AI mode: ${mode}`);
      }

      // Calculate confidence
      const scorer = new ConfidenceScorer({
        expectedSchema: outputSchema,
      });
      const confidence = scorer.assess(output, {
        expectedSchema: outputSchema,
      });

      return {
        nodeId: node.id,
        status: "completed",
        output: {
          ...output,
          _confidence: confidence.score,
          _confidenceAction: confidence.action,
          _model: model,
          _mode: mode,
        },
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      console.error(
        `[ai-agent] Execution failed for node "${node.label}": ${errorMessage}`,
      );

      return {
        nodeId: node.id,
        status: "failed",
        output: {
          error: errorMessage,
          _mode: mode,
          _model: model,
        },
        error: err instanceof Error ? err : new FatalError(errorMessage),
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    }
  }

  /**
   * Single LLM call: one prompt → one response.
   */
  private async executeSingleCall(
    orchestrator: AIOrchestrator,
    model: string,
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number,
    outputSchema?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await orchestrator.complete(prompt, {
      model,
      systemPrompt,
      temperature,
      maxTokens,
    });

    // Try to parse JSON if output schema is expected
    let parsed: unknown = result.content;
    if (outputSchema) {
      try {
        parsed = JSON.parse(result.content);
      } catch {
        // Not JSON — return as plain text
        parsed = { text: result.content };
      }
    }

    return {
      content: result.content,
      parsed,
      usage: result.usage,
      model: result.model,
    };
  }

  /**
   * Autonomous agent loop: plan → act → observe → replan.
   */
  private async executeAgentLoop(
    orchestrator: AIOrchestrator,
    model: string,
    prompt: string,
    systemPrompt?: string,
    config?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const agentConfig: Partial<AgentConfig> = {
      model,
      maxIterations: (config?.maxIterations as number) || 10,
      timeoutMs: (config?.timeoutMs as number) || 300_000,
      confidenceThreshold: (config?.confidenceThreshold as number) || 0.7,
    };

    if (systemPrompt) {
      agentConfig.systemPrompt = {
        id: `node-system-${Date.now()}`,
        name: "Node System Prompt",
        systemPrompt,
        userPrompt: "{{task}}",
        variables: [{ name: "task", type: "string", required: true }],
        tags: [],
      };
    }

    // Configure tool allowlist
    if (config?.tools) {
      agentConfig.toolAllowlist = (config.tools as string[]).map(String);
    }

    const result = await orchestrator.runAgent(prompt, agentConfig);

    return {
      output: result.output,
      iterations: result.iterations,
      toolCalls: result.toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.args,
        success: tc.result.success,
      })),
      confidence: result.confidence,
      usage: result.totalTokens,
      costCents: result.costCents,
      approvalRequests: result.approvalRequests.length,
    };
  }

  /**
   * AI Router: classify input → return route + confidence.
   */
  private async executeRoute(
    orchestrator: AIOrchestrator,
    model: string,
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    config?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const routes = (config?.routes as string) || "default";

    const routerPrompt = `Classify the following input into one of the available routes.

Available routes:
${routes}

Input:
${prompt}

Return a JSON object with "route" (the selected route name) and "confidence" (0-1).`;

    const result = await orchestrator.complete(routerPrompt, {
      model,
      systemPrompt: systemPrompt || "You are a routing assistant. Respond with JSON only.",
      temperature: temperature ?? 0.3,
      taskType: "classification",
    });

    let parsed: Record<string, unknown> = { route: "default", confidence: 0.5 };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      // Try to extract route and confidence from text
      const routeMatch = result.content.match(/"route"\s*:\s*"(\w+)"/);
      const confMatch = result.content.match(/"confidence"\s*:\s*([0-9.]+)/);
      if (routeMatch) parsed.route = routeMatch[1];
      if (confMatch) parsed.confidence = parseFloat(confMatch[1]);
    }

    return {
      route: parsed.route || "default",
      confidence: parsed.confidence ?? 0.5,
      raw: result.content,
      usage: result.usage,
    };
  }

  /**
   * AI Extract: extract structured data from unstructured text.
   */
  private async executeExtract(
    orchestrator: AIOrchestrator,
    model: string,
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    outputSchema?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const extractPrompt = `Extract structured information from the following text.

${outputSchema ? `Expected schema:\n${JSON.stringify(outputSchema, null, 2)}\n` : ""}

Text to extract from:
${prompt}

Return ONLY valid JSON matching the schema. Include a "confidence" field (0-1).`;

    const result = await orchestrator.complete(extractPrompt, {
      model,
      systemPrompt:
        systemPrompt ||
        "You are a precise data extraction assistant. Return ONLY valid JSON.",
      temperature: temperature ?? 0.1,
      taskType: "extraction",
    });

    let extracted: Record<string, unknown> = {};
    try {
      extracted = JSON.parse(result.content);
    } catch {
      // Try to find JSON in the response
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          extracted = JSON.parse(match[0]);
        } catch { /* fall through */ }
      }
      if (Object.keys(extracted).length === 0) {
        extracted = { raw: result.content };
      }
    }

    return {
      extracted,
      usage: result.usage,
    };
  }

  /**
   * AI Summarize: condense long text.
   */
  private async executeSummarize(
    orchestrator: AIOrchestrator,
    model: string,
    prompt: string,
    systemPrompt?: string,
    temperature?: number,
    maxTokens?: number,
  ): Promise<Record<string, unknown>> {
    const result = await orchestrator.complete(prompt, {
      model,
      systemPrompt:
        systemPrompt ||
        "You are a summarization assistant. Create a concise, accurate summary.",
      temperature: temperature ?? 0.3,
      maxTokens: maxTokens ?? 1024,
      taskType: "summarization",
    });

    return {
      summary: result.content,
      usage: result.usage,
    };
  }
}
