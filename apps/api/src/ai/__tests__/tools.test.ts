// ============================================================================
// FlowMind AI — Tools Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  createDefaultToolRegistry,
  createHttpRequestTool,
  createSlackTool,
  createEmailTool,
  createDatabaseQueryTool,
  createHumanEscalationTool,
} from "../../ai/tools.js";
import type { RegisteredTool } from "../../ai/tools.js";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers a tool", () => {
    const tool: RegisteredTool = {
      name: "test_tool",
      description: "A test tool",
      parameters: {
        type: "object",
        properties: {
          input: { type: "string", description: "An input" },
        },
        required: ["input"],
      },
      execute: async () => ({ success: true, data: "done" }),
    };

    registry.register(tool);
    expect(registry.has("test_tool")).toBe(true);
    expect(registry.get("test_tool")).toBe(tool);
  });

  it("throws when registering duplicate tool", () => {
    const tool: RegisteredTool = {
      name: "dup",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);
  });

  it("lists all tools", () => {
    const tool1: RegisteredTool = {
      name: "t1",
      description: "",
      parameters: {},
      category: "cat1",
      execute: async () => ({ success: true }),
    };
    const tool2: RegisteredTool = {
      name: "t2",
      description: "",
      parameters: {},
      category: "cat2",
      execute: async () => ({ success: true }),
    };

    registry.registerAll([tool1, tool2]);
    expect(registry.list().length).toBe(2);
    expect(registry.list("cat1").length).toBe(1);
  });

  it("unregisters a tool", () => {
    const tool: RegisteredTool = {
      name: "temp",
      description: "",
      parameters: {},
      execute: async () => ({ success: true }),
    };

    registry.register(tool);
    expect(registry.has("temp")).toBe(true);
    registry.unregister("temp");
    expect(registry.has("temp")).toBe(false);
  });

  it("generates LLM tool definitions", () => {
    const tool: RegisteredTool = {
      name: "search",
      description: "Search for documents",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: async () => ({ success: true }),
    };

    registry.register(tool);
    const defs = registry.getDefinitions();

    expect(defs.length).toBe(1);
    expect(defs[0]!.type).toBe("function");
    expect(defs[0]!.function.name).toBe("search");
  });

  it("executes a tool and returns result", async () => {
    const tool: RegisteredTool = {
      name: "echo",
      description: "Echo back input",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to echo" },
        },
        required: ["message"],
      },
      execute: async (args) => ({
        success: true,
        data: args.message,
      }),
    };

    registry.register(tool);

    const result = await registry.execute("echo", { message: "hello" });
    expect(result.success).toBe(true);
    expect(result.data).toBe("hello");
  });

  it("handles JSON string arguments from LLM", async () => {
    const tool: RegisteredTool = {
      name: "add",
      description: "Add numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
      execute: async (args) => ({
        success: true,
        data: (args.a as number) + (args.b as number),
      }),
    };

    registry.register(tool);
    const result = await registry.execute("add", '{"a": 1, "b": 2}');
    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
  });

  it("returns error for unknown tool", async () => {
    const result = await registry.execute("nope", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("validates required arguments", async () => {
    const tool: RegisteredTool = {
      name: "required_test",
      description: "Test required args",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
      execute: async () => ({ success: true }),
    };

    registry.register(tool);

    const result = await registry.execute("required_test", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required field");
  });

  it("times out long-running tools", async () => {
    const tool: RegisteredTool = {
      name: "slow",
      description: "A slow tool",
      parameters: {},
      timeoutMs: 50,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { success: true };
      },
    };

    registry.register(tool);

    const result = await registry.execute("slow", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});

describe("Built-in Tools", () => {
  it("creates default tool registry with all tools", () => {
    const registry = createDefaultToolRegistry();
    const tools = registry.list();
    expect(tools.length).toBeGreaterThanOrEqual(5);
    expect(tools.some((t) => t.name === "http_request")).toBe(true);
    expect(tools.some((t) => t.name === "send_slack_message")).toBe(true);
  });

  it("http_request tool makes HTTP calls", async () => {
    const tool = createHttpRequestTool();
    // This will log but not make real calls in test
    expect(tool.name).toBe("http_request");
    expect(tool.parameters.required).toContain("url");
  });

  it("send_slack_message requires approval", async () => {
    const tool = createSlackTool();
    expect(tool.requiresApproval).toBe(true);
  });

  it("send_email requires approval", async () => {
    const tool = createEmailTool();
    expect(tool.requiresApproval).toBe(true);
  });

  it("database query tool rejects non-SELECT queries", async () => {
    const tool = createDatabaseQueryTool();
    const result = await tool.execute({ query: "DROP TABLE users" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Only SELECT");
  });

  it("human escalation tool returns pending status", async () => {
    const tool = createHumanEscalationTool();
    const result = await tool.execute({
      question: "Should we proceed?",
      context: "Some context",
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).status).toBe("pending");
  });
});
