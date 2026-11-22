import { describe, it, expect } from "vitest";
import { newState, setSlot, workPlan, runTurn, type SessionState, type ChatModel, type ModelRequest } from "@/orchestrator";
import { skipStep } from "@/orchestrator/turn";
import { SKIPPED } from "@/orchestrator/controller";
import { handleChat } from "@/server/chat";

const fill = (s: SessionState, o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) setSlot(s, k, v, "user"); return s; };
const atInterests = () => fill(newState("en"), { path: "B", b_situation: "annual_review", role_title: "Mortgage advisor", experience_years: 3, location: "Linköping", current_base: 38000, achievements: ["a"], ask_type: "raise" });
const scripted = (extract: string, reply: string): ChatModel & { calls: ModelRequest[] } => {
  const calls: ModelRequest[] = [];
  return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? extract : reply; } };
};

describe("flow v0.3: the steps move on", () => {
  it("three facts and the pay are enough to leave the first step (path B)", () => {
    const s = atInterests(); s.outputs.evidence_summary = {};
    expect(workPlan(s).stage).toBe("interests");
  });
  it("salary only needs no package items", () => {
    const s = atInterests(); s.outputs.evidence_summary = {}; fill(s, { priorities: ["pay"], negotiate_scope: "salary only" });
    expect(workPlan(s)).toMatchObject({ stage: "market", ask: ["batna", "own_target"] });
  });
});

describe("skip", () => {
  it("marks the asked facts unknown and the flow moves on", () => {
    const s = atInterests(); s.outputs.evidence_summary = {};
    expect(skipStep(s, workPlan(s))).toEqual(["negotiate_scope", "priorities"]);
    expect(s.slots.priorities!.value).toBe(SKIPPED); expect(workPlan(s).stage).toBe("market");
  });
  it("skipping the figures the engine needs completes the numbers step instead of looping", async () => {
    const s = atInterests(); s.outputs.evidence_summary = {}; fill(s, { priorities: ["pay"], negotiate_scope: "salary only", batna: "stay" });
    s.outputs.market_range = { unavailable: true };
    fill(s, { own_target: SKIPPED, walk_away: SKIPPED });
    const r = await runTurn({ model: scripted("{}", "Fine, we leave the figures open. Who will you talk to?") }, s, "ok");
    expect((r.state.outputs.numbers as { skipped?: boolean }).skipped).toBe(true); expect(r.plan.stage).toBe("strategy");
  });
  it("a Skip tap does not call the extraction model and tells the coach", async () => {
    const s = atInterests(); s.outputs.evidence_summary = {};
    const m = scripted('{"slots":{"priorities":{"value":"x"}}}', "No problem, we skip that. Is anything else important to you besides pay?");
    const r = await runTurn({ model: m }, s, "Skip", { skip: true });
    expect(m.calls.some((c) => c.purpose === "extract")).toBe(false); expect(r.skipped).toEqual(["negotiate_scope", "priorities"]);
    expect(m.calls.find((c) => c.purpose === "reply")!.system).toContain("The user chose to skip this");
  });
});

describe("the market search runs once", () => {
  it("no data found moves the flow on and tells the coach not to offer another search", async () => {
    const s = atInterests(); s.outputs.evidence_summary = {}; fill(s, { priorities: ["pay"], negotiate_scope: "salary only", batna: "stay", own_target: 42000, walk_away: 39000 });
    const m = scripted("{}", "I could not find market data for this role. You can share a job ad with a pay range, or we go on to your numbers. Which do you prefer?");
    const r = await runTurn({ model: m, researcher: async () => ({ range: null }) }, s, "go");
    expect(r.plan.stage).toBe("numbers"); expect(m.calls.find((c) => c.purpose === "reply")!.system).toContain("never offer to search again");
    const again = await runTurn({ model: scripted("{}", "Here are your numbers. Which first offer do you want?"), researcher: async () => { throw new Error("must not search again"); } }, r.state, "search again please");
    expect(again.plan.stage).not.toBe("market");
  });
});

describe("ending the session", () => {
  it("the user saying they are done closes the session with no suggestions", async () => {
    const s = atInterests();
    const m = scripted('{"slots":{},"done":true}', "You are well prepared. Save your summary as a PDF with the Save button. Good luck!");
    const r = await runTurn({ model: m }, s, "Thanks, I'm happy with this.");
    expect(r.finished).toBe(true); expect(r.state.finished).toBe(true); expect(r.suggestions).toEqual([]);
    expect(m.calls.find((c) => c.purpose === "reply")!.system).toContain("Close the session now");
  });
  it("the chat endpoint passes skip through and reports finished and canSkip", async () => {
    const s = atInterests(); s.outputs.evidence_summary = {};
    const r = await handleChat({ message: "Skip", state: s, skip: true }, scripted("{}", "Fine. What is your best alternative if this does not work out?"));
    expect(r.status).toBe(200); expect((r.body as { finished: boolean }).finished).toBe(false); expect((r.body as { canSkip: boolean }).canSkip).toBe(true);
  });
});

describe("ending the session", () => {
  it("a message that gives a fact never ends the session, even if the extraction says done", async () => {
    const s = fill(newState("en"), { path: "B", role_title: "x", experience_years: 5, location: "Linköping", current_base: 45000 });
    const r = await runTurn({ model: scripted('{"slots":{"first_offer":{"value":51500}},"done":true}', "Good.") }, s, "I'm happy with 51 500 kr as my first offer.");
    expect(r.finished).toBe(false);
    const r2 = await runTurn({ model: scripted('{"slots":{},"done":true}', "Good luck.") }, r.state, "Thanks, that's all.");
    expect(r2.finished).toBe(true);
  });
});
