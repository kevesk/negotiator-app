import { roundTo } from "./types";
export interface PlanStep { amount: number; inExchangeFor?: string; assumed: boolean }
export interface ConcessionPlan {
  landing: number; gap: number; reserve: { from: number; to: number } | null;
  steps: PlanStep[]; flags: string[];
}
const SPLIT = [0.5, 0.3, 0.2];
const UNIT = 100;
/** Draft plan (D71): three decreasing steps, 50/30/20 of the gap, last absorbs rounding. */
export function draftConcessionPlan(anchor: number, target: number, walkAway: number): ConcessionPlan {
  if (anchor < target) throw new Error("anchor_below_target");
  const gap = anchor - target;
  const reserve = target > walkAway ? { from: target, to: walkAway } : null;
  if (gap === 0) return { landing: target, gap, reserve, steps: [], flags: [] };
  const first = roundTo(gap * SPLIT[0]!, UNIT);
  const second = roundTo(gap * SPLIT[1]!, UNIT);
  const third = gap - first - second;
  return {
    landing: target, gap, reserve,
    steps: [first, second, third].map((amount) => ({ amount, assumed: true })),
    flags: [],
  };
}
/** Checks a user-edited plan (D71). Returns error ids; empty means acceptable. */
export function validatePlan(anchor: number, landing: number, walkAway: number, steps: PlanStep[]) {
  const errors: string[] = []; const flags: string[] = [];
  const gap = anchor - landing;
  if (steps.length < 2 || steps.length > 3) errors.push("steps_count");
  if (steps.some((s) => !s.inExchangeFor?.trim())) errors.push("step_without_trade");
  for (let i = 1; i < steps.length; i++) if (!(steps[i]!.amount < steps[i - 1]!.amount)) { errors.push("steps_not_decreasing"); break; }
  if (landing < walkAway) errors.push("landing_below_walk_away");
  if (steps.reduce((a, s) => a + s.amount, 0) !== gap) errors.push("steps_sum_not_gap");
  if (steps[0] && steps[0].amount > gap / 2) flags.push("large_first_concession_risk");
  return { ok: errors.length === 0, errors, flags };
}
