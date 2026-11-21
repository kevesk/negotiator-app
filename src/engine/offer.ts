// Offer analyzer (Offer-Analyzer-Spec, D69): parts beside base pay, never one mixed total. Deterministic; no model in the arithmetic.
import { employerCost } from "./tax";
import { normalise } from "./units";

export type OfferTag = "user" | "computed" | "assumed";
/** Pension agreements and 2026 rates (Pensionsmyndigheten via the vault note Occupational-Pension; valid_as_of 2026-11-21, verify before use). */
export const PENSION_RULES = {
  valid_as_of: "2026-11-21", ibb: 83_400,
  agreements: {
    "ITP1": { low: 4.5, high: 30, capIbb: 30 }, "SAF-LO": { low: 4.5, high: 30, capIbb: 30 },
    "KAP-KL": { low: 6, high: 31.5, capIbb: 30 }, "AKAP-KR": { low: 6, high: 31.5, capIbb: 30 }, "PA16": { low: 6.1, high: 31.6, capIbb: 30 },
  } as Record<string, { low: number; high: number; capIbb: number }>,
  definedBenefit: ["ITP2"],
};
export const VACATION = { statutoryDays: 25, supplementPct: 0.43 };
export const PROBATION_FLAG_MONTHS = 6;
export const NOTICE_FLAG_MONTHS = 3;

export interface OfferInput {
  base?: number | { amount: number; period?: "month" | "year" | "hour"; paid_months?: number } | string;
  weeklyHours?: number;
  variable?: unknown; pension?: unknown; vacation?: unknown; benefits?: unknown; equity?: unknown; notice_probation?: unknown;
  current?: { base?: number; variable?: unknown; package?: unknown };
  payStatedVaguely?: boolean;
}
export interface Part { part: string; facts: string; estimate_sek?: number; period?: "month" | "year"; tag?: OfferTag; estimate: boolean; unknown: boolean; question_to_ask?: string }
export interface OfferAnalysis {
  parts: Part[];
  cash_subtotal: { annual: number; basis: string; tag: OfferTag; monthly_base: number; paid_months: number };
  variable_outcomes?: { low: number; high: number; basis: string };
  terms: { probation: string; notice: string; non_compete: string; other: string };
  flags: { id: string; text_ref: string }[];
  open_questions: string[];
  comparison?: { part: string; offer: string; current: string }[];
  batna_candidate?: { which: "offer" | "current"; reason: string; needs_user_confirmation: true };
  /** Guaranteed cash of the current job, when given (yearly, 12 months assumed). */
  current_cash?: { base_annual: number; guaranteed_variable: number; annual: number };
  /** Set when other real offers were given: all offers (and the current job) side by side. */
  offers_comparison?: OffersComparison;
  assumptions: string[];
  boundaries: string;
}

export interface OffersComparison {
  columns: string[];
  rows: { part: string; values: string[] }[];
  /** The alternative with the highest guaranteed cash. Proposed only; the user confirms and decides how much the non-cash parts matter. */
  strongest_cash: { label: string; annual: number; reason: string; needs_user_confirmation: true };
  skipped: string[];
}
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const asObj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const text = (x: unknown): string => (typeof x === "string" ? x : x === undefined || x === null ? "" : JSON.stringify(x));
const lower = (x: unknown) => text(x).toLowerCase();
const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
const NONE = /^(none|no|nej|inga?|nothing|0)$|not (mentioned|included)|ingen|inget/i;
const UNKNOWN = /unknown|unsure|not sure|don'?t know|vet inte|oklart|unclear/i;

/** The agreement named in a pension answer, if any. */
export function pensionAgreement(x: unknown): string | undefined {
  const t = (isNum(x) ? "" : text(asObj(x).agreement ?? x)).toUpperCase().replace(/[\s_]/g, "");
  if (/ITP2/.test(t)) return "ITP2"; if (/ITP1?(?!\d)/.test(t) && /ITP/.test(t)) return "ITP1";
  if (/SAF-?LO/.test(t)) return "SAF-LO"; if (/AKAP-?KR/.test(t)) return "AKAP-KR"; if (/KAP-?KL/.test(t)) return "KAP-KL"; if (/PA-?16/.test(t)) return "PA16";
  return undefined;
}
/** Monthly pension premium in SEK for a monthly gross salary under an agreement's two-tier rule (computed estimate). */
export function pensionPremium(monthlyGross: number, a: { low: number; high: number; capIbb: number }): number {
  const ceil75 = (7.5 * PENSION_RULES.ibb) / 12, cap = (a.capIbb * PENSION_RULES.ibb) / 12;
  const lowPart = Math.min(monthlyGross, ceil75), highPart = Math.max(0, Math.min(monthlyGross, cap) - ceil75);
  return Math.round((lowPart * Math.round(a.low * 100) + highPart * Math.round(a.high * 100)) / 10000);
}

export function analyzeOffer(inp: OfferInput, o: { today?: string } = {}): OfferAnalysis | { needs: string[] } {
  const assumptions: string[] = []; const parts: Part[] = []; const flags: OfferAnalysis["flags"] = []; const open: string[] = [];
  // base pay
  const b = inp.base; let monthly: number | undefined; let paidMonths = 12;
  if (isNum(b)) monthly = b;
  else if (b && typeof b === "object") {
    paidMonths = isNum(b.paid_months) ? b.paid_months : 12;
    if (isNum(b.amount)) { const n = normalise({ amount: b.amount, period: b.period ?? "month", paidMonths: b.paid_months, weeklyHours: inp.weeklyHours }); monthly = n.monthlyGross; for (const a of n.assumed) assumptions.push(`${a} assumed (${a === "paid_months" ? "12" : "40"})`); }
  }
  if (monthly === undefined) return { needs: ["offer_base"] };
  if (!(b && typeof b === "object" && isNum(b.paid_months))) assumptions.push("12 paid months assumed unless the offer says otherwise");
  const baseAnnual = Math.round(monthly * paidMonths);
  parts.push({ part: "base", facts: `Monthly gross ${fmt(monthly)} SEK × ${paidMonths} paid months`, estimate_sek: baseAnnual, period: "year", tag: "computed", estimate: false, unknown: false });

  // variable pay: a range of outcomes, never an expected value, never valued at its maximum
  const v = inp.variable; const vo = asObj(v);
  let guaranteed = 0; let outcomes: OfferAnalysis["variable_outcomes"];
  if (v === undefined || (typeof v === "string" && NONE.test(v.trim()))) parts.push({ part: "variable", facts: "No variable pay stated", tag: "user", estimate: false, unknown: v === undefined, question_to_ask: v === undefined ? "Is there any bonus or commission? How is it calculated?" : undefined });
  else {
    if (isNum(vo.guaranteed_yearly)) guaranteed = vo.guaranteed_yearly;
    const max = isNum(vo.max_yearly) ? vo.max_yearly : isNum(v) ? v : undefined; const min = isNum(vo.min_yearly) ? vo.min_yearly : guaranteed;
    const basis = text(vo.description ?? vo.basis ?? (typeof v === "string" ? v : ""));
    if (max !== undefined) outcomes = { low: min, high: max, basis: basis || "stated yearly amount, reliability unknown" };
    const vague = max === undefined || (!basis && !isNum(vo.guaranteed_yearly));
    parts.push({ part: "variable", facts: max !== undefined ? `Outcomes from ${fmt(min)} to ${fmt(max)} SEK a year; only ${fmt(guaranteed)} treated as guaranteed${basis ? `. Scheme: ${basis}` : ""}` : `Scheme described: ${basis || "no detail"}`, tag: max !== undefined ? "user" : undefined, estimate: false, unknown: max === undefined, question_to_ask: "How is it calculated, who decides, what is the cap, and is any of it guaranteed? Does it count towards pension and vacation pay?" });
    if (vague || (max !== undefined && max > baseAnnual * 0.2 && guaranteed === 0 && !basis)) flags.push({ id: "variable_vague", text_ref: "A-Offer-Analysis" });
    if (vague) open.push("How the variable pay is calculated and capped");
  }
  const cashAnnual = baseAnnual + guaranteed;

  // pension
  const p = inp.pension; const po = asObj(p); const ag = pensionAgreement(p);
  let pensionRate: number | undefined;
  if (p === undefined || (typeof p === "string" && (NONE.test(p.trim()) || UNKNOWN.test(p)) && !ag)) {
    parts.push({ part: "pension", facts: p === undefined ? "Not mentioned in the offer" : text(p), tag: undefined, estimate: false, unknown: true, question_to_ask: "Which pension agreement applies, and how large is the premium, including above 7.5 income base amounts?" });
    flags.push({ id: "pension_missing", text_ref: "A-Offer-Analysis" }); open.push("Which pension agreement or contribution applies");
  } else if (ag === "ITP2") {
    parts.push({ part: "pension", facts: "ITP 2 (defined-benefit plan, plus a 2% premium); the yearly cost depends on age and cannot be estimated here", tag: "user", estimate: false, unknown: false, question_to_ask: "Confirm the ITP 2 terms and any premium on top." });
  } else if (ag && PENSION_RULES.agreements[ag]) {
    const rule = PENSION_RULES.agreements[ag]; const monthlyP = pensionPremium(monthly, rule);
    pensionRate = (monthlyP / monthly) * 100;
    parts.push({ part: "pension", facts: `${ag}: ${rule.low}% up to 7.5 income base amounts, ${rule.high}% above (rates valid ${PENSION_RULES.valid_as_of}, verify before use)`, estimate_sek: monthlyP * 12, period: "year", tag: "computed", estimate: true, unknown: false });
  } else if (isNum(po.monthly) || isNum(po.rate_pct) || isNum(p)) {
    const rate = isNum(po.rate_pct) ? po.rate_pct : isNum(p) && p <= 100 ? p : undefined;
    const m = isNum(po.monthly) ? po.monthly : rate !== undefined ? Math.round((monthly * Math.round(rate * 100)) / 10000) : undefined;
    pensionRate = rate ?? (m !== undefined ? (m / monthly) * 100 : undefined);
    parts.push({ part: "pension", facts: rate !== undefined ? `Stated contribution ${rate}% of salary` : `Stated contribution ${fmt(m ?? 0)} SEK a month`, estimate_sek: m !== undefined ? m * 12 : undefined, period: "year", tag: isNum(po.monthly) ? "user" : "computed", estimate: true, unknown: false });
  } else parts.push({ part: "pension", facts: text(p), estimate: false, unknown: true, tag: "user", question_to_ask: "Ask which agreement or percentage this is, in writing." });

  // vacation
  const vd = isNum(inp.vacation) ? inp.vacation : isNum(asObj(inp.vacation).days) ? (asObj(inp.vacation).days as number) : undefined;
  if (vd === undefined) parts.push({ part: "vacation", facts: `Not stated; the statutory minimum is ${VACATION.statutoryDays} days`, tag: "assumed", estimate: false, unknown: true, question_to_ask: "How many vacation days, and with which supplement?" });
  else {
    const sup = Math.round((monthly * Math.round(VACATION.supplementPct * 100) * vd) / 10000);
    parts.push({ part: "vacation", facts: `${vd} days (statutory minimum ${VACATION.statutoryDays}${vd > VACATION.statutoryDays ? `, ${vd - VACATION.statutoryDays} above` : ""}). Supplement at the statutory ${VACATION.supplementPct}% of monthly pay per day; agreements often set a higher rate`, estimate_sek: sup, period: "year", tag: "computed", estimate: true, unknown: false });
  }

  // benefits and equity: facts only
  const be = inp.benefits;
  parts.push(be === undefined || (typeof be === "string" && NONE.test(be.trim()))
    ? { part: "benefits", facts: be === undefined ? "Not stated" : "None", estimate: false, unknown: be === undefined, question_to_ask: be === undefined ? "Any wellness allowance, insurance, phone, car or remote setup? Which are taxable?" : undefined }
    : { part: "benefits", facts: Array.isArray(be) ? be.map(text).join("; ") : text(be), tag: "user", estimate: false, unknown: false, question_to_ask: "Which of these are taxable (förmån)?" });
  const eq = inp.equity; const eo = asObj(eq);
  if (eq !== undefined && !(typeof eq === "string" && NONE.test(eq.trim()))) {
    parts.push({ part: "equity", facts: `${text(eq)}. Base case valued at zero; any upside is shown separately and never added to pay`, tag: "user", estimate: false, unknown: false, question_to_ask: "What is the type, vesting schedule, strike price, and what happens when you leave?" });
    if (!(eo.vesting || /vest/i.test(text(eq))) || !(eo.valuation || /valu|strike|pris/i.test(text(eq)))) { flags.push({ id: "equity_unclear", text_ref: "A-Offer-Analysis" }); open.push("Vesting, strike price and any valuation information for the equity"); }
  }

  // terms
  const nt = asObj(inp.notice_probation); const ntText = typeof inp.notice_probation === "string" ? inp.notice_probation : "";
  // a number of months stated in a text, within a few words of a keyword (either order)
  const monthsNear = (kw: string): number | undefined => {
    const m = new RegExp(`(\\d+)\\s*(?:months?|mån\\w*)\\s*(?:of\\s+)?(?:${kw})|(?:${kw})\\D{0,20}?(\\d+)\\s*(?:months?|mån)`, "i").exec(ntText);
    return m ? Number(m[1] ?? m[2]) : undefined;
  };
  const probation = isNum(nt.probation_months) ? nt.probation_months : monthsNear("probation|prov\\w*");
  const notice = isNum(nt.notice_months) ? nt.notice_months : monthsNear("notice|uppsägning\\w*");
  const nonCompete = nt.non_compete !== undefined ? text(nt.non_compete) : /non-?compete|konkurrens/i.test(ntText) ? "mentioned" : "not stated";
  if (probation !== undefined && probation >= PROBATION_FLAG_MONTHS) flags.push({ id: "probation_long", text_ref: "A-Offer-Analysis" });
  const compensated = /compens|ersättning|paid/i.test(text(nt.non_compete)) || nt.non_compete_compensated === true;
  if ((notice !== undefined && notice >= NOTICE_FLAG_MONTHS) || (nonCompete !== "not stated" && !/^(none|no|nej)/i.test(nonCompete) && !compensated)) flags.push({ id: "notice_or_noncompete", text_ref: "A-Offer-Analysis" });
  const terms = { probation: probation !== undefined ? `${probation} months` : "not stated", notice: notice !== undefined ? `${notice} months` : "not stated", non_compete: nonCompete, other: ntText && probation === undefined && notice === undefined ? ntText : "" };
  if (inp.notice_probation === undefined) open.push("Probation period, notice period and any non-compete (and whether it is compensated)");
  if (inp.payStatedVaguely) flags.push({ id: "pay_vague", text_ref: "A-Offer-Analysis" });

  // employer cost (cash and pension parts only)
  const ec = employerCost(monthly + guaranteed / paidMonths, { pensionRate, today: o.today });
  parts.push({ part: "employer_cost", facts: `Estimated monthly cost to the employer for base${guaranteed ? " and guaranteed variable pay" : ""}: salary ${fmt(monthly + guaranteed / paidMonths)} + social contributions ${fmt(ec.contributions)}${pensionRate !== undefined ? ` + pension ${fmt(ec.pension)}` : ""} (special payroll tax on pension not included)`, estimate_sek: ec.total * 12, period: "year", tag: "computed", estimate: true, unknown: false });

  // comparison with the current package (cash only; stronger alternative is proposed, the user confirms)
  let comparison: OfferAnalysis["comparison"]; let batna: OfferAnalysis["batna_candidate"]; let current_cash: OfferAnalysis["current_cash"];
  const cur = inp.current;
  if (cur && isNum(cur.base)) {
    const cv = asObj(cur.variable); const curVar = isNum(cur.variable) ? cur.variable : isNum(cv.guaranteed_yearly) ? cv.guaranteed_yearly : 0;
    const curCash = Math.round(cur.base * 12 + curVar);
    comparison = [
      { part: "base (yearly)", offer: `${fmt(baseAnnual)} SEK`, current: `${fmt(cur.base * 12)} SEK (12 months assumed)` },
      { part: "variable (guaranteed)", offer: `${fmt(guaranteed)} SEK`, current: `${fmt(curVar)} SEK` },
      { part: "cash subtotal", offer: `${fmt(cashAnnual)} SEK`, current: `${fmt(curCash)} SEK` },
      { part: "pension / benefits / vacation", offer: "see parts", current: cur.package ? text(cur.package) : "unknown, ask" },
    ];
    current_cash = { base_annual: cur.base * 12, guaranteed_variable: curVar, annual: curCash };
    assumptions.push("current package compared on cash only; non-cash parts are for the user to weigh");
    const better = cashAnnual >= curCash ? "offer" : "current";
    batna = { which: better, reason: `${better === "offer" ? "The offer" : "The current job"} has the higher guaranteed cash (${fmt(Math.max(cashAnnual, curCash))} against ${fmt(Math.min(cashAnnual, curCash))} SEK a year); the user decides, since non-cash parts are not compared`, needs_user_confirmation: true };
  }

  return {
    parts, cash_subtotal: { annual: cashAnnual, basis: guaranteed ? "base pay plus guaranteed variable pay" : "base pay", tag: "computed", monthly_base: monthly, paid_months: paidMonths },
    variable_outcomes: outcomes, terms, flags: dedupe(flags), open_questions: open, comparison, batna_candidate: batna, current_cash, assumptions,
    boundaries: "Preparation support, not legal or financial advice. Estimates only; verify with the agreement and the employer.",
  };
}
const dedupe = (f: OfferAnalysis["flags"]) => f.filter((x, i) => f.findIndex((y) => y.id === x.id) === i);

const partText = (a: OfferAnalysis, n: string): string => { const p = a.parts.find((x) => x.part === n); if (!p) return "not stated"; if (p.unknown) return "unknown, ask"; return p.estimate_sek !== undefined ? `${fmt(p.estimate_sek)} SEK a year${p.estimate ? " (estimate)" : ""}` : p.facts; };
/** Side-by-side table for two or more offers, with the current job as a cash-only column. Parts stay separate; there is no total (D69). */
export function compareOffers(entries: { label: string; analysis: OfferAnalysis }[], skipped: string[] = []): OffersComparison {
  const cur = entries[0]?.analysis.current_cash;
  const columns = [...entries.map((e) => e.label), ...(cur ? ["Current job"] : [])];
  const row = (part: string, f: (a: OfferAnalysis) => string, curVal?: string) => ({ part, values: [...entries.map((e) => f(e.analysis)), ...(cur ? [curVal ?? "unknown, ask"] : [])] });
  const rows = [
    row("Base pay (yearly)", (a) => `${fmt(a.cash_subtotal.monthly_base * a.cash_subtotal.paid_months)} SEK`, cur ? `${fmt(cur.base_annual)} SEK` : undefined),
    row("Guaranteed variable pay", (a) => { const g = a.cash_subtotal.annual - a.cash_subtotal.monthly_base * a.cash_subtotal.paid_months; return `${fmt(g)} SEK`; }, cur ? `${fmt(cur.guaranteed_variable)} SEK` : undefined),
    row("Cash subtotal", (a) => `${fmt(a.cash_subtotal.annual)} SEK`, cur ? `${fmt(cur.annual)} SEK` : undefined),
    row("Variable pay range", (a) => (a.variable_outcomes ? `${fmt(a.variable_outcomes.low)} to ${fmt(a.variable_outcomes.high)} SEK` : "none stated")),
    row("Pension", (a) => partText(a, "pension")), row("Vacation", (a) => partText(a, "vacation")),
    row("Benefits", (a) => partText(a, "benefits")), row("Equity", (a) => (a.parts.some((p) => p.part === "equity") ? "stated, valued at zero" : "none stated")),
    row("Probation", (a) => a.terms.probation), row("Notice period", (a) => a.terms.notice), row("Non-compete", (a) => a.terms.non_compete),
    row("Red flags", (a) => (a.flags.length ? a.flags.map((f) => f.id).join(", ") : "none")),
  ];
  const all = [...entries.map((e) => ({ label: e.label, annual: e.analysis.cash_subtotal.annual })), ...(cur ? [{ label: "Current job", annual: cur.annual }] : [])];
  const best = all.reduce((m, x) => (x.annual > m.annual ? x : m));
  return { columns, rows, skipped, strongest_cash: { label: best.label, annual: best.annual, reason: `${best.label} has the highest guaranteed cash (${fmt(best.annual)} SEK a year). The non-cash parts are not compared; the user decides how much they matter`, needs_user_confirmation: true } };
}
