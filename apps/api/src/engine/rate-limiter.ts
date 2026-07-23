// ============================================================================
// FlowMind Workflow Engine — Rate Limiter
// ============================================================================
// Token-bucket rate limiter per integration per workspace using Redis.
// Configurable: max tokens, refill rate.
// Applied before integration node execution.

import { Redis } from "ioredis";

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum number of tokens (burst capacity) */
  maxTokens: number;
  /** Tokens refilled per second */
  refillRate: number;
  /** Key prefix for Redis keys */
  keyPrefix?: string;
}

/** Result of a rate limit check */
export interface RateLimitResult {
  allowed: boolean;
  /** Tokens remaining after this request */
  remaining: number;
  /** Time in ms until the bucket resets enough for one token */
  resetMs: number;
  /** Suggested retry-after header value in ms */
  retryAfterMs: number;
}

/** Default rate limit settings per integration type */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  default: { maxTokens: 60, refillRate: 1 }, // 60 req/min = 1/sec refill
  http_request: { maxTokens: 100, refillRate: 2 },
  ai_agent: { maxTokens: 30, refillRate: 0.5 },
  slack: { maxTokens: 50, refillRate: 1 },
  gmail: { maxTokens: 50, refillRate: 1 },
  salesforce: { maxTokens: 25, refillRate: 0.5 },
};

/**
 * Token-bucket rate limiter backed by Redis.
 *
 * Uses a Lua script for atomicity:
 * 1. Read current tokens + last refill timestamp
 * 2. Calculate tokens to add based on elapsed time and refill rate
 * 3. Cap at maxTokens
 * 4. If tokens >= 1, decrement and allow; otherwise deny
 */
export class RateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  /** Lua script for atomic token-bucket check-and-decrement */
  private static readonly LUA_SCRIPT = `
    local key = KEYS[1]
    local maxTokens = tonumber(ARGV[1])
    local refillRate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3]) -- current time in ms

    -- Read current state
    local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
    local tokens = tonumber(bucket[1])
    local lastRefill = tonumber(bucket[2])

    if tokens == nil then
      -- New bucket: start full
      tokens = maxTokens
      lastRefill = now
    else
      -- Refill: tokens += elapsed_ms * refillRate / 1000
      local elapsed = now - lastRefill
      local added = (elapsed / 1000) * refillRate
      tokens = math.min(maxTokens, tokens + added)
      lastRefill = now
    end

    -- Try to consume one token
    if tokens >= 1 then
      tokens = tokens - 1
      redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
      redis.call('PEXPIRE', key, math.ceil((maxTokens / refillRate) * 1000) + 60000)

      -- Time until next token available
      local timeToNextToken = 0
      if tokens < maxTokens then
        timeToNextToken = math.ceil(((1 - tokens) / refillRate) * 1000)
        if timeToNextToken < 0 then timeToNextToken = 0 end
      end

      return {1, math.floor(tokens), timeToNextToken, 0}  -- allowed
    else
      -- Calculate retry-after
      local timeToNextToken = math.ceil(((1 - tokens) / refillRate) * 1000)
      if timeToNextToken < 0 then timeToNextToken = 1000 end

      redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
      redis.call('PEXPIRE', key, math.ceil((maxTokens / refillRate) * 1000) + 60000)

      return {0, 0, timeToNextToken, timeToNextToken}  -- denied
    end
  `;

  private scriptSha: string | null = null;

  constructor(redis: Redis, keyPrefix = "ratelimit") {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /**
   * Build the Redis key for a given scope.
   */
  private buildKey(workspaceId: string, resourceType: string): string {
    return `${this.keyPrefix}:${workspaceId}:${resourceType}`;
  }

  /**
   * Check if a request is allowed by the rate limiter.
   *
   * @param workspaceId - The workspace ID
   * @param resourceType - The integration/node type (determines the rate limit config)
   * @param customConfig - Optional override for the rate limit config
   */
  async checkRateLimit(
    workspaceId: string,
    resourceType: string,
    customConfig?: Partial<RateLimitConfig>,
  ): Promise<RateLimitResult> {
    const config = {
      ...(DEFAULT_RATE_LIMITS[resourceType] || DEFAULT_RATE_LIMITS.default),
      ...customConfig,
    };

    const key = this.buildKey(workspaceId, resourceType);
    const now = Date.now();

    try {
      // Load and cache the Lua script
      if (!this.scriptSha) {
        this.scriptSha = await this.redis.script(
          "LOAD",
          RateLimiter.LUA_SCRIPT,
        );
      }

      const result = (await this.redis.evalsha(
        this.scriptSha,
        1,
        key,
        config.maxTokens.toString(),
        config.refillRate.toString(),
        now.toString(),
      )) as [number, number, number, number];

      return {
        allowed: result[0] === 1,
        remaining: result[1]!,
        resetMs: result[2]!,
        retryAfterMs: result[3]!,
      };
    } catch (err) {
      // If script not found, reload and retry
      if (
        err instanceof Error &&
        err.message.includes("NOSCRIPT")
      ) {
        this.scriptSha = null;
        return this.checkRateLimit(workspaceId, resourceType, customConfig);
      }

      // On Redis errors, allow the request to proceed (fail open)
      console.error("[rate-limiter] Redis error, allowing request:", err);
      return {
        allowed: true,
        remaining: 0,
        resetMs: 0,
        retryAfterMs: 0,
      };
    }
  }

  /**
   * Assert that a request is within rate limits. Throws RateLimitError if not.
   */
  async assertRateLimit(
    workspaceId: string,
    resourceType: string,
  ): Promise<void> {
    const result = await this.checkRateLimit(workspaceId, resourceType);
    if (!result.allowed) {
      const { RateLimitError } = await import("./errors.js");
      throw new RateLimitError(
        `Rate limit exceeded for ${resourceType} in workspace ${workspaceId}`,
        result.retryAfterMs,
      );
    }
  }

  /**
   * Get current bucket state for a resource (for monitoring/UIs).
   */
  async getBucketState(
    workspaceId: string,
    resourceType: string,
  ): Promise<{ tokens: number; lastRefill: number } | null> {
    const key = this.buildKey(workspaceId, resourceType);
    const data = await this.redis.hmget(key, "tokens", "lastRefill");

    if (!data[0]) return null;

    return {
      tokens: parseFloat(data[0]),
      lastRefill: parseInt(data[1] || "0", 10),
    };
  }
}
