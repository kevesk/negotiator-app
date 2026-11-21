import { describe, it, expect } from "vitest";
import { normalise, anchorOptions, draftConcessionPlan, validatePlan, scorePackages, liteWeights, runChecks, zopaEstimate } from "@/engine";

describe("units", () => {
  it("yearly with 13 paid months", () => expect(normalise({ amount: 520000, period: "year", paidMonths: 13 }).monthlyGross).toBe(40000));
  it("yearly defaults to 12 and says so", () => { const r = normalise({ amount: 480000, period: "year" }); expect(r.monthlyGross).toBe(40000); expect(r.assumed).toContain("paid_months"); });
  it("hourly assumes 40h and returns the factor", () => { const r = normalise({ amount: 240, period: "hour" }); expect(r.factor).toBeCloseTo(173.333, 3); expect(r.assumed).toContain("weekly_hours"); });
});

describe("anchor options (D70)", () => {
  const t = { target: 50000, p75: 56000 };
  it("offers hold, halfway, at P75", () => expect(anchorOptions(t).map((o) => [o.id, o.amount])).toEqual([["hold", 50000], ["halfway", 53000], ["at_p75", 56000]]));
  it("halfway is an assumption until confirmed", () => expect(anchorOptions(t).find((o) => o.id === "halfway")!.assumed).toBe(true));
  it("only hold and own without P75", () => expect(anchorOptions({ target: 50000 }).map((o) => o.id)).toEqual(["hold"]));
  it("rounds halfway to 500 and never goes below target", () => expect(anchorOptions({ target: 50000, p75: 50200 }).find((o) => o.id === "halfway")!.amount).toBe(50000));
  it("own above P75 is flagged", () => expect(anchorOptions({ ...t, own: 58000 }).find((o) => o.id === "own")!.flags).toEqual(["anchor_above_p75"]));
  it("own below target is refused", () => expect(() => anchorOptions({ ...t, own: 49000 })).toThrow());
});

describe("concession plan (D71)", () => {
  it("gap 3,000 gives 1,500 / 900 / 600", () => expect(draftConcessionPlan(53000, 50000, 47000).steps.map((s) => s.amount)).toEqual([1500, 900, 600]));
  it("gap 2,500 gives 1,300 / 800 / 400, last absorbs rounding", () => expect(draftConcessionPlan(52500, 50000, 47000).steps.map((s) => s.amount)).toEqual([1300, 800, 400]));
  it("steps always sum to the gap and decrease", () => { for (let g = 500; g <= 20000; g += 100) { const s = draftConcessionPlan(50000 + g, 50000, 45000).steps.map((x) => x.amount); expect(s.reduce((a, b) => a + b, 0)).toBe(g); } });
  it("reserve is target down to walk-away, not planned", () => expect(draftConcessionPlan(53000, 50000, 47000).reserve).toEqual({ from: 50000, to: 47000 }));
  it("no gap, no steps", () => expect(draftConcessionPlan(50000, 50000, 47000).steps).toEqual([]));
  const good = [{ amount: 1500, inExchangeFor: "a" }, { amount: 900, inExchangeFor: "b" }, { amount: 600, inExchangeFor: "c" }].map((s) => ({ ...s, assumed: false }));
  it("accepts a valid plan", () => expect(validatePlan(53000, 50000, 47000, good).ok).toBe(true));
  it("rejects steps without a trade", () => expect(validatePlan(53000, 50000, 47000, [{ ...good[0]!, inExchangeFor: "" }, good[1]!, good[2]!]).errors).toContain("step_without_trade"));
  it("rejects non-decreasing steps", () => expect(validatePlan(53000, 50000, 47000, [good[1]!, good[0]!, good[2]!]).errors).toContain("steps_not_decreasing"));
  it("rejects landing below walk-away", () => expect(validatePlan(53000, 50000, 51000, good).errors).toContain("landing_below_walk_away"));
  it("flags a first step over half the gap", () => expect(validatePlan(53000, 50000, 47000, [{ amount: 2000, inExchangeFor: "a", assumed: false }, { amount: 700, inExchangeFor: "b", assumed: false }, { amount: 300, inExchangeFor: "c", assumed: false }]).flags).toContain("large_first_concession_risk"));
  it("never pads to four steps", () => expect(validatePlan(53000, 50000, 47000, [...good, good[2]!]).errors).toContain("steps_count"));
});

describe("package scoring", () => {
  const issues = [
    { id: "salary", weight: 60, kind: "numeric" as const, direction: "higher_better" as const, walkAwayLevel: 45000 },
    { id: "remote", weight: 40, kind: "rated" as const },
  ];
  it("scores linearly from walk-away (0) to best (100)", () => {
    const r = scorePackages(issues, [{ id: "A", values: { salary: 55000, remote: 50 } }, { id: "B", values: { salary: 50000, remote: 100 } }]);
    expect(r.ranking.map((p) => [p.id, p.score])).toEqual([["A", 80], ["B", 70]]);
  });
  it("removes packages below a walk-away level", () => {
    const r = scorePackages(issues, [{ id: "A", values: { salary: 55000, remote: 50 } }, { id: "B", values: { salary: 44000, remote: 100 } }]);
    expect(r.removed).toEqual([{ id: "B", issue: "salary" }]); expect(r.ranking).toHaveLength(1);
  });
  it("groups packages within 5 points as a tie", () => {
    const r = scorePackages(issues, [{ id: "A", values: { salary: 55000, remote: 50 } }, { id: "B", values: { salary: 54000, remote: 50 } }, { id: "C", values: { salary: 46000, remote: 0 } }]);
    expect(r.ranking.map((p) => p.tieGroup)).toEqual([0, 0, 1]);
  });
  it("rejects weights not summing to 100", () => expect(scorePackages([{ ...issues[0]!, weight: 50 }, issues[1]!], []).error).toBe("weights_sum_100"));
  it("lite weights", () => { expect(liteWeights(3)).toEqual([61, 28, 11]); expect(liteWeights(4)).toEqual([52, 27, 15, 6]); expect(liteWeights(5)).toBeUndefined(); });
  it("lower_better mirrors the scale", () => {
    const r = scorePackages([{ id: "days", weight: 100, kind: "numeric", direction: "lower_better", walkAwayLevel: 5 }], [{ id: "A", values: { days: 1 } }, { id: "B", values: { days: 3 } }]);
    expect(r.ranking.map((p) => [p.id, p.score])).toEqual([["A", 100], ["B", 50]]);
  });
});

describe("checks and overlap", () => {
  it("flags walk-away below BATNA", () => expect(runChecks({ walkAway: 40000, batnaMonthly: 42000 }).find((c) => c.id === "walk_away_not_below_batna")!.status).toBe("flag"));
  it("errors on walk-away above target", () => expect(runChecks({ walkAway: 52000, target: 50000 })[0]!.status).toBe("error"));
  it("skips P75 checks when no P75", () => expect(runChecks({ target: 50000, anchor: 60000 })).toEqual([]));
  it("flags anchor above P75 and offer below P25", () => { const c = runChecks({ market: { p25: 45000, p75: 56000 }, anchor: 58000, offer: 44000 }); expect(c.filter((x) => x.status === "flag").map((x) => x.id)).toEqual(["anchor_above_p75", "offer_below_p25"]); });
  it("overlap is never high confidence", () => expect(zopaEstimate({ walkAway: 47000, anchor: 53000, employer: { low: 48000, high: 56000, confidence: "high" } })).toEqual({ overlap: "positive", interval: [48000, 53000], confidence: "medium" }));
  it("no overlap", () => expect(zopaEstimate({ walkAway: 60000, anchor: 65000, employer: { low: 48000, high: 56000, confidence: "medium" } }).overlap).toBe("none"));
  it("unknown without a range", () => expect(zopaEstimate({ walkAway: 47000, anchor: 53000 }).overlap).toBe("unknown"));
});
