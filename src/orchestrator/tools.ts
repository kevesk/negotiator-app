import { anchorOptions, draftConcessionPlan, runChecks, zopaEstimate, netEstimate, type AnchorOption, type ConcessionPlan, type Check, type NetResult } from "@/engine";
import { slotValue, type SessionState } from "./state";

export interface MarketRange { p25?: number; median?: number; p75?: number; averageOnly?: boolean; confidence?: "low" | "medium" | "high"; sources?: string[]; valid_as_of?: string }
export interface NumbersResult {
  inputs: { target: number; walkAway: number; market?: MarketRange };
  checks: Check[];
  anchorOptions: AnchorOption[];
  /** The anchor the plan is drawn for: halfway to P75 when possible, tagged assumed until the user confirms (D70). */
  defaultAnchor: AnchorOption;
  concession: ConcessionPlan;
  net: { target: NetResult; anchor: NetResult; basis: "municipality" | "national_average" };
  zopa: ReturnType<typeof zopaEstimate>;
  flags: string[];
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Runs the numbers engine on the session's slots. Pure and deterministic; the coach explains the result and never does the arithmetic. */
export function runNumbersTool(s: SessionState): NumbersResult | { needs: string[] } {
  const target = num(slotValue(s, "own_target")), walkAway = num(slotValue(s, "walk_away"));
  // the market range is used when it exists; without it the engine still works and says so (flow v0.3)
  const market = slotValue<MarketRange | string>(s, "market_range");
  const needs = [target === undefined ? "own_target" : "", walkAway === undefined ? "walk_away" : ""].filter(Boolean);
  if (needs.length) return { needs };
  const t = target!, w = walkAway!, m: MarketRange = market && typeof market === "object" ? market : {};
  const batna = slotValue<unknown>(s, "batna");
  const batnaMonthly = num(batna) ?? num((batna as { monthly?: unknown } | undefined)?.monthly);
  const p75 = m.averageOnly ? undefined : m.p75;
  const opts = anchorOptions({ target: t, p75 });
  const defaultAnchor = opts.find((o) => o.id === "halfway") ?? opts.find((o) => o.id === "above_target") ?? opts[0]!;
  const anchorChecks = runChecks({ target: t, walkAway: w, batnaMonthly, anchor: defaultAnchor.amount, market: { p25: m.averageOnly ? undefined : m.p25, p75, averageOnly: m.averageOnly } });
  const flags: string[] = [];
  const muni = slotValue<string>(s, "tax_municipality");
  let net = (g: number) => netEstimate(g);
  let basis: "municipality" | "national_average" = "national_average";
  if (muni) { try { netEstimate(t, { municipality: muni }); net = (g) => netEstimate(g, { municipality: muni }); basis = "municipality"; } catch { flags.push("unknown_municipality"); } }
  const pay = slotValue<{ low?: number; high?: number }>(s, "employer_pay_info");
  const employer = pay?.low !== undefined && pay?.high !== undefined ? { low: pay.low, high: pay.high, confidence: "medium" as const }
    : p75 !== undefined && m.p25 !== undefined ? { low: m.p25, high: p75, confidence: m.confidence ?? ("low" as const) } : undefined;
  if (m.averageOnly) flags.push("average_only");
  if (m.median === undefined && m.p75 === undefined) flags.push("no_market_data");
  return {
    inputs: { target: t, walkAway: w, market: m }, checks: anchorChecks, anchorOptions: opts, defaultAnchor,
    concession: draftConcessionPlan(defaultAnchor.amount, t, w),
    net: { target: net(t), anchor: net(defaultAnchor.amount), basis },
    zopa: zopaEstimate({ walkAway: w, anchor: defaultAnchor.amount, employer }), flags,
  };
}
