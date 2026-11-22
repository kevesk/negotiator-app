import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cost protection for the test app (D108): an access code that testers get from the owner, and message caps.
 * Nothing here is stored or logged: the code is compared in constant time, and the caps keep only a hashed visitor key
 * with message times, in memory, for at most one window (one hour). A cold start empties it; the spending limit in the
 * Anthropic Console stays the hard stop.
 */
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** True when an access code is set (env ACCESS_CODE). Without one the app is open, as in development. */
export function accessRequired(code: string | undefined = process.env.ACCESS_CODE): boolean {
  return !!code?.trim();
}
export function accessOk(given: string | null | undefined, code: string | undefined = process.env.ACCESS_CODE): boolean {
  if (!code?.trim()) return true;
  if (typeof given !== "string" || !given.trim()) return false;
  return timingSafeEqual(sha(given.trim()), sha(code.trim()));
}

/** A sliding-window counter per key. Keys are bounded so memory cannot grow without limit. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(readonly limit: number, readonly windowMs = 3_600_000, readonly maxKeys = 5000) {}
  hit(key: string, now = Date.now()): { ok: boolean; retryAfterMs: number } {
    const since = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.limit) { this.hits.set(key, list); return { ok: false, retryAfterMs: list[0]! + this.windowMs - now }; }
    list.push(now); this.hits.delete(key); this.hits.set(key, list); // re-insert: the map keeps the most recent keys last
    if (this.hits.size > this.maxKeys) for (const k of this.hits.keys()) { this.hits.delete(k); if (this.hits.size <= this.maxKeys) break; }
    return { ok: true, retryAfterMs: 0 };
  }
}

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
export const CAPS = {
  perVisitorPerHour: num(process.env.MESSAGE_CAP_PER_HOUR, 30),
  totalPerHour: num(process.env.TOTAL_CAP_PER_HOUR, 300),
  codeAttemptsPerHour: 10,
};
export const visitorLimiter = new RateLimiter(CAPS.perVisitorPerHour);
export const totalLimiter = new RateLimiter(CAPS.totalPerHour);
export const codeLimiter = new RateLimiter(CAPS.codeAttemptsPerHour);

/** A visitor key: a hash of the network address the host reports. The address itself is never kept. */
export function visitorKey(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
  return sha(`negotiator:${ip}`).toString("hex").slice(0, 32);
}
export const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** The checks in front of every chat message. Null means go ahead; otherwise the response to send. */
export function guardChat(headers: Headers, now = Date.now(), lim = { visitor: visitorLimiter, total: totalLimiter }): { status: number; body: Record<string, unknown> } | null {
  if (!accessOk(headers.get("x-access-code"))) return { status: 401, body: { error: "access_required" } };
  const v = lim.visitor.hit(visitorKey(headers), now);
  if (!v.ok) return { status: 429, body: { error: "rate_limited", retryAfterMinutes: minutes(v.retryAfterMs) } };
  const t = lim.total.hit("all", now);
  if (!t.ok) return { status: 429, body: { error: "busy", retryAfterMinutes: minutes(t.retryAfterMs) } };
  return null;
}
