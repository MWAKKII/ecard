import { isIP } from "node:net";

/**
 * Best-effort client address for rate limits and audit records.
 *
 * Deployments must terminate HTTP(S) at a proxy that overwrites
 * `X-Forwarded-For` / `X-Real-IP`. If the application is exposed directly,
 * a caller can choose these header values and therefore evade per-IP limits;
 * host-level rate limiting is still required.
 */
export function requestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && isIP(first) !== 0) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp) !== 0) return realIp;

  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp && isIP(cloudflareIp) !== 0) return cloudflareIp;

  return null;
}
