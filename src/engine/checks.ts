import type { Check } from "./types";
export interface CheckInput {
  target?: number; walkAway?: number; batnaMonthly?: number;
  market?: { p25?: number; p75?: number; averageOnly?: boolean };
  anchor?: number; offer?: number;
}
const ok = (id: string): Check => ({ id, status: "ok", detail: "" });
/** Validation checks (spec: Checks). A flag never blocks by itself. */
export function runChecks(i: CheckInput): Check[] {
  const out: Check[] = [];
  if (i.walkAway !== undefined && i.batnaMonthly !== undefined)
    out.push(i.walkAway < i.batnaMonthly ? { id: "walk_away_not_below_batna", status: "flag", detail: "walk-away is below the monthly equivalent of the alternative" } : ok("walk_away_not_below_batna"));
  if (i.walkAway !== undefined && i.target !== undefined)
    out.push(i.walkAway > i.target ? { id: "walk_away_not_above_target", status: "error", detail: "walk-away is above the target" } : ok("walk_away_not_above_target"));
  const m = i.market;
  if (m?.averageOnly) out.push({ id: "average_only", status: "flag", detail: "market data is an average only; confidence low" });
  if (m?.p75 !== undefined && i.target !== undefined)
    out.push(i.target > m.p75 ? { id: "target_vs_market_p75", status: "flag", detail: "target is above P75; needs evidence" } : ok("target_vs_market_p75"));
  if (m?.p75 !== undefined && i.anchor !== undefined)
    out.push(i.anchor > m.p75 ? { id: "anchor_above_p75", status: "flag", detail: "anchor is above P75; needs evidence" } : ok("anchor_above_p75"));
  if (m?.p25 !== undefined && i.offer !== undefined)
    out.push(i.offer < m.p25 ? { id: "offer_below_p25", status: "flag", detail: "offer is below P25; check title mapping and data" } : ok("offer_below_p25"));
  return out;
}
