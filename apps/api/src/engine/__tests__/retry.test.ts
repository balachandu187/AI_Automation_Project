// ============================================================================
// FlowMind Engine Tests — Retry Logic
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import {
  executeWithRetry,
  computeBackoff,
  getRetryConfig,
} from "../retry.js";
import { RetryableError, FatalError, RateLimitError } from "../errors.js";
import type { DAGNode, NodeResult, ExecutionContext } from "../types.js";

function makeNode(
  overrides: Partial<Record<string, unknown>> = {},
): DAGNode {
  return {
    id: "test-node",
    type: "action",
    label: "Test Node",
    config: overrides,
  };
}

function makeContext(): ExecutionContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    workspaceId: "ws-1",
    triggerType: "manual",
    triggerPayload: {},
    nodeOutputs: new Map(),
    variables: {},
    terminated: false,
    startedAt: new Date(),
  };
}

describe("computeBackoff", () => {
  it("starts at initialDelayMs for attempt 0", () => {
    const delay = computeBackoff(0, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterFactor: 0,
    });
    expect(delay).toBe(1000);
  });

  it("doubles for each attempt (exponential)", () => {
    const config = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterFactor: 0,
    };
    expect(computeBackoff(0, config)).toBe(1000);
    expect(computeBackoff(1, config)).toBe(2000);
    expect(computeBackoff(2, config)).toBe(4000);
    expect(computeBackoff(3, config)).toBe(8000);
  });

  it("caps at maxDelayMs", () => {
    const delay = computeBackoff(10, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitterFactor: 0,
    });
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("applies jitter (delay is less than full)", () => {
    const config = {
      maxRetries: 3,
      initialDelayMs: 10000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterFactor: 0.5,
    };
    const delay = computeBackoff(0, config);
    // With jitter 0.5, delay should be between 5000 and 10000
    expect(delay).toBeLessThanOrEqual(10000);
    expect(delay).toBeGreaterThanOrEqual(5000);
  });
});

describe("getRetryConfig", () => {
  it("returns defaults for nodes without retry config", () => {
    const node = makeNode({});
    const config = getRetryConfig(node);
    expect(config.maxRetries).toBe(3);
    expect(config.initialDelayMs).toBe(1000);
  });

  it("reads per-node overrides from config", () => {
    const node = makeNode({
      maxRetries: 5,
      retryDelay: 2000,
      retryMaxDelay: 30000,
      retryMultiplier: 3,
      retryJitter: 0.2,
    });
    const config = getRetryConfig(node);
    expect(config.maxRetries).toBe(5);
    expect(config.initialDelayMs).toBe(2000);
    expect(config.maxDelayMs).toBe(30000);
    expect(config.backoffMultiplier).toBe(3);
    expect(config.jitterFactor).toBe(0.2);
  });
});

describe("executeWithRetry", () => {
  it("returns result on first success", async () => {
    const node = makeNode();
    const context = makeContext();
    const fn = vi.fn().mockResolvedValue({
      nodeId: node.id,
      status: "completed" as const,
      output: { ok: true },
      durationMs: 10,
      retryCount: 0,
    });

    const result = await executeWithRetry(fn, node, context);
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
    expect(result.retryCount).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on RetryableError and succeeds", async () => {
    const node = makeNode({ maxRetries: 3, retryDelay: 1, retryJitter: 0 });
    const context = makeContext();

    let attempts = 0;
    const fn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new RetryableError("Temporary failure");
      }
      return {
        nodeId: node.id,
        status: "completed" as const,
        output: { recovered: true },
        durationMs: 10,
        retryCount: attempts - 1,
      };
    });

    const result = await executeWithRetry(fn, node, context);
    expect(result.status).toBe("completed");
    expect(result.retryCount).toBe(2);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("fails immediately on FatalError (no retry)", async () => {
    const node = makeNode();
    const context = makeContext();
    const fn = vi.fn().mockRejectedValue(
      new FatalError("Invalid config"),
    );

    const result = await executeWithRetry(fn, node, context);
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Invalid config");
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it("exhausts retries and returns failure", async () => {
    const node = makeNode({ maxRetries: 2, retryDelay: 1, retryJitter: 0 });
    const context = makeContext();
    const fn = vi.fn().mockRejectedValue(
      new RetryableError("Always failing"),
    );

    const result = await executeWithRetry(fn, node, context);
    expect(result.status).toBe("failed");
    expect(result.retryCount).toBe(2);
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it("respects RateLimitError retryAfterMs", async () => {
    const node = makeNode({ maxRetries: 2, retryDelay: 100, retryJitter: 0 });
    const context = makeContext();

    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw new RateLimitError("Rate limited", 10); // 10ms delay
      }
      return {
        nodeId: node.id,
        status: "completed" as const,
        output: {},
        durationMs: 5,
        retryCount: 1,
      };
    });

    const start = Date.now();
    const result = await executeWithRetry(fn, node, context);
    const elapsed = Date.now() - start;

    expect(result.status).toBe("completed");
    // Should have used ~10ms delay (not the 100ms configured)
    expect(elapsed).toBeLessThan(200);
  });
});
