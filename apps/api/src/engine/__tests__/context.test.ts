// ============================================================================
// FlowMind Engine Tests — Variable Interpolation
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  createExecutionContext,
  setNodeOutput,
  resolveString,
  resolveConfig,
} from "../context.js";

function makeContext() {
  return createExecutionContext({
    executionId: "exec-1",
    workflowId: "wf-1",
    workspaceId: "ws-1",
    triggerType: "webhook",
    triggerPayload: {
      email: "user@example.com",
      amount: 100,
      metadata: { source: "stripe", event: "payment" },
    },
    variables: { company: "FlowMind", env: "production" },
  });
}

describe("resolveString", () => {
  it("resolves trigger payload fields", () => {
    const ctx = makeContext();
    const result = resolveString("Email: {{trigger.email}}", ctx);
    expect(result).toBe("Email: user@example.com");
  });

  it("resolves nested trigger fields", () => {
    const ctx = makeContext();
    const result = resolveString(
      "Source: {{trigger.metadata.source}}",
      ctx,
    );
    expect(result).toBe("Source: stripe");
  });

  it("resolves workflow variables", () => {
    const ctx = makeContext();
    const result = resolveString(
      "Welcome to {{var.company}} ({{var.env}})",
      ctx,
    );
    expect(result).toBe("Welcome to FlowMind (production)");
  });

  it("resolves node outputs", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "node_1", { name: "Alice", score: 42 });
    const result = resolveString(
      "User: {{node_1.name}}, Score: {{node_1.score}}",
      ctx,
    );
    expect(result).toBe("User: Alice, Score: 42");
  });

  it("resolves entire node output as JSON", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "node_1", { name: "Alice", score: 42 });
    const result = resolveString("Output: {{node_1}}", ctx);
    expect(result).toBe('Output: {"name":"Alice","score":42}');
  });

  it("leaves unresolved variables as-is", () => {
    const ctx = makeContext();
    const result = resolveString("Missing: {{trigger.nonexistent}}", ctx);
    expect(result).toBe("Missing: {{trigger.nonexistent}}");
  });

  it("handles multiple variables in one string", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "step1", { status: "ok" });
    const result = resolveString(
      "{{var.company}}: {{step1.status}} for {{trigger.email}}",
      ctx,
    );
    expect(result).toBe("FlowMind: ok for user@example.com");
  });
});

describe("resolveConfig", () => {
  it("resolves variables in a flat config object", () => {
    const ctx = makeContext();
    const config = {
      url: "https://api.example.com/users/{{trigger.email}}",
      method: "POST",
      headers: {
        "X-Company": "{{var.company}}",
      },
    };
    const resolved = resolveConfig(config, ctx);
    expect(resolved.url).toBe("https://api.example.com/users/user@example.com");
    expect(resolved.method).toBe("POST");
    expect((resolved.headers as Record<string, string>)["X-Company"]).toBe(
      "FlowMind",
    );
  });

  it("resolves variables in arrays", () => {
    const ctx = makeContext();
    const config = {
      recipients: ["{{trigger.email}}", "admin@{{var.company}}.com"],
    };
    const resolved = resolveConfig(config, ctx);
    expect(resolved.recipients).toEqual([
      "user@example.com",
      "admin@FlowMind.com",
    ]);
  });

  it("resolves variables in nested objects", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "ai", { summary: "All good" });
    const config = {
      body: {
        message: "{{ai.summary}}",
        user: { email: "{{trigger.email}}" },
      },
    };
    const resolved = resolveConfig(config, ctx);
    expect((resolved.body as Record<string, unknown>).message).toBe("All good");
    expect(
      ((resolved.body as Record<string, unknown>).user as Record<string, unknown>)
        .email,
    ).toBe("user@example.com");
  });

  it("handles non-string values unchanged", () => {
    const ctx = makeContext();
    const config = {
      timeout: 5000,
      enabled: true,
      count: 0,
    };
    const resolved = resolveConfig(config, ctx);
    expect(resolved.timeout).toBe(5000);
    expect(resolved.enabled).toBe(true);
    expect(resolved.count).toBe(0);
  });
});

describe("setNodeOutput / getNodeOutput", () => {
  it("stores and retrieves node output", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "step1", { result: 42 });
    const output = ctx.nodeOutputs.get("step1");
    expect(output).toEqual({ result: 42 });
  });

  it("stores individual field accessors", () => {
    const ctx = makeContext();
    setNodeOutput(ctx, "step1", { name: "Test", value: 99 });
    const nameEntry = ctx.nodeOutputs.get("step1.name");
    expect(nameEntry).toEqual({ name: "Test" });
    const valueEntry = ctx.nodeOutputs.get("step1.value");
    expect(valueEntry).toEqual({ value: 99 });
  });
});
