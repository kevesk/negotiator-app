import { describe, it, expect } from "vitest";
import { newState, setSlot, assume, markStale, workPlan, gate, detectModifiers, requiredFor, sidebarStep, parseExtraction, applyExtraction,
  runNumbersTool, toSummary, fromSummary, runTurn, QUESTIONS_PER_TURN, type SessionState, type ChatModel, type ModelRequest } from "@/orchestrator";

const fill = (s: SessionState, o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) setSlot(s, k, v, "user"); return s; };
const JOB = { role_title: "Credit analyst", experience_years: 4, industry: "Banking", employer_type: "private, large", location: "Linköping", work_mode: "hybrid", employment_terms: "permanent, full-time" };
const pathB = () => fill(newState("en"), { path: "B", b_situation: "annual_review", ...JOB, current_base: 40000, review_date: "2027-01-20" });

describe("flow generated from the vault", () => {
  it("asks for the path first", () => { const p = workPlan(newState("en")); expect(p.stage).toBe("route"); expect(p.ask).toEqual(["path"]); });
  it("never asks more than two questions", () => { expect(QUESTIONS_PER_TURN).toBe(2); expect(workPlan(fill(newState("en"), { path: "B" })).ask.length).toBeLessThanOrEqual(2); });
  it("asks in tier order: P0 before P1", () => { const p = workPlan(fill(newState("en"), { path: "A" })); expect(p.stage).toBe("intake"); expect(p.ask[0]).toBe("a_phase"); });
  it("intake for path A depends on the phase", () => {
    const pre = fill(newState("en"), { path: "A", a_phase: "pre_offer" }); const off = fill(newState("en"), { path: "A", a_phase: "offer_received" });
    expect(requiredFor("intake", pre)).toEqual(expect.arrayContaining(["process_stage", "salary_question_type"])); expect(requiredFor("intake", pre)).not.toContain("offer_base");
    expect(requiredFor("intake", off)).toEqual(expect.arrayContaining(["offer_base", "offer_deadline"]));
  });
  it("position needs different slots on path A offer and path B", () => {
    expect(requiredFor("position", fill(newState("en"), { path: "A", a_phase: "offer_received" }))).toEqual(expect.arrayContaining(["offer_base", "offer_pension"]));
    expect(requiredFor("position", pathB())).toEqual(["achievements", "scope_change", "last_raise", "ask_type"]);
  });
  it("sidebar shows six steps", () => { expect(["route", "intake", "position"].map((x) => sidebarStep(x as any))).toEqual(["Situation", "Situation", "Situation"]); expect(sidebarStep("market")).toBe("Market"); expect(sidebarStep("numbers")).toBe("Numbers"); expect(sidebarStep("scripts")).toBe("Scripts"); });
});

describe("walking the flow", () => {
  const s = pathB();
  it("intake is complete, position next", () => { expect(gate("intake", s).met).toBe(true); expect(workPlan(s).stage).toBe("position"); });
  it("position (path B) asks for the evidence slots", () => expect(workPlan(pathB()).ask).toEqual(["achievements", "scope_change"]));
  fill(s, { achievements: ["led migration"], scope_change: "team of 3", last_raise: "none in 12 months", ask_type: "raise" });
  it("after the evidence slots the evidence builder runs", () => expect(workPlan(s).runTool).toBe("evidence_builder"));
  it("the user's own numbers come before the market range", () => {
    s.outputs.evidence_summary = { done: true };
    expect(workPlan(s)).toMatchObject({ stage: "market", ask: ["own_target", "walk_away"] });
    fill(s, { own_target: 50000, walk_away: 46000, batna: "stay in current job" });
    expect(workPlan(s)).toMatchObject({ stage: "market", runTool: "researcher" });
  });
  it("then the numbers engine, once a market range exists", () => {
    setSlot(s, "market_range", { p25: 45000, median: 50000, p75: 56000, confidence: "medium" }, "researcher"); s.outputs.market_range = { p25: 45000 };
    expect(workPlan(s)).toMatchObject({ stage: "numbers", runTool: "numbers_engine" });
  });
  it("then strategy asks for priorities, counterpart and risk tolerance in tier order", () => {
    s.outputs.numbers = { done: true }; const p = workPlan(s);
    expect(p.stage).toBe("strategy"); expect(p.missing).toEqual(expect.arrayContaining(["priorities", "counterpart", "risk_tolerance", "manager_stance", "budget_timing"]));
  });
  it("an assumed value counts as present (explicitly assumed)", () => { const t = pathB(); assume(t, "employment_terms", "unknown, assumed permanent"); expect(gate("intake", t).met).toBe(true); });
});

describe("going back and stale values", () => {
  it("changing the target removes the numbers and schedules recomputation", () => {
    const s = pathB(); fill(s, { own_target: 50000 }); s.outputs.numbers = { x: 1 }; s.outputs.scripts = { y: 1 };
    setSlot(s, "own_target", 52000, "user");
    expect(s.outputs.numbers).toBeUndefined(); expect(s.outputs.scripts).toBeUndefined(); expect(s.recompute).toEqual(expect.arrayContaining(["numbers", "strategy", "scripts", "brief"]));
  });
  it("changing the role removes the market range", () => {
    const s = pathB(); setSlot(s, "market_range", { p25: 1 }, "researcher"); s.outputs.market_range = {};
    setSlot(s, "role_title", "Senior credit analyst", "user"); expect(s.slots.market_range).toBeUndefined(); expect(s.outputs.market_range).toBeUndefined();
  });
  it("setting the same value again changes nothing", () => { const s = pathB(); expect(setSlot(s, "role_title", "Credit analyst", "user")).toBe(false); expect(s.recompute).toEqual([]); });
  it("a stale slot must be confirmed before use", () => { const s = pathB(); markStale(s, "review_date"); expect(gate("intake", s).missing).toContain("review_date"); });
});

describe("modifiers", () => {
  it("detects those with a readable trigger", () => {
    const s = fill(pathB(), { other_offers: [{ employer: "X" }], ask_type: "promotion", experience_years: 1, employer_type: "public sector" });
    expect(detectModifiers(s)).toEqual(expect.arrayContaining(["competing_offer", "promotion_or_title", "first_job_or_graduate", "fixed_scale"]));
  });
  it("a counter to an external offer sets the counteroffer modifier", () => expect(detectModifiers(fill(newState("en"), { path: "B", b_situation: "counter_to_external_offer" }))).toContain("counteroffer_from_employer"));
});

describe("extraction", () => {
  it("parses a clean reply", () => expect(parseExtraction('{"slots":{"path":{"value":"B"},"own_target":{"value":52000,"unit":"SEK/month"}},"modifiers":["competing_offer"]}')).toEqual({ slots: { path: { value: "B", unit: undefined }, own_target: { value: 52000, unit: "SEK/month" } }, modifiers: ["competing_offer"] }));
  it("survives prose around the JSON and drops unknown ids, derived ids, nulls and bad modifiers", () => {
    const e = parseExtraction('Sure! {"slots":{"bogus":{"value":1},"anchor":{"value":5},"walk_away":{"value":null},"channel":{"value":"video"}},"modifiers":["nonsense"]} done');
    expect(Object.keys(e.slots)).toEqual(["channel"]); expect(e.modifiers).toEqual([]);
  });
  it("returns nothing for garbage", () => { expect(parseExtraction("no json here").slots).toEqual({}); expect(parseExtraction("{broken").slots).toEqual({}); });
  it("applies values as user data", () => { const s = newState("en"); applyExtraction(s, parseExtraction('{"slots":{"path":{"value":"A"}}}')); expect(s.slots.path).toMatchObject({ value: "A", source: "user" }); });
});

describe("numbers tool", () => {
  it("gives the spec's worked example: target 50,000, P75 56,000 -> anchor 53,000, steps 1,500 / 900 / 600", () => {
    const s = fill(newState("en"), { own_target: 50000, walk_away: 47000, tax_municipality: "Linköping" }); setSlot(s, "market_range", { p25: 45000, median: 50000, p75: 56000, confidence: "medium" }, "researcher");
    const r = runNumbersTool(s); if ("needs" in r) throw new Error("needs");
    expect(r.defaultAnchor).toMatchObject({ id: "halfway", amount: 53000, assumed: true });
    expect(r.concession.steps.map((x) => x.amount)).toEqual([1500, 900, 600]);
    expect(r.net.basis).toBe("municipality"); expect(r.net.target.net).toBe(50000 - r.net.target.tax);
    expect(r.zopa.overlap).toBe("positive"); expect(r.zopa.confidence).toBe("medium");
  });
  it("says what is missing instead of guessing", () => expect(runNumbersTool(fill(newState("en"), { own_target: 50000 }))).toEqual({ needs: ["walk_away", "market_range"] }));
  it("average-only data gives hold and no range", () => {
    const s = fill(newState("en"), { own_target: 50000, walk_away: 47000 }); setSlot(s, "market_range", { median: 50000, averageOnly: true }, "researcher");
    const r = runNumbersTool(s); if ("needs" in r) throw new Error(); expect(r.anchorOptions.map((o) => o.id)).toEqual(["hold"]); expect(r.flags).toContain("average_only"); expect(r.zopa.overlap).toBe("unknown");
  });
  it("an unknown municipality falls back to the national average and says so", () => {
    const s = fill(newState("en"), { own_target: 50000, walk_away: 47000, tax_municipality: "Atlantis" }); setSlot(s, "market_range", { p25: 1, p75: 60000 }, "researcher");
    const r = runNumbersTool(s); if ("needs" in r) throw new Error(); expect(r.net.basis).toBe("national_average"); expect(r.flags).toContain("unknown_municipality");
  });
});

describe("paste-back summary", () => {
  it("round-trips slots with source tags and asks to confirm time-sensitive items", () => {
    const a = pathB(); setSlot(a, "offer_deadline", "2026-12-01", "user");
    const text = toSummary(a); const b = newState("en"); const r = fromSummary(text, b);
    expect(r.ok).toBe(true); expect(r.confirm).toEqual(expect.arrayContaining(["review_date", "offer_deadline"])); expect(b.slots.role_title?.value).toBe("Credit analyst");
  });
  it("says what could not be read", () => { expect(fromSummary("hello", newState("en")).ok).toBe(false); expect(fromSummary("SESSION SUMMARY v1\n```json\n{oops\n```", newState("en")).unreadable).toBeDefined(); });
});

// --- the turn loop with a scripted model ---
const scripted = (extract: string, replies: string[]): ChatModel & { calls: ModelRequest[] } => {
  const calls: ModelRequest[] = []; let i = 0;
  return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? extract : replies[Math.min(i++, replies.length - 1)]!; } };
};
describe("turn loop", () => {
  it("asks for the path first, without mutating the previous state", async () => {
    const prev = newState("en"); const m = scripted("{}", ["Is this about a job offer, or a salary discussion at the job you have now?"]);
    const r = await runTurn({ model: m }, prev, "Hi, I want help with my salary");
    expect(r.plan).toMatchObject({ stage: "route", ask: ["path"] }); expect(r.usedFallback).toBe(false); expect(prev.turn).toBe(0); expect(r.state.turn).toBe(1); expect(r.sidebar).toBe("Situation");
    expect(m.calls.find((c) => c.purpose === "reply")!.system).toContain("Next facts to collect");
  });
  it("extracts the path from the message and moves on", async () => {
    const m = scripted('{"slots":{"path":{"value":"A"},"a_phase":{"value":"offer_received"}}}', ["Congratulations on the offer. What is the role title, and how many years of relevant experience do you have?"]);
    const r = await runTurn({ model: m }, newState("en"), "I got a job offer");
    expect(r.state.slots.path?.value).toBe("A"); expect(r.plan.stage).toBe("intake"); expect(r.plan.ask.length).toBeLessThanOrEqual(2);
  });
  it("revises once when a check fails, then sends the revision", async () => {
    const m = scripted("{}", ["Most people in your role earn 61 500 kr. Shall we go on?", "I do not have market data yet. What role do you have?"]);
    const r = await runTurn({ model: m }, newState("en"), "hi");
    expect(m.calls.map((c) => c.purpose)).toEqual(["extract", "reply", "rewrite"]); expect(r.usedFallback).toBe(false); expect(r.reply).toContain("What role");
  });
  it("sends the safe fallback after two failures and records only the rule ids", async () => {
    const m = scripted("{}", ["I guarantee they will accept. Ready?", "I promise it will work, haha. Ready?"]);
    const r = await runTurn({ model: m }, newState("sv"), "hej");
    expect(r.usedFallback).toBe(true); expect(r.reply).toMatch(/Jag kunde inte/); expect(r.state.failures).toEqual(expect.arrayContaining(["H12"]));
  });
  it("allows echoing the user's own target before the numbers gate is open", async () => {
    const m = scripted('{"slots":{"path":{"value":"B"},"own_target":{"value":52000}}}', ["Thanks. Your target of 52 000 kr is noted. When is your salary discussion?"]);
    const r = await runTurn({ model: m }, newState("en"), "I want 52 000 kr");
    expect(r.usedFallback).toBe(false);
  });
  it("blocks a coach-proposed target figure before the gate is open", async () => {
    const m = scripted("{}", ["Your target should be 55 000 kr. Agree?", "Your target should be 55 000 kr. Agree?"]);
    const r = await runTurn({ model: m }, newState("en"), "what target?");
    expect(r.usedFallback).toBe(true);
  });
  it("runs the numbers engine when the gate is met and lets the reply use its figures", async () => {
    const s = pathB(); fill(s, { achievements: ["a"], scope_change: "b", last_raise: "c", ask_type: "raise", own_target: 50000, walk_away: 47000, batna: "stay" });
    s.outputs.evidence_summary = {}; setSlot(s, "market_range", { p25: 45000, median: 50000, p75: 56000, confidence: "medium" }, "researcher"); s.outputs.market_range = {};
    const m = scripted("{}", ["Your target is 50 000 kr [user]. An opening of 53 000 kr [computed] leaves room for three steps of 1 500, 900 and 600 kr [computed]. Shall we look at what you would ask for in return for each step?"]);
    const r = await runTurn({ model: m }, s, "ok");
    expect(r.state.outputs.numbers).toBeDefined(); expect(r.plan.stage).toBe("strategy"); expect(r.usedFallback).toBe(false);
  });
  it("uses a market-unavailable message when no researcher exists", async () => {
    const s = pathB(); fill(s, { achievements: ["a"], scope_change: "b", last_raise: "c", ask_type: "raise", own_target: 50000, walk_away: 47000, batna: "stay" }); s.outputs.evidence_summary = {};
    const m = scripted("{}", ["I could not find market data. Do you have job ads or union statistics for this role?"]);
    const r = await runTurn({ model: m }, s, "go ahead");
    expect((r.state.outputs.market_range as any).unavailable).toBe(true); expect(r.plan.ask).toContain("market_range"); expect(m.calls.find((c) => c.purpose === "reply")!.system).toContain("No market data could be found");
  });
});
