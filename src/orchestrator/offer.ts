import { analyzeOffer, normalise, type OfferAnalysis, type OfferInput } from "@/engine";
import { slotValue, type SessionState } from "./state";

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** Monthly gross SEK from a slot that may carry a yearly or hourly unit. */
function monthlyFrom(s: SessionState, id: string, weeklyHours?: number): number | undefined {
  const v = slotValue<unknown>(s, id); const unit = (s.slots[id]?.unit ?? "").toLowerCase();
  if (!isNum(v)) return undefined;
  const period = /year|år|annual|yr/.test(unit) ? "year" : /hour|tim/.test(unit) ? "hour" : "month";
  return Math.round(normalise({ amount: v, period, weeklyHours }).monthlyGross);
}
/** Builds the analyzer's input from the session slots. A yearly or hourly base keeps its unit so the analyzer converts it and lists the assumption. */
export function offerInputFrom(s: SessionState): OfferInput {
  const hours = slotValue<number>(s, "weekly_hours"); const weeklyHours = isNum(hours) ? hours : undefined;
  const raw = slotValue<unknown>(s, "offer_base"); const unit = (s.slots.offer_base?.unit ?? "").toLowerCase();
  const period = /year|år|annual|yr/.test(unit) ? "year" : /hour|tim/.test(unit) ? "hour" : "month";
  const base: OfferInput["base"] = isNum(raw) ? { amount: raw, period } : raw && typeof raw === "object" && !Array.isArray(raw) ? { period, ...(raw as object) } as OfferInput["base"] : undefined;
  const cb = monthlyFrom(s, "current_base", weeklyHours);
  const pay = slotValue<unknown>(s, "employer_pay_info");
  return {
    base, weeklyHours,
    variable: slotValue(s, "offer_variable"), pension: slotValue(s, "offer_pension"), vacation: slotValue(s, "offer_vacation"),
    benefits: slotValue(s, "offer_benefits"), equity: slotValue(s, "offer_equity"), notice_probation: slotValue(s, "offer_notice_probation"),
    current: cb !== undefined ? { base: cb, variable: slotValue(s, "current_variable"), package: slotValue(s, "current_package") } : undefined,
    payStatedVaguely: typeof pay === "string" && /competitive|konkurrens/i.test(pay),
  };
}
/** Runs the offer analyzer on the session. `total_comp_offer` is the table of parts plus a cash subtotal, never one mixed value (D69). */
export function runOfferTool(s: SessionState, today?: string): OfferAnalysis | { needs: string[] } { return analyzeOffer(offerInputFrom(s), { today }); }
