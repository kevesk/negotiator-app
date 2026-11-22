import { describe, it, expect } from "vitest";
import { newState, setSlot } from "@/orchestrator";
import { buildPackages, draftConcessionPlan } from "@/engine";
import { planMarkdown } from "@/app/plan";

const state = (lang: "en" | "sv") => {
  const s = newState(lang); const f = (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) setSlot(s, k, v, "user"); };
  f({ path: "B", current_base: 45000, achievements: "Highest customer satisfaction in the team: 95% against 80%. Colleagues come to the user with questions.", experience_years: 5, negotiate_scope: "package", own_target: 51000, walk_away: 48000, first_offer: 53500, batna: "stay and look at other banks" });
  setSlot(s, "market_range", { p25: 35200, median: 43700, p75: 53100, sources: ["SCB 2025"] }, "researcher");
  s.outputs.package_draft = buildPackages({ weights: [{ label: "Base salary", weight: 45 }, { label: "Remote work", weight: 25 }, { label: "Training", weight: 15 }, { label: "Vacation", weight: 15 }], target: 51000, walkAway: 48000, lang });
  s.outputs.concession_plan = { first: 53500, ...draftConcessionPlan(53500, 51000, 48000) };
  return s;
};
describe("the saved plan", () => {
  it("is plain language with every part the user needs, and no session data", () => {
    const md = planMarkdown(state("en"), "en");
    for (const h of ["Your numbers", "Your first offer", "Concession plan in three steps", "Your packages", "Why you deserve it", "What to say", "Tough questions", "Before the meeting"]) expect(md).toContain(`## ${h}`);
    expect(md).not.toMatch(/SESSION SUMMARY|```|"slots"|\{"|source/);
    expect(md).toContain("53 500 kr"); expect(md).toContain("51 000 kr"); expect(md).toContain("48 000 kr");
  });
  it("three steps that get smaller and end on the target, each with a trade", () => {
    const md = planMarkdown(state("en"), "en"); const steps = md.split("\n").filter((l) => /^\d\. /.test(l));
    expect(steps.length).toBe(3); expect(steps[2]).toContain("**51 000 kr**"); expect(steps.every((l) => / in return| together with /.test(l))).toBe(true);
    const by = steps.map((l) => Number(l.match(/\(–([\d ]+) kr\)/)![1]!.replace(/ /g, ""))); expect(by[0]! > by[1]! && by[1]! > by[2]!).toBe(true);
  });
  it("the packages table has one column per package and the employer rows", () => {
    const md = planMarkdown(state("en"), "en"); expect(md).toMatch(/\| Item \| Package A \| Package B/); expect(md).toContain("| What it costs them |"); expect(md).toContain("| If they choose it |");
  });
  it("writes the user's facts in their own voice", () => { expect(planMarkdown(state("en"), "en")).toContain("Colleagues come to me with questions"); });
  it("Swedish, and the coach's brief comes after the plan", () => {
    const md = planMarkdown(state("sv"), "sv", "# Brief\n## 1. Situation\nText"); expect(md).toContain("## Medgivandeplan i tre steg"); expect(md.indexOf("Coachens fullständiga anteckningar")).toBeGreaterThan(md.indexOf("Före mötet"));
  });
  it("the turn keeps the three steps in step with the user's own first offer", async () => {
    const { runTurn } = await import("@/orchestrator");
    const s = state("en"); delete s.outputs.concession_plan;
    const r = await runTurn({ model: { async complete(req) { return req.purpose === "extract" ? "{}" : "OK."; } } }, s, "ok");
    expect(r.state.outputs.concession_plan).toMatchObject({ first: 53500, landing: 51000 });
  });
  it("says what is missing instead of inventing figures", () => {
    const md = planMarkdown(newState("en"), "en"); expect(md).toContain("not set yet"); expect(md).toContain("The plan needs a first offer"); expect(md).not.toContain("## Your packages");
  });
});
