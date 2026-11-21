import { analyzeOffer, compareOffers, normalise, type OfferAnalysis, type OfferInput } from "@/engine";
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
/** Other real offers from the `other_offers` slot: items with a stated base are analysed; processes without numbers are listed as skipped. */
export function otherOffersFrom(s: SessionState): { offers: { label: string; input: OfferInput }[]; skipped: string[] } {
  const raw = slotValue<unknown>(s, "other_offers"); const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const offers: { label: string; input: OfferInput }[] = []; const skipped: string[] = [];
  list.forEach((it, i) => {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, any>; const pkg = (o.package && typeof o.package === "object" ? o.package : o) as Record<string, any>;
    const label = typeof o.employer === "string" && o.employer ? o.employer : `Offer ${i + 2}`;
    const b = pkg.base;
    if (isNum(b) || (b && typeof b === "object" && isNum(b.amount))) offers.push({ label, input: { base: isNum(b) ? { amount: b, period: /year|år|annual/i.test(String(pkg.unit ?? pkg.period ?? "")) ? "year" : "month" } : b, weeklyHours: offerInputFrom(s).weeklyHours, variable: pkg.variable, pension: pkg.pension, vacation: pkg.vacation, benefits: pkg.benefits, equity: pkg.equity, notice_probation: pkg.notice_probation } });
    else skipped.push(label);
  });
  return { offers, skipped };
}
/** Runs the offer analyzer on the session. `total_comp_offer` is the table of parts plus a cash subtotal, never one mixed value (D69). With other real offers, a side-by-side comparison is added. */
export function runOfferTool(s: SessionState, today?: string): OfferAnalysis | { needs: string[] } {
  const first = analyzeOffer(offerInputFrom(s), { today }); if ("needs" in first) return first;
  const { offers, skipped } = otherOffersFrom(s);
  if (offers.length) {
    const others = offers.map((o) => ({ label: o.label, analysis: analyzeOffer(o.input, { today }) })).filter((x): x is { label: string; analysis: OfferAnalysis } => !("needs" in x.analysis));
    if (others.length) first.offers_comparison = compareOffers([{ label: "Offer 1", analysis: first }, ...others], skipped);
  }
  return first;
}
