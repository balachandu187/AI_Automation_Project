// ============================================================================
// FlowMind Workflow Engine — Retry System
// ============================================================================
// Configurable per-node retry with exponential backoff and jitter.
// Classifies errors as retryable vs non-retryable.

import { isRetryable, FatalError, RateLimitError } from "./errors.js";
import type { DAGNode, NodeResult, ExecutionContext } from "./types.js";

/** Retry configuration for a node */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial backoff delay in ms (default: 1000) */
  initialDelayMs: number;
  /** Maximum backoff delay in ms (default: 60000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2 — exponential) */
  backoffMultiplier: number;
  /** Jitter factor (0-1, default: 0.1) */
  jitterFactor: number;
}

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
};

/**
 * Compute the delay for a given retry attempt using exponential backoff + jitter.
 */
export function computeBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  // Exponential backoff: initialDelay * multiplier^attempt
  const exponentialDelay =
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: random fraction of the delay
  const jitter = cappedDelay * config.jitterFactor * Math.random();

  return Math.floor(cappedDelay - jitter);
}

/**
 * Extract retry configuration from a node's config, falling back to defaults.
 */
export function getRetryConfig(node: DAGNode): RetryConfig {
  const cfg = node.config as Record<string, unknown>;
  return {
    maxRetries:
      typeof cfg.maxRetries === "number"
        ? cfg.maxRetries
        : DEFAULT_RETRY_CONFIG.maxRetries,
    initialDelayMs:
      typeof cfg.retryDelay === "number"
        ? cfg.retryDelay
        : DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs:
      typeof cfg.retryMaxDelay === "number"
        ? cfg.retryMaxDelay
        : DEFAULT_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier:
      typeof cfg.retryMultiplier === "number"
        ? cfg.retryMultiplier
        : DEFAULT_RETRY_CONFIG.backoffMultiplier,
    jitterFactor:
      typeof cfg.retryJitter === "number"
        ? cfg.retryJitter
        : DEFAULT_RETRY_CONFIG.jitterFactor,
  };
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a node handler with retry logic.
 *
 * @param executorFn - The function that executes the node (returns NodeResult)
 * @param node - The DAG node being executed
 * @param context - Execution context
 * @returns The NodeResult (either success or final failure)
 */
export async function executeWithRetry(
  executorFn: (
    node: DAGNode,
    context: ExecutionContext,
  ) => Promise<NodeResult>,
  node: DAGNode,
  context: ExecutionContext,
): Promise<NodeResult> {
  const retryConfig = getRetryConfig(node);
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const result = await executorFn(node, context);
      result.retryCount = attempt;
      result.durationMs = Date.now() - startTime;
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if retryable
      if (!isRetryable(lastError) || attempt >= retryConfig.maxRetries) {
        const durationMs = Date.now() - startTime;
        if (lastError instanceof FatalError || !isRetryable(lastError)) {
          return {
            nodeId: node.id,
            status: "failed",
            output: undefined,
            error: lastError,
            durationMs,
            retryCount: attempt,
          };
        }
        // Exhausted retries — final failure
        return {
          nodeId: node.id,
          status: "failed",
          output: undefined,
          error: new FatalError(
            `Exhausted ${retryConfig.maxRetries} retries: ${lastError.message}`,
            lastError,
          ),
          durationMs,
          retryCount: attempt,
        };
      }

      // Respect RateLimitError's retry-after hint if available
      const delay =
        lastError instanceof RateLimitError
          ? lastError.retryAfterMs
          : computeBackoff(attempt, retryConfig);

      console.warn(
        `[engine] Retrying node ${node.id} (${node.type}) — attempt ${attempt + 1}/${retryConfig.maxRetries} after ${delay}ms: ${lastError.message}`,
      );

      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  const durationMs = Date.now() - startTime;
  return {
    nodeId: node.id,
    status: "failed",
    output: undefined,
    error: lastError || new Error("Unknown retry failure"),
    durationMs,
    retryCount: retryConfig.maxRetries,
  };
}
