import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}

/** "상,중" 같은 CSV 쿼리를 허용값 집합으로 검증해서 배열로 반환 */
export function parseCsvEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T[] | { invalid: string } {
  if (!raw) return [];
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  for (const v of values) {
    if (!allowed.includes(v as T)) return { invalid: v };
  }
  return [...new Set(values)] as T[];
}

export function parsePagination(
  limitRaw: string | undefined,
  offsetRaw: string | undefined,
): { limit: number; offset: number } | { error: string } {
  const limit = Number(limitRaw ?? 12);
  const offset = Number(offsetRaw ?? 0);
  if (!Number.isFinite(limit) || !Number.isFinite(offset)) {
    return { error: "limit/offset은 숫자여야 함" };
  }
  return {
    limit: Math.min(60, Math.max(1, Math.trunc(limit))),
    offset: Math.max(0, Math.trunc(offset)),
  };
}
