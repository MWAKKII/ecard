import { NextResponse } from "next/server";

/**
 * Small in-process fixed-window rate limiter.
 *
 * This protects a single Node process from brute-force and expensive-action
 * abuse. Serverless / multi-instance deployments must ALSO enable the hosting
 * platform's rate limiting (for example Vercel Firewall or an API gateway),
 * because each instance keeps its own counters.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __ecardRateLimitBuckets?: Map<string, Bucket>;
  __ecardRateLimitCalls?: number;
};

const MAX_BUCKETS = 10_000;

const buckets = globalForRateLimit.__ecardRateLimitBuckets ?? new Map<string, Bucket>();
globalForRateLimit.__ecardRateLimitBuckets = buckets;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function fullBucketResult(now: number, limit: number): RateLimitResult {
  let soonestReset = now + 60_000;
  for (const bucket of buckets.values()) {
    if (bucket.resetAt < soonestReset) soonestReset = bucket.resetAt;
  }
  return {
    allowed: false,
    limit,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((soonestReset - now) / 1000)),
    resetAt: soonestReset,
  };
}

/** Counts one request against `key`, returning whether it may proceed. */
export function takeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1, Math.floor(windowMs));

  const calls = (globalForRateLimit.__ecardRateLimitCalls ?? 0) + 1;
  globalForRateLimit.__ecardRateLimitCalls = calls;
  if (calls % 500 === 0) {
    sweepExpired(now);
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Fail closed if an attacker has filled the bounded key table with unique
    // spoofed IP/identifier combinations. This preserves memory and prevents
    // eviction from resetting live rate-limit counters.
    if (buckets.size >= MAX_BUCKETS) {
      sweepExpired(now);
      if (buckets.size >= MAX_BUCKETS) {
        return fullBucketResult(now, safeLimit);
      }
    }
    bucket = { count: 0, resetAt: now + safeWindow };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= safeLimit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return {
    allowed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - bucket.count),
    retryAfterSeconds,
    resetAt: bucket.resetAt,
  };
}

/** Builds a 429 response with retry metadata. */
export function rateLimitResponse(
  result: RateLimitResult,
  message = "Too many requests. Please try again later.",
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, result.retryAfterSeconds)),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        ...extraHeaders,
      },
    },
  );
}
