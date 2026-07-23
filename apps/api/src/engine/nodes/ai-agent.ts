// ============================================================================
// FlowMind Workflow Engine — AI Agent Node Handler (Stub)
// ============================================================================
// Placeholder handler for AI agent nodes.
// Will integrate with the AI Orchestrator when that module is built.

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { FatalError } from "../errors.js";
import { resolveConfig } from "../context.js";

export class AIAgentHandler implements NodeHandler {
  readonly type = "ai_agent" as const;

  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.model || typeof config.model !== "string") {
      errors.push("model is required (e.g., 'gpt-4o', 'claude-3.5-sonnet')");
    }

    if (!config.prompt || typeof config.prompt !== "string") {
      errors.push("prompt is required");
    }

    const validModes = ["single_call", "agent_loop", "router", "extract", "summarize"];
    if (config.mode && !validModes.includes(config.mode as string)) {
      errors.push(`mode must be one of: ${validModes.join(", ")}`);
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
    const prompt = config.prompt as string;
    const temperature = (config.temperature as number) ?? 0.7;
    const maxTokens = (config.maxTokens as number) ?? 1024;

    // TODO: When AI Orchestrator is built, replace this stub with real LLM calls.
    // For now, return a placeholder response so the DAG can proceed.

    console.log(
      `[ai-agent] Stub execution — model=${model}, mode=${mode}, ` +
      `prompt=${prompt.slice(0, 100)}..., temp=${temperature}, maxTokens=${maxTokens}`,
    );

    // Simulate a small async delay
    await new Promise((r) => setTimeout(r, 10));

    const output: Record<string, unknown> = {
      _stub: true,
      mode,
      model,
      content: `[AI Stub] This is a placeholder response for node "${node.label}". ` +
        `The AI Orchestrator module will process prompt: "${prompt.slice(0, 80)}..."`,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      confidence: null,
    };

    // For router/extract modes, add structured output fields
    if (mode === "router") {
      output.route = "default";
      output.confidence = 0.5;
    }
    if (mode === "extract") {
      output.extracted = {};
    }

    return {
      nodeId: node.id,
      status: "completed",
      output,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }
}
