import data from "../../data/tax/tax-2026.json";

export interface TaxData {
  meta: { income_year: number; column: number; retrieved_on: string };
  params: {
    national_average_rate: number; employer_contribution: number; valid_as_of: string;
    reduced_contribution: { rate: number; monthly_cap: number; birth_years: [number, number]; from: string; to: string };
  };
  tables: Record<string, { bands: [number, number, number][]; pct: [number, number | null, number][] }>;
  municipalities: Record<string, number>;
}
export const TAX_2026 = data as unknown as TaxData;

export type RateBasis = "municipality" | "national_average";
export interface TableChoice { table: number; rate: number; rateBasis: RateBasis }

const normName = (s: string) => s.trim().toLocaleUpperCase("sv-SE");

/**
 * Picks the table: the municipal rate excluding church fee (municipal + regional + burial fee),
 * rounded to the nearest whole percent. Without a municipality, the national average (estimate).
 * Rounding rule: Skatteverket's text does not spell it out; see Open-Questions.
 */
export function chooseTable(municipality: string | undefined, d: TaxData = TAX_2026): TableChoice {
  let rate = d.params.national_average_rate, rateBasis: RateBasis = "national_average";
  if (municipality) {
    const r = d.municipalities[normName(municipality)];
    if (r === undefined) throw new Error(`unknown_municipality: ${municipality}`);
    rate = r; rateBasis = "municipality";
  }
  const table = Math.min(42, Math.max(29, Math.round(rate)));
  return { table, rate, rateBasis };
}

/** Monthly preliminary tax (column 1) for a whole-krona monthly gross. Öretal are dropped. */
export function monthlyTax(gross: number, table: number, d: TaxData = TAX_2026): number {
  const t = d.tables[String(table)];
  if (!t) throw new Error(`no table ${table}`);
  const g = Math.floor(gross);
  if (g < 1) return 0;
  if (g <= 80000) {
    // bands are contiguous 1..80000
    let lo = 0, hi = t.bands.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; const [a, b, tax] = t.bands[mid]!;
      if (g < a) hi = mid - 1; else if (g > b) lo = mid + 1; else return tax;
    }
    throw new Error("band not found");
  }
  const row = t.pct.find(([a, b]) => g >= a && (b === null || g <= b));
  if (!row) throw new Error("percent row not found");
  return Math.floor((g * row[2]) / 100); // percentage of the whole pay
}

export interface NetResult {
  gross: number; tax: number; net: number; table: number; rate: number; rateBasis: RateBasis;
  estimate: true; incomeYear: number; validAsOf: string; staleTaxYear: boolean;
}
export function netEstimate(gross: number, opts: { municipality?: string; today?: string } = {}, d: TaxData = TAX_2026): NetResult {
  const c = chooseTable(opts.municipality, d);
  const tax = monthlyTax(gross, c.table, d);
  const todayYear = opts.today ? Number(opts.today.slice(0, 4)) : d.meta.income_year;
  return {
    gross, tax, net: Math.floor(gross) - tax, ...c, estimate: true,
    incomeYear: d.meta.income_year, validAsOf: d.params.valid_as_of, staleTaxYear: todayYear > d.meta.income_year,
  };
}
/** Extra net pay for an extra gross amount, from the same table. */
export function marginalNet(gross: number, delta: number, opts: { municipality?: string } = {}, d: TaxData = TAX_2026): number {
  return netEstimate(gross + delta, opts, d).net - netEstimate(gross, opts, d).net;
}
/** Marginal tax rate over a 1,000 SEK step (spec: bonus and benefits). */
export function marginalRate(gross: number, opts: { municipality?: string } = {}, d: TaxData = TAX_2026): number {
  return 1 - marginalNet(gross, 1000, opts, d) / 1000;
}
/** Net value of a one-off bonus or taxable benefit: amount x (1 - marginal rate). Estimate. */
export function oneOffNet(amount: number, gross: number, opts: { municipality?: string } = {}, d: TaxData = TAX_2026): { net: number; marginalRate: number; estimate: true } {
  const mr = marginalRate(gross, opts, d);
  return { net: Math.round(amount * (1 - mr)), marginalRate: mr, estimate: true };
}
/** Smallest gross (whole SEK) giving at least the wanted net. Estimate; search is bounded. */
export function grossForNet(net: number, opts: { municipality?: string } = {}, d: TaxData = TAX_2026): number {
  let lo = Math.max(1, Math.floor(net)), hi = Math.ceil(net * 2.5) + 1000;
  while (netEstimate(hi, opts, d).net < net) hi *= 2;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (netEstimate(mid, opts, d).net >= net) hi = mid; else lo = mid + 1; }
  return lo;
}

export interface EmployerCost { contributions: number; pension: number; total: number; estimate: true; reducedApplied: boolean }
/** Employer cost estimate: gross + contributions + pension at the supplied rate (percent). */
export function employerCost(gross: number, o: { pensionRate?: number; birthYear?: number; today?: string } = {}, d: TaxData = TAX_2026): EmployerCost {
  const p = d.params; const red = p.reduced_contribution;
  const inWindow = !!o.today && o.today >= red.from && o.today <= red.to;
  const reduced = o.birthYear !== undefined && o.birthYear >= red.birth_years[0] && o.birthYear <= red.birth_years[1] && inWindow;
  // integer basis points avoid floating-point rounding surprises
  const bp = (r: number) => Math.round(r * 100);
  const contributions = reduced
    ? (Math.min(gross, red.monthly_cap) * bp(red.rate) + Math.max(0, gross - red.monthly_cap) * bp(p.employer_contribution)) / 10000
    : (gross * bp(p.employer_contribution)) / 10000;
  const pension = (gross * bp(o.pensionRate ?? 0)) / 10000;
  return { contributions: Math.round(contributions), pension: Math.round(pension), total: Math.round(gross + contributions + pension), estimate: true, reducedApplied: reduced };
}
