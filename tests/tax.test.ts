import { describe, it, expect } from "vitest";
import { TAX_2026, chooseTable, monthlyTax, netEstimate, marginalNet, marginalRate, oneOffNet, grossForNet, employerCost } from "@/engine";

// Golden values read from Skatteverket's monthly tables 2026, column 1 (table 32 values also
// cross-checked against Skatteverket's separate PDF for table 32).
describe("table choice", () => {
  it("Linköping (32.042%) uses table 32", () => expect(chooseTable("Linköping")).toMatchObject({ table: 32, rateBasis: "municipality", rate: 32.042 }));
  it("is case-insensitive and handles åäö", () => expect(chooseTable("  linköping ").table).toBe(32));
  it("Stockholm (30.62%) uses table 31", () => expect(chooseTable("Stockholm").table).toBe(31));
  it("no municipality: national average 32.38 -> table 32, labelled", () => expect(chooseTable(undefined)).toMatchObject({ table: 32, rate: 32.38, rateBasis: "national_average" }));
  it("unknown municipality throws", () => expect(() => chooseTable("Atlantis")).toThrow(/unknown_municipality/));
  it("covers all 290 municipalities with a table 29-42", () => { for (const m of Object.keys(TAX_2026.municipalities)) { const t = chooseTable(m).table; expect(t).toBeGreaterThanOrEqual(29); expect(t).toBeLessThanOrEqual(42); } expect(Object.keys(TAX_2026.municipalities)).toHaveLength(290); });
});

describe("monthly tax, table 32 column 1", () => {
  it.each([[1, 0], [2000, 0], [2001, 150], [40000, 8151], [50000, 11351], [60000, 15544]])("gross %i -> tax %i", (g, t) => expect(monthlyTax(g, 32)).toBe(t));
  it("band edges", () => { expect(monthlyTax(49801, 32)).toBe(11351); expect(monthlyTax(50001, 32)).toBe(monthlyTax(50100, 32)); });
  it("above 80,000 the percentage applies to the whole pay, öretal dropped", () => {
    expect(monthlyTax(80001, 32)).toBe(Math.floor((80001 * 32) / 100));
    expect(monthlyTax(100000, 32)).toBe(36000);
  });
  it("the published table drops at 80,001 (percent rows are whole percentages)", () => expect(monthlyTax(80001, 32) - monthlyTax(80000, 32)).toBe(-344));
  it("the open-ended top row works", () => expect(monthlyTax(5_000_000, 32)).toBeGreaterThan(0));
  it("fractional gross is floored", () => expect(monthlyTax(50000.9, 32)).toBe(11351));
});

describe("net estimate", () => {
  it("50,000 gross in Linköping", () => expect(netEstimate(50000, { municipality: "Linköping" })).toMatchObject({ tax: 11351, net: 38649, table: 32, rateBasis: "municipality", estimate: true, incomeYear: 2026 }));
  it("without municipality says national average", () => expect(netEstimate(50000).rateBasis).toBe("national_average"));
  it("flags a stale tax year", () => { expect(netEstimate(50000, { today: "2027-01-15" }).staleTaxYear).toBe(true); expect(netEstimate(50000, { today: "2026-11-21" }).staleTaxYear).toBe(false); });
  it("net at the top of each band is monotone above 10,000", () => { let prev = 0; for (const [lo, hi] of TAX_2026.tables["32"]!.bands) { if (lo < 10001) continue; const n = netEstimate(hi).net; expect(n).toBeGreaterThanOrEqual(prev); prev = n; } });
  it("within a band the estimate is flat (the table is a step function)", () => expect(monthlyTax(50000, 32)).toBe(monthlyTax(49801, 32)));
  it("marginal net never exceeds the extra gross", () => { for (const g of [20000, 35000, 50000, 75000, 90000, 150000]) { const m = marginalNet(g, 1000); expect(m).toBeLessThanOrEqual(1000); expect(m).toBeGreaterThan(0); } });
  it("marginal rate is between 0 and 1", () => { const r = marginalRate(50000); expect(r).toBeGreaterThan(0.2); expect(r).toBeLessThan(0.6); });
  it("one-off net = amount x (1 - marginal rate)", () => { const r = oneOffNet(10000, 50000); expect(r.net).toBe(Math.round(10000 * (1 - r.marginalRate))); expect(r.estimate).toBe(true); });
  it("gross for a net round-trips", () => { const g = grossForNet(38649); expect(netEstimate(g).net).toBeGreaterThanOrEqual(38649); expect(netEstimate(g - 1).net).toBeLessThan(38649); });
});

describe("employer cost", () => {
  it("standard 31.42% plus pension", () => expect(employerCost(50000, { pensionRate: 4.5 })).toMatchObject({ contributions: 15710, pension: 2250, total: 67960, reducedApplied: false }));
  it("reduced rate only with birth year 2003-2007 inside the window", () => {
    const r = employerCost(30000, { birthYear: 2004, today: "2026-11-21" });
    expect(r.reducedApplied).toBe(true); expect(r.contributions).toBe(6774);
    expect(employerCost(30000, { birthYear: 2004, today: "2027-10-01" }).reducedApplied).toBe(false);
    expect(employerCost(30000, { birthYear: 2001, today: "2026-11-21" }).reducedApplied).toBe(false);
    expect(employerCost(30000, { today: "2026-11-21" }).reducedApplied).toBe(false);
  });
});
