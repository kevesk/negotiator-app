import { describe, it, expect } from "vitest";
import { newState, setSlot, workPlan, runTurn, type SessionState, type ChatModel, type ModelRequest } from "@/orchestrator";

const fill = (s: SessionState, o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) setSlot(s, k, v, "user"); return s; };
const atStrategy = () => {
  const s = fill(newState("en"), { path: "B", b_situation: "annual_review", role_title: "Mortgage advisor", experience_years: 5, location: "Linköping", current_base: 38000, achievements: ["a"], ask_type: "raise", priorities: ["pay"], negotiate_scope: "package", package_issues: ["Base salary", "Remote work", "Vacation", "Training budget", "Pension"], batna: "stay", own_target: 45000, walk_away: 40000 });
  s.outputs.evidence_summary = {}; s.outputs.market_range = { unavailable: true }; s.outputs.numbers = { skipped: true }; setSlot(s, "first_offer", 47000, "user");
  return s;
};
const WEIGHTS = { "Base salary": 40, "Remote work": 20, Vacation: 15, "Training budget": 15, Pension: 10 };
const scripted = (extract: string, reply: string): ChatModel & { calls: ModelRequest[] } => { const calls: ModelRequest[] = []; return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? extract : reply; } }; };

describe("packages are built by the engine", () => {
  it("builds when the points arrive, even before the counterpart is known", () => {
    const s = atStrategy(); expect(workPlan(s).runTool).toBeUndefined(); fill(s, { issue_weights: WEIGHTS });
    expect(workPlan(s)).toMatchObject({ stage: "strategy", runTool: "package_builder" });
  });
  it("the turn that builds them shows them, with the engine's packages in the prompt", async () => {
    const s = atStrategy(); fill(s, { issue_weights: WEIGHTS, counterpart: "my manager" });
    const m = scripted("{}", "Here are three packages that are worth about the same to you.");
    const r = await runTurn({ model: m }, s, "ok");
    const draft = r.state.outputs.package_draft as { packages: { items: { text: string }[] }[]; sameValue: boolean };
    expect(draft.packages.length).toBeGreaterThanOrEqual(2); expect(draft.sameValue).toBe(true);
    expect(r.plan.stage).toBe("strategy"); // stays until the user has seen them
    const sys = m.calls.find((c) => c.purpose !== "extract")!.system as string;
    expect(sys).toContain("package_draft"); expect(sys).toContain("never change them"); expect(sys).toContain("base salary");
    expect(r.state.slots.packages!.source).toBe("assumed");
  });
  it("the next turn moves on, and new points rebuild them", async () => {
    const s = atStrategy(); fill(s, { issue_weights: WEIGHTS, counterpart: "my manager" });
    const r1 = await runTurn({ model: scripted("{}", "Packages.") }, s, "ok");
    const r2 = await runTurn({ model: scripted("{}", "On to the next step.") }, r1.state, "looks good");
    expect(r2.plan.stage).not.toBe("strategy");
    const s3 = r1.state; setSlot(s3, "issue_weights", { "Base salary": 30, "Remote work": 30, Vacation: 20, Pension: 20 }, "user");
    expect(workPlan(s3).runTool).toBe("package_builder");
  });
  it("salary only never builds packages", () => { const s = atStrategy(); setSlot(s, "negotiate_scope", "salary only", "user"); fill(s, { issue_weights: WEIGHTS }); expect(workPlan(s).runTool).toBeUndefined(); });
  it("one item cannot make a choice: the coach asks for another item and writes no packages", async () => {
    const s = atStrategy(); fill(s, { issue_weights: { "Base salary": 100 }, counterpart: "my manager" });
    const m = scripted("{}", "What else matters to you?"); const r = await runTurn({ model: m }, s, "ok");
    expect((r.state.outputs.package_draft as { failed?: boolean }).failed).toBe(true);
    expect(m.calls.find((c) => c.purpose !== "extract")!.system as string).toContain("could not be built");
  });
});
