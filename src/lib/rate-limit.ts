/**
 * Rate Limiting Utility
 *
 * Uses Upstash Redis (or falls back to in-memory) for rate limiting API requests.
 */

import { Redis } from "@upstash/redis";

// Rate limit configurations
export const RATE_LIMITS = {
  prediction: { limit: 30, window: 60 }, // 30 requests per minute
  tip: { limit: 10, window: 60 }, // 10 tips per minute
  scrape: { limit: 5, window: 60 }, // 5 scrape requests per minute
  api: { limit: 100, window: 60 }, // 100 API calls per minute
  chat: { limit: 20, window: 60 }, // 20 chat messages per minute
} as const;

type RateLimitType = keyof typeof RATE_LIMITS;

// Lazy Redis initialization
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis === null && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    _redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return _redis;
}

// In-memory fallback (for development or if Redis is unavailable)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

/**
 * Check rate limit for an identifier (usually IP or user ID)
 * Fail-closed: if Redis is unavailable, deny the request
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType = "api"
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[type];
  const key = `rate_limit:${type}:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.window;

  const redis = getRedis();

  if (redis) {
    try {
      // Use Redis sorted set for sliding window rate limiting
      const pipeline = redis.pipeline();

      // Remove old entries outside the window
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current entries
      pipeline.zcard(key);

      // Add current request
      pipeline.zadd(key, { score: now, member: `${now}:${Math.random()}` });

      // Set expiry on the key
      pipeline.expire(key, config.window);

      const results = await pipeline.exec();
      const count = (results[1] as number) || 0;

      const success = count < config.limit;
      const remaining = Math.max(0, config.limit - count - 1);

      return {
        success,
        remaining,
        reset: now + config.window,
        limit: config.limit,
      };
    } catch (error) {
      console.error("Redis rate limit error:", error);
      // Fail closed - deny request if Redis fails
      return {
        success: false,
        remaining: 0,
        reset: now + config.window,
        limit: config.limit,
      };
    }
  }

  // In-memory fallback (for development)
  const stored = memoryStore.get(key);
  const resetAt = stored?.resetAt || now + config.window;

  if (stored && now < stored.resetAt) {
    const success = stored.count < config.limit;
    stored.count++;
    return {
      success,
      remaining: Math.max(0, config.limit - stored.count),
      reset: resetAt,
      limit: config.limit,
    };
  }

  // Start new window
  memoryStore.set(key, { count: 1, resetAt: now + config.window });
  return {
    success: true,
    remaining: config.limit - 1,
    reset: now + config.window,
    limit: config.limit,
  };
}

/**
 * Rate limit middleware helper
 */
export async function withRateLimit(
  request: Request,
  type: RateLimitType = "api"
): Promise<Response | null> {
  // Get identifier from IP or forwarded header
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0] || "unknown";

  const result = await checkRateLimit(ip, type);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        retryAfter: result.reset - Math.floor(Date.now() / 1000),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": String(result.remaining),
          "X-RateLimit-Reset": String(result.reset),
          "Retry-After": String(result.reset - Math.floor(Date.now() / 1000)),
        },
      }
    );
  }

  return null; // No rate limit hit, continue
}
