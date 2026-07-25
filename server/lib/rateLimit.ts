import type { Context, MiddlewareHandler, Next } from "hono";
import { fail } from "./http.ts";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(c: Context): string {
  const xf = c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("x-real-ip");
  return xf || "unknown";
}

/**
 * 간단한 인메모리 슬라이딩 윈도우 rate limit.
 * 단일 프로세스(Pi systemd) 기준. 프록시 뒤에서는 CF-Connecting-IP 사용.
 */
export function rateLimit(opts: {
  name: string;
  limit: number;
  windowMs: number;
}): MiddlewareHandler {
  const { name, limit, windowMs } = opts;
  return async (c, next: Next) => {
    const now = Date.now();
    const key = `${name}:${clientKey(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retrySec));
      return fail(
        c,
        429,
        "rate_limited",
        "요청이 너무 많아요. 잠시 후 다시 시도해 주세요",
      );
    }
    await next();
  };
}

/** 가끔 오래된 버킷 정리 */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k);
  }
}, 60_000).unref?.();
