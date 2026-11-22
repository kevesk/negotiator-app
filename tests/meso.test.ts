import { describe, it, expect } from "vitest";
import { buildPackages, weightsFromSlot, normaliseWeights, type MesoResult } from "@/engine";

const W = [{ label: "Base salary", weight: 40 }, { label: "Remote work", weight: 20 }, { label: "Vacation", weight: 15 }, { label: "Training budget", weight: 15 }, { label: "Pension", weight: 10 }];
const run = (w = W, extra = {}) => buildPackages({ weights: w, target: 45000, walkAway: 40000, ...extra }) as MesoResult;

describe("MESO package builder", () => {
  it("builds three packages that are worth about the same to the user", () => {
    const r = run(); expect(r.packages.length).toBe(3); expect(r.spread).toBeLessThanOrEqual(4); expect(r.sameValue).toBe(true);
    expect(r.packages.every((p) => p.score >= 50)).toBe(true);
  });
  it("the packages really differ: every pair differs on at least three items, and on one by two steps", () => {
    const r = run();
    for (let a = 0; a < r.packages.length; a++) for (let b = a + 1; b < r.packages.length; b++) {
      const A = r.packages[a]!.items, B = r.packages[b]!.items;
      expect(A.filter((x, i) => x.level !== B[i]!.level).length).toBeGreaterThanOrEqual(3);
      expect(A.some((x, i) => Math.abs(x.level - B[i]!.level) === 2)).toBe(true);
      expect(r.packages[a]!.items.map((i) => i.text).join()).not.toBe(r.packages[b]!.items.map((i) => i.text).join());
    }
  });
  it("base pay levels sit between the walk-away and the target", () => {
    const r = run(); const sal = r.packages.map((p) => Number(p.items.find((i) => i.issue === "base")!.text.match(/(\d[\d ]+)/)![1]!.replace(/ /g, "")));
    for (const x of sal) { expect(x).toBeGreaterThan(40000); expect(x).toBeLessThanOrEqual(45000); }
    expect(new Set(sal).size).toBeGreaterThan(1); // salary is not the same in every package
  });
  it("two items give two packages", () => { const r = run([{ label: "Base salary", weight: 70 }, { label: "Remote work", weight: 30 }]); expect(r.packages.length).toBeGreaterThanOrEqual(2); });
  it("works without base salary and without figures", () => { const r = buildPackages({ weights: [{ label: "Vacation", weight: 50 }, { label: "Training", weight: 30 }, { label: "Remote", weight: 20 }] }) as MesoResult; expect(r.packages.length).toBeGreaterThanOrEqual(2); expect(r.basis).toContain("no base salary"); });
  it("unknown items still get packages, and Swedish text is used", () => {
    const r = buildPackages({ weights: [{ label: "Lön", weight: 50 }, { label: "Semester", weight: 30 }, { label: "Tjänstebil", weight: 20 }], target: 45000, walkAway: 40000, lang: "sv" }) as MesoResult;
    expect(r.packages.length).toBeGreaterThanOrEqual(2); expect(r.packages[0]!.items.some((i) => /kr i månaden/.test(i.text))).toBe(true); expect(r.packages[0]!.items.some((i) => /semesterdagar/.test(i.text))).toBe(true);
  });
  it("needs at least two items", () => { expect(buildPackages({ weights: [{ label: "Base salary", weight: 100 }] })).toEqual({ needs: ["issue_weights"] }); });
  it("normalises weights to 100 and keeps six items", () => {
    const n = normaliseWeights(Array.from({ length: 8 }, (_, i) => ({ label: `i${i}`, weight: 10 + i })));
    expect(n.length).toBe(6); expect(n.reduce((a, b) => a + b.weight, 0)).toBe(100);
  });
  it("reads weights from a map or a list", () => {
    expect(weightsFromSlot({ base_salary: 50, remote: 50 }).length).toBe(2);
    expect(weightsFromSlot([{ item: "Vacation", points: 30 }, { issue: "Pension", weight: "70" }])).toEqual([{ label: "Vacation", weight: 30 }, { label: "Pension", weight: 70 }]);
    expect(weightsFromSlot("nothing")).toEqual([]);
  });
  it("is deterministic", () => { expect(JSON.stringify(run())).toBe(JSON.stringify(run())); });
  it("always returns a choice for two to six items, however uneven the points", () => {
    const L = ["Base salary", "Remote work", "Vacation", "Training budget", "Pension", "Bonus"]; let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 80; t++) { const n = 2 + Math.floor(rnd() * 5); const r = buildPackages({ weights: L.slice(0, n).map((label) => ({ label, weight: 5 + Math.floor(rnd() * 60) })), target: 45000, walkAway: 40000 }); expect("needs" in r).toBe(false); }
  });
});
