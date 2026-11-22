import { describe, it, expect } from "vitest";
import data from "../evals/cases.generated.json";
import { interpretSetup, prepareState, judgeReply, runCase, ruleChecks, evaluateGate, staleNotes, report, REPEATS, type EvalCase, type RunResult } from "../evals/harness";
import { workPlan, type ChatModel } from "@/orchestrator";

const cases = data.cases as unknown as EvalCase[];
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe("case file", () => {
  it("holds the 76 written cases with their severities", () => {
    expect(cases).toHaveLength(76); const n = (s: string) => cases.filter((c) => c.severity === s).length; expect([n("critical"), n("major"), n("minor")]).toEqual([19, 48, 9]);
    expect(new Set(cases.map((c) => c.id)).size).toBe(76); for (const c of cases) { expect(c.must.length).toBeGreaterThan(0); expect(c.check.length).toBeGreaterThan(0); }
  });
  it("critical cases run five times, major twice, minor once", () => expect(REPEATS).toEqual({ critical: 5, major: 2, minor: 1 }));
  it("a quoted input is used exactly", () => expect(byId("RT-01").message).toBe("I got a job offer at 48 000 a month and I want to negotiate it."));
});

// a scripted model: the setup interpreter, the coach and the judge are told apart by their system prompts
const model = (o: { reply?: string; judge?: string; setup?: string } = {}): ChatModel => ({
  async complete(r) {
    if (r.system.startsWith("You prepare a test state")) return o.setup ?? '{"slots":{"path":{"value":"A"}},"researcher":null,"message":"Please continue.","language":"en"}';
    if (r.system.startsWith("You grade one reply")) return o.judge ?? JSON.stringify({ must: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }, { pass: true, reason: "ok" }, { pass: true, reason: "ok" }], must_not: [{ pass: true, reason: "ok" }, { pass: true, reason: "ok" }, { pass: true, reason: "ok" }, { pass: true, reason: "ok" }] });
    if (r.purpose === "extract") return "{}";
    return o.reply ?? "Got it. Is this about a job offer or about your current job?";
  },
});
const mk = (c: EvalCase, items: { must: number; not: number }) => ({ ...c, must: Array.from({ length: items.must }, (_, i) => `m${i}`), mustNot: Array.from({ length: items.not }, (_, i) => `n${i}`) });
const okJudge = (m: number, n: number) => JSON.stringify({ must: Array.from({ length: m }, () => ({ pass: true, reason: "ok" })), must_not: Array.from({ length: n }, () => ({ pass: true, reason: "ok" })) });

describe("setup and judge", () => {
  it("uses the quoted message, picks up slots and the researcher stub", async () => {
    const s = await interpretSetup(model({ setup: '{"slots":{"path":{"value":"A"},"offer_base":{"value":55000}},"researcher":"none","message":"ignored","language":"en"}' }), byId("RT-01"));
    expect(s.message).toBe("I got a job offer at 48 000 a month and I want to negotiate it."); expect(s.slots.offer_base?.value).toBe(55000); expect(s.researcher).toBe("none");
  });
  it("falls back to a neutral message for stage-only inputs and survives a broken setup reply", async () => {
    const s = await interpretSetup(model({ setup: "nonsense" }), byId("RS-01")); expect(s.message).toBe("Please continue."); expect(s.slots).toEqual({});
  });
  it("the judge returns one verdict per item; a mismatch or a failure is a fail, never a pass", async () => {
    const c = mk(byId("RT-01"), { must: 2, not: 1 }); const setup = { slots: {}, researcher: null, message: "hi", language: "en" as const, stage: "route" as const };
    expect((await judgeReply(model({ judge: okJudge(2, 1) }), c, setup, "reply")).ok).toBe(true);
    expect((await judgeReply(model({ judge: JSON.stringify({ must: [{ pass: true }, { pass: false, reason: "no" }], must_not: [{ pass: true }] }) }), c, setup, "reply")).ok).toBe(false);
    const bad = await judgeReply(model({ judge: okJudge(1, 1) }), c, setup, "reply"); expect(bad.ok).toBe(false); expect(bad.error).toBeTruthy();
    expect((await judgeReply({ complete: async () => { throw new Error("x"); } }, c, setup, "reply")).ok).toBe(false);
  });
});
describe("preparing the state for the stage a case tests", () => {
  const base = { researcher: null, message: "hi", language: "en" as const };
  it("a fresh opening stays at the route stage", () => expect(workPlan(prepareState({ ...base, slots: {}, stage: "route" })).stage).toBe("route"));
  it("reaches the market stage with the user's own figures asked first when no data is wanted", () => { const p = workPlan(prepareState({ ...base, slots: {}, stage: "market" })); expect(p.stage).toBe("market"); expect(p.ask.length).toBeGreaterThan(0); });
  it("fills the basics but leaves a kept-empty fact unknown", () => { const s = prepareState({ ...base, slots: { path: { value: "B" }, b_situation: { value: "annual_review" } }, stage: "position", keepEmpty: ["review_date"] }); expect(s.slots.role_title).toBeDefined(); expect(s.slots.review_date).toBeUndefined(); });
  it("leaves a kept-empty fact unknown so the coach can be tested asking for it", () => { const s = prepareState({ ...base, slots: {}, stage: "market", keepEmpty: ["own_target"] }); expect(s.slots.own_target).toBeUndefined(); expect(workPlan(s).ask).toContain("own_target"); });
  it("with researcher data the market step is ready to run, and the setup's own figures are kept", () => {
    const s = prepareState({ ...base, slots: { offer_base: { value: 70000 } }, researcher: { p25: 50000, median: 56000, p75: 62000 }, stage: "market" });
    expect(workPlan(s).runTool).toBe("researcher"); expect(s.slots.offer_base?.value).toBe(70000); expect(s.slots.path?.value).toBe("A");
  });
  it("reaches numbers, strategy and brief with earlier tool results in place", () => {
    expect(workPlan(prepareState({ ...base, slots: {}, stage: "numbers" })).stage).toBe("numbers");
    const st = prepareState({ ...base, slots: {}, stage: "strategy" }); expect(workPlan(st).stage).toBe("strategy"); expect(st.outputs.numbers).toBeTruthy();
    expect(workPlan(prepareState({ ...base, slots: {}, stage: "brief" })).stage).toBe("brief");
  });
  it("never goes backwards when the setup is already past the stage", () => expect(workPlan(prepareState({ ...base, slots: {}, stage: "intake" })).stage).toBe("intake"));
});
describe("running a case", () => {
  const c = mk(byId("RT-01"), { must: 2, not: 1 });
  it("passes when the rules and the judge pass", async () => { const r = await runCase(c, 1, { model: model({ judge: okJudge(2, 1) }) }); expect(r.pass).toBe(true); expect(r.rule.ok).toBe(true); });
  it("fails on a rule even if the judge is happy (a reply that mentions the course)", async () => {
    const r = await runCase(c, 1, { model: model({ reply: "In my negotiation course we learned this. Is it an offer?", judge: okJudge(2, 1) }) }); expect(r.pass).toBe(false);
  });
  it("fails when the judge fails", async () => { const r = await runCase(c, 1, { model: model({ judge: JSON.stringify({ must: [{ pass: false, reason: "missed" }, { pass: true }], must_not: [{ pass: true }] }) }) }); expect(r.pass).toBe(false); expect(r.judge?.must[0]?.reason).toBe("missed"); });
  it("a human-only case is flagged for a human, not decided", async () => { const h = cases.find((x) => x.check === "human")!; const r = await runCase(mk(h, { must: 1, not: 1 }), 1, { model: model({ judge: okJudge(1, 1) }) }); expect(r.needsHuman).toBe(true); });
  it("a case that crashes is reported as not run, never passed", async () => { const r = await runCase(c, 1, { model: { complete: async () => { throw new Error("down"); } } }); expect(r.pass).toBe(false); expect(r.error).toBeTruthy(); });
  it("the fallback message counts as a rule failure", () => { expect(ruleChecks({ findings: [], usedFallback: true }).ok).toBe(false); });
});
describe("release gate", () => {
  const rr = (caseId: string, pass: boolean, run = 1, over: Partial<RunResult> = {}): RunResult => ({ caseId, run, reply: "r", usedFallback: false, rule: { ok: pass, failures: pass ? [] : ["x"] }, needsHuman: false, pass, notes: [], ...over });
  const crit = cases.find((c) => c.severity === "critical")!, maj = cases.find((c) => c.severity === "major")!, min = cases.find((c) => c.severity === "minor")!;
  it("passes when all critical runs pass", () => expect(evaluateGate([crit, maj], [rr(crit.id, true, 1), rr(crit.id, true, 2), rr(maj.id, false, 1), rr(maj.id, true, 2)]).pass).toBe(true));
  it("one failed code check in five blocks the release", () => { const g = evaluateGate([crit], [1, 2, 3, 4, 5].map((i) => rr(crit.id, i !== 3, i))); expect(g.pass).toBe(false); expect(g.criticalFailures).toEqual([`${crit.id} (1/5)`]); });
  const soft = (i: number, pass: boolean) => rr(crit.id, pass, i, { rule: { ok: true, failures: [] } });
  it("one judge-wording miss in five is allowed and reported", () => { const g = evaluateGate([crit], [1, 2, 3, 4, 5].map((i) => soft(i, i !== 3))); expect(g.pass).toBe(true); expect(g.allowedMisses).toHaveLength(1); });
  it("two judge-wording misses in five block", () => expect(evaluateGate([crit], [1, 2, 3, 4, 5].map((i) => soft(i, i > 2))).pass).toBe(false));
  it("a single judge miss in a one-run check still blocks", () => expect(evaluateGate([crit], [soft(1, false)]).pass).toBe(false));
  it("a major case failing every run blocks; a minor failure only reports", () => {
    expect(evaluateGate([maj], [rr(maj.id, false, 1), rr(maj.id, false, 2)]).pass).toBe(false);
    const g = evaluateGate([min], [rr(min.id, false)]); expect(g.pass).toBe(true); expect(g.minorFailures).toEqual([min.id]);
  });
  it("a case that could not run blocks the gate", () => expect(evaluateGate([crit], [rr(crit.id, false, 1, { error: "boom" })]).pass).toBe(false));
  it("stale Sweden notes are listed", () => expect(staleNotes([{ name: "A", verify_before_use: true, valid_as_of: "2026-01-01" }, { name: "B", verify_before_use: true, valid_as_of: "2026-11-21" }, { name: "C", verify_before_use: false, valid_as_of: null }], "2026-11-22")).toEqual(["A"]));
  it("the report states the gate and shows failures with the reply", () => {
    const results = [rr(crit.id, false, 1, { reply: "bad reply" })]; const md = report({ date: "2026-11-22", model: "m", promptVersion: "p", cases: [crit], results, gate: evaluateGate([crit], results), stale: [] });
    expect(md).toContain("Release gate: FAIL"); expect(md).toContain("> bad reply"); expect(md).toContain(crit.id);
  });
});
