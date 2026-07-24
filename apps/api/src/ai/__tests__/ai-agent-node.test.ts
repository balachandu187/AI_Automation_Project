// ============================================================================
// FlowMind Engine — AI Agent Node Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIAgentHandler, resetOrchestrator, setOrchestrator } from "../../engine/nodes/ai-agent.js";
import { createExecutionContext } from "../../engine/context.js";
import type { DAGNode, ExecutionContext } from "../../engine/types.js";
import {
  AIOrchestrator,
  PromptManager,
  ToolRegistry,
  createDefaultToolRegistry,
} from "../../ai/index.js";

// Mock the AI modules to avoid actual API calls
vi.mock("../../ai/index.js", async () => {
  const actual = await vi.importActual("../../ai/index.js");
  return {
    ...actual,
    createOrchestrator: vi.fn(),
  };
});

function createMockOrchestrator(): AIOrchestrator {
  const orchestrator = new AIOrchestrator();

  // Mock the complete method
  orchestrator.complete = vi.fn().mockResolvedValue({
    content: '{"answer": "Paris", "confidence": 0.95}',
    usage: { promptTokens: 10, completionTokens: 5 },
    model: "gpt-4o-mini",
  });

  // Mock the runAgent method
  orchestrator.runAgent = vi.fn().mockResolvedValue({
    output: "Agent task completed successfully.",
    status: "completed",
    iterations: 3,
    toolCalls: [
      {
        name: "http_request",
        args: { url: "https://example.com" },
        result: { success: true, data: "result" },
      },
    ],
    totalTokens: { prompt: 50, completion: 30 },
    confidence: 0.9,
    costCents: 5,
    durationMs: 1000,
    approvalRequests: [],
  });

  // Mock queryRAG
  orchestrator.queryRAG = vi.fn().mockResolvedValue({
    query: "test",
    answers: "RAG answer",
    chunks: [],
  });

  return orchestrator;
}

describe("AIAgentHandler", () => {
  let handler: AIAgentHandler;
  let context: ExecutionContext;

  beforeEach(() => {
    handler = new AIAgentHandler();
    context = createExecutionContext({
      executionId: "exec-1",
      workflowId: "wf-1",
      workspaceId: "ws-1",
      triggerType: "manual",
      triggerPayload: {},
    });

    const mockOrch = createMockOrchestrator();
    setOrchestrator(mockOrch);
  });

  afterEach(() => {
    resetOrchestrator();
  });

  describe("validation", () => {
    it("requires a model", () => {
      const result = handler.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("model"))).toBe(true);
    });

    it("requires prompt or task", () => {
      const result = handler.validate({ model: "gpt-4o" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("prompt"))).toBe(true);
    });

    it("validates maxIterations range", () => {
      const result = handler.validate({
        model: "gpt-4o",
        prompt: "test",
        maxIterations: 100,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("maxIterations"))).toBe(true);
    });

    it("validates mode", () => {
      const result = handler.validate({
        model: "gpt-4o",
        prompt: "test",
        mode: "invalid_mode",
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("mode"))).toBe(true);
    });

    it("passes validation for valid config", () => {
      const result = handler.validate({
        model: "gpt-4o",
        prompt: "Hello",
        mode: "single_call",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("execution", () => {
    it("executes a single_call mode", async () => {
      const node: DAGNode = {
        id: "node-1",
        type: "ai_agent",
        label: "Test AI",
        config: {
          model: "gpt-4o-mini",
          prompt: "What is the capital of France?",
          mode: "single_call",
        },
      };

      const result = await handler.execute(context, node);

      expect(result.status).toBe("completed");
      expect(result.output).toBeDefined();
      expect(result.output!._mode).toBe("single_call");
    });

    it("executes an agent_loop mode", async () => {
      const node: DAGNode = {
        id: "node-2",
        type: "ai_agent",
        label: "Agent Task",
        config: {
          model: "gpt-4o-mini",
          task: "Research and summarize",
          mode: "agent_loop",
          maxIterations: 5,
        },
      };

      const result = await handler.execute(context, node);

      expect(result.status).toBe("completed");
      expect(result.output!.output).toBeDefined();
      expect(result.output!.iterations).toBe(3);
    });

    it("executes a router mode", async () => {
      const node: DAGNode = {
        id: "node-3",
        type: "ai_agent",
        label: "Router",
        config: {
          model: "gpt-4o-mini",
          prompt: "I need help with my order",
          mode: "router",
          routes: "support, sales, billing",
        },
      };

      const result = await handler.execute(context, node);

      // The mock returns JSON, and the router should parse it
      expect(result.status).toBe("completed");
      expect(result.output!.route).toBeDefined();
    });

    it("executes an extract mode", async () => {
      const node: DAGNode = {
        id: "node-4",
        type: "ai_agent",
        label: "Extract",
        config: {
          model: "gpt-4o-mini",
          prompt: "John is 30 years old and lives in Paris",
          mode: "extract",
          outputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
              city: { type: "string" },
            },
          },
        },
      };

      const result = await handler.execute(context, node);

      expect(result.status).toBe("completed");
      expect(result.output!.extracted).toBeDefined();
    });

    it("executes a summarize mode", async () => {
      const node: DAGNode = {
        id: "node-5",
        type: "ai_agent",
        label: "Summarize",
        config: {
          model: "gpt-4o-mini",
          prompt: "Long text to summarize...",
          mode: "summarize",
        },
      };

      const result = await handler.execute(context, node);

      expect(result.status).toBe("completed");
      expect(result.output!.summary).toBeDefined();
    });

    it("includes confidence in output", async () => {
      const node: DAGNode = {
        id: "node-6",
        type: "ai_agent",
        label: "With confidence",
        config: {
          model: "gpt-4o-mini",
          prompt: "Test",
          mode: "single_call",
        },
      };

      const result = await handler.execute(context, node);

      expect(result.output!._confidence).toBeDefined();
      expect(typeof result.output!._confidence).toBe("number");
    });

    it("handles errors gracefully", async () => {
      // Create an orchestrator that throws
      const badOrch = new AIOrchestrator();
      badOrch.complete = vi.fn().mockRejectedValue(new Error("API Error"));
      setOrchestrator(badOrch);

      const node: DAGNode = {
        id: "node-7",
        type: "ai_agent",
        label: "Error test",
        config: {
          model: "gpt-4o-mini",
          prompt: "Test",
          mode: "single_call",
        },
      };

      const result = await handler.execute(context, node);

      expect(result.status).toBe("failed");
      expect(result.output!.error).toContain("API Error");
    });
  });
});
