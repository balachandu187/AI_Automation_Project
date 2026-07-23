// ============================================================================
// FlowMind Workflow Engine — Error Classes
// ============================================================================

/**
 * Base error for all engine errors.
 */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * RetryableError — transient failures that should be retried.
 * Examples: network timeouts, rate limits (429), server errors (5xx),
 * temporary provider outages.
 */
export class RetryableError extends EngineError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * FatalError — non-recoverable failures that should NOT be retried.
 * Examples: auth failures (401/403), invalid input (400), not found (404),
 * workflow timeout, validation errors.
 */
export class FatalError extends EngineError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = "FatalError";
  }
}

/**
 * TimeoutError — thrown when a node or the overall workflow exceeds its time limit.
 */
export class TimeoutError extends EngineError {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * RateLimitError — thrown when an integration's rate limit is exceeded.
 * This is a retryable error with a specific delay hint.
 */
export class RateLimitError extends RetryableError {
  constructor(
    message: string,
    public readonly retryAfterMs: number,
    cause?: Error,
  ) {
    super(message, cause);
    this.name = "RateLimitError";
  }
}

/**
 * ValidationError — thrown when a node's config fails validation.
 * This is a fatal (non-retryable) error.
 */
export class ValidationError extends FatalError {
  constructor(
    message: string,
    public readonly validationErrors: string[],
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * ApprovalRequiredError — thrown when a workflow reaches an approval node.
 * This pauses execution, not a true error.
 */
export class ApprovalRequiredError extends EngineError {
  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly approvalData: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApprovalRequiredError";
  }
}

/**
 * Classify a generic error as retryable or fatal based on heuristics.
 */
export function classifyError(err: Error): RetryableError | FatalError {
  if (err instanceof EngineError) return err as RetryableError | FatalError;

  const message = err.message.toLowerCase();

  // Network / timeout errors → retryable
  if (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed")
  ) {
    return new RetryableError(err.message, err);
  }

  // Rate limiting → retryable
  if (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  ) {
    return new RateLimitError(err.message, 60_000, err);
  }

  // Server errors → retryable
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("service unavailable")
  ) {
    return new RetryableError(err.message, err);
  }

  // Auth / validation / not found → fatal
  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("400") ||
    message.includes("404") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("not found") ||
    message.includes("invalid") ||
    message.includes("validation")
  ) {
    return new FatalError(err.message, err);
  }

  // Default: assume retryable for unknown errors
  return new RetryableError(err.message, err);
}

/**
 * Check if an error is retryable.
 */
export function isRetryable(err: Error): boolean {
  if (err instanceof RetryableError) return true;
  if (err instanceof FatalError) return false;
  // Classify unknown errors — default to retryable for resilience
  return classifyError(err) instanceof RetryableError;
}
