import type { Confidence } from "./types";
export interface ZopaInput {
  walkAway: number; anchor: number;
  employer?: { low: number; high: number; confidence: Confidence };
}
export interface ZopaResult { overlap: "positive" | "none" | "unknown"; interval?: [number, number]; confidence?: Confidence }
/** Overlap estimate. Confidence never exceeds "medium" (rule 12): the real budget is unknown. */
export function zopaEstimate(i: ZopaInput): ZopaResult {
  if (!i.employer) return { overlap: "unknown" };
  const lo = Math.max(i.walkAway, i.employer.low), hi = Math.min(i.anchor, i.employer.high);
  const cap: Confidence = i.employer.confidence === "low" ? "low" : "medium";
  return lo <= hi ? { overlap: "positive", interval: [lo, hi], confidence: cap } : { overlap: "none", confidence: cap };
}
