import { describe, it, expect } from "vitest";
import { analyzeOffer, pensionPremium, PENSION_RULES, type OfferAnalysis } from "@/engine";
import { runTurn, newState, setSlot, type ChatModel } from "@/orchestrator";
import { runOfferTool, offerInputFrom } from "@/orchestrator/offer";

const ok = (r: ReturnType<typeof analyzeOffer>): OfferAnalysis => { if ("needs" in r) throw new Error("needs " + r.needs); return r; };
const part = (a: OfferAnalysis, n: string) => a.parts.find((p) => p.part === n)!;
const flagIds = (a: OfferAnalysis) => a.flags.map((f) => f.id);

describe("offer analyzer", () => {
  it("a complete offer: parts beside base, cash subtotal, no mixed total", () => {
    const a = ok(analyzeOffer({ base: 50000, variable: { guaranteed_yearly: 30000, min_yearly: 30000, max_yearly: 90000, description: "yearly bonus on company results, capped" }, pension: { agreement: "ITP1" }, vacation: 27, benefits: ["wellness 5 000 a year"], notice_probation: { probation_months: 3, notice_months: 2, non_compete: "none" } }));
    expect(a.cash_subtotal.annual).toBe(630000); expect(a.cash_subtotal.basis).toContain("guaranteed");
    expect(part(a, "pension").estimate_sek).toBe(pensionPremium(50000, PENSION_RULES.agreements["ITP1"]!) * 12); expect(part(a, "pension").estimate_sek).toBe(27000);
    expect(part(a, "vacation").estimate_sek).toBe(5805); expect(a.variable_outcomes).toMatchObject({ low: 30000, high: 90000 });
    expect(a.flags).toEqual([]); expect(JSON.stringify(a)).not.toMatch(/total_value|expected/i);
  });
  it("pension above 7.5 income base amounts uses the higher rate", () => { expect(pensionPremium(60000, PENSION_RULES.agreements["ITP1"]!)).toBe(4708); expect(pensionPremium(40000, PENSION_RULES.agreements["ITP1"]!)).toBe(1800); });
  it("missing pension is unknown and flagged, never guessed", () => {
    const a = ok(analyzeOffer({ base: 45000 })); expect(part(a, "pension")).toMatchObject({ unknown: true }); expect(part(a, "pension").estimate_sek).toBeUndefined(); expect(flagIds(a)).toContain("pension_missing"); expect(a.open_questions.join()).toContain("pension");
  });
  it("a bonus-heavy offer with no guarantee is flagged and the cash subtotal ignores it", () => {
    const a = ok(analyzeOffer({ base: 40000, variable: { max_yearly: 200000 }, pension: { agreement: "ITP1" } })); expect(a.cash_subtotal.annual).toBe(480000); expect(flagIds(a)).toContain("variable_vague");
  });
  it("equity is never valued and vague equity is flagged", () => {
    const a = ok(analyzeOffer({ base: 40000, pension: "ITP1", equity: "options, some number" })); expect(part(a, "equity").estimate_sek).toBeUndefined(); expect(flagIds(a)).toContain("equity_unclear");
    expect(flagIds(ok(analyzeOffer({ base: 40000, pension: "ITP1", equity: "stock options, 4 year vesting, strike and valuation from last round" })))).not.toContain("equity_unclear");
  });
  it("an hourly offer is converted with the assumption listed; 13 paid months is respected", () => {
    const h = ok(analyzeOffer({ base: { amount: 300, period: "hour" }, weeklyHours: 40, pension: "SAF-LO" })); expect(h.cash_subtotal.monthly_base).toBe(52000); expect(h.assumptions.join()).toContain("12 paid months assumed");
    const t = ok(analyzeOffer({ base: { amount: 40000, paid_months: 13 }, pension: "ITP1" })); expect(t.cash_subtotal.annual).toBe(520000); expect(t.assumptions.join()).not.toContain("12 paid months");
  });
  it("long probation, long notice and an uncompensated non-compete are flagged", () => {
    const a = ok(analyzeOffer({ base: 40000, pension: "ITP1", notice_probation: "6 months probation, notice 3 months, non-compete 12 months" })); expect(flagIds(a)).toEqual(expect.arrayContaining(["probation_long", "notice_or_noncompete"]));
    expect(a.terms.probation).toBe("6 months");
  });
  it("ITP 2 is facts only, vague pay is flagged, needs base", () => {
    expect(part(ok(analyzeOffer({ base: 50000, pension: "ITP2" })), "pension").estimate_sek).toBeUndefined();
    expect(flagIds(ok(analyzeOffer({ base: 50000, pension: "ITP1", payStatedVaguely: true })))).toContain("pay_vague");
    expect(analyzeOffer({})).toEqual({ needs: ["offer_base"] });
  });
  it("compares with the current job on cash and only proposes the fallback option", () => {
    const a = ok(analyzeOffer({ base: 50000, pension: "ITP1", current: { base: 45000 } })); expect(a.comparison?.find((c) => c.part === "cash subtotal")).toMatchObject({ offer: "600 000 SEK", current: "540 000 SEK" }); expect(a.batna_candidate).toMatchObject({ which: "offer", needs_user_confirmation: true });
  });
  it("employer cost is an estimate of cash and pension only", () => { const a = ok(analyzeOffer({ base: 50000, pension: { agreement: "ITP1" } })); expect(part(a, "employer_cost")).toMatchObject({ estimate: true, tag: "computed" }); });
});

describe("offer analyzer in the turn loop", () => {
  const fill = () => { const s = newState("en"); const set = (k: string, v: unknown, u?: string) => setSlot(s, k, v, "user", { unit: u });
    set("path", "A"); set("a_phase", "offer_received"); set("offer_base", 600000, "year"); set("offer_variable", "none"); set("offer_pension", { agreement: "ITP1" }); set("offer_vacation", 25); set("offer_benefits", "none"); return s; };
  it("reads a yearly base from the slot unit", () => { const a = ok(runOfferTool(fill())); expect(a.cash_subtotal.monthly_base).toBe(50000); expect(offerInputFrom(fill()).base).toMatchObject({ period: "year" }); });
  it("runs once the position gate is met and stores the analysis for the coach", async () => {
    const s = fill(); for (const [k, v] of Object.entries({ role_title: "Analyst", experience_years: 3, industry: "Banking", employer_type: "private", location: "Linköping", work_mode: "hybrid", employment_terms: "permanent full-time", offer_deadline: "2026-12-05" })) setSlot(s, k, v, "user");
    let seen = ""; const model: ChatModel = { async complete(r) { if (r.purpose === "extract") return "{}"; seen = r.system; return "Here is how the offer breaks down.\n- Base 50 000 per month"; } };
    const r = await runTurn({ model }, s, "ok");
    expect(r.usedFallback).toBe(false); expect(r.state.outputs.offer_analysis).toBeTruthy(); expect(seen).toContain("Offer analysis is ready"); expect(r.state.slots.total_comp_offer?.source).toBe("computed");
  });
});

describe("two offers side by side", () => {
  const withOthers = () => { const s = newState("en"); const set = (k: string, v: unknown, u?: string) => setSlot(s, k, v, "user", { unit: u });
    set("offer_base", 50000); set("offer_pension", { agreement: "ITP1" }); set("offer_vacation", 25); set("current_base", 45000);
    set("other_offers", [{ employer: "Beta AB", status: "offer", package: { base: 54000, variable: { guaranteed_yearly: 20000, max_yearly: 60000, description: "bonus" }, pension: { agreement: "SAF-LO" }, vacation: 30, notice_probation: { probation_months: 6, notice_months: 3, non_compete: "12 months" } } }, { employer: "Gamma", status: "process" }]); return s; };
  it("builds one table with a column per offer and the current job, with no total", () => {
    const a = ok(runOfferTool(withOthers())); const c = a.offers_comparison!;
    expect(c.columns).toEqual(["Offer 1", "Beta AB", "Current job"]); expect(c.skipped).toEqual(["Gamma"]);
    const cash = c.rows.find((r) => r.part === "Cash subtotal")!; expect(cash.values).toEqual(["600 000 SEK", "668 000 SEK", "540 000 SEK"]);
    expect(c.rows.find((r) => r.part === "Vacation")!.values[1]).toContain("SEK");
    expect(c.rows.find((r) => r.part === "Red flags")!.values[1]).toContain("probation_long"); expect(JSON.stringify(c).toLowerCase()).not.toContain("total value");
  });
  it("proposes the strongest cash alternative but never decides", () => { const c = ok(runOfferTool(withOthers())).offers_comparison!; expect(c.strongest_cash).toMatchObject({ label: "Beta AB", annual: 668000, needs_user_confirmation: true }); expect(c.strongest_cash.reason).toContain("user decides"); });
  it("without other offers there is no comparison table", () => { const s = withOthers(); setSlot(s, "other_offers", [], "user"); expect(ok(runOfferTool(s)).offers_comparison).toBeUndefined(); });
});
