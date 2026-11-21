import { roundTo } from "./types";
export interface NormaliseInput {
  amount: number;
  period: "month" | "year" | "hour";
  paidMonths?: number;   // default 12
  weeklyHours?: number;  // default 40, tagged assumed
}
export interface NormaliseResult { monthlyGross: number; factor: number; assumed: string[] }
/** Converts yearly or hourly pay to monthly gross SEK (spec: Units). */
export function normalise(i: NormaliseInput): NormaliseResult {
  const assumed: string[] = [];
  if (!(i.amount >= 0)) throw new Error("amount must be a non-negative number");
  if (i.period === "month") return { monthlyGross: i.amount, factor: 1, assumed };
  if (i.period === "year") {
    const months = i.paidMonths ?? 12;
    if (i.paidMonths === undefined) assumed.push("paid_months");
    return { monthlyGross: i.amount / months, factor: 1 / months, assumed };
  }
  let hours = i.weeklyHours;
  if (hours === undefined) { hours = 40; assumed.push("weekly_hours"); }
  const factor = (hours * 52) / 12;
  return { monthlyGross: i.amount * factor, factor, assumed };
}
export { roundTo };
