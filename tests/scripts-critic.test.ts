import { describe, it, expect } from "vitest";
import { validateScripts, runScripts, scriptPrompt, type ScriptInput } from "@/agents/scripts";
import { codeChecks, reviewBrief, sectionOf, type BriefContext } from "@/agents/critic";
import { PREP_BRIEF_TEMPLATE, BRIEF_CHECKLIST } from "@/agents/templates.generated";
import { runTurn, newState, setSlot, workPlan, type ChatModel, type SessionState } from "@/orchestrator";
import { runNumbersTool } from "@/orchestrator/tools";
import { runScriptTool, approvedFrom, factsFor } from "@/orchestrator/scripts";

const INPUT: ScriptInput = { lang: "en", channel: "in person", facts: "- role_title: Analyst", approved: { anchor: 56000, positions: [53000, 51000, 50000] }, forbidden: [47000], notes: "" };
const part = (id: string, text: string, extra: object = {}) => ({ id, text, ...extra });
const good = (over: Record<string, unknown> = {}) => ({
  parts: [part("opening", "Thank you for the offer. I am excited about the role."), part("ask", "Based on my experience I am asking for 56 000 SEK a month."), part("objection", "I understand the budget is tight. Could we look at 53 000 with a review in six months?", { objection: "The budget is fixed" }), part("objection", "I appreciate that. May I ask what flexibility exists on other terms?", { objection: "That is not negotiable" }),
    part("trade", "If we can agree 53 000, I can accept the start date you proposed."), part("close", "To summarise, we agreed to talk again on Friday."), part("time", "I would like to think about it and come back to you tomorrow.")],
  email: null, assumptions: [], provisional: false, ...over });

describe("script validation", () => {
  it("accepts a script that uses only approved figures", () => expect(validateScripts(good(), INPUT).ok).toBe(true));
  it("rejects an unapproved figure", () => { const v = validateScripts(good({ parts: [...good().parts, part("close", "I could do 49 500.")] }), INPUT); expect(v.ok).toBe(false); if (!v.ok) expect(v.errors.join()).toContain("49 500"); });
  it("rejects the walk-away, even in a sentence", () => { const v = validateScripts(good({ parts: [...good().parts.slice(0, 6), part("close", "My lowest is 47 000 SEK.")] }), INPUT); expect(v.ok).toBe(false); });
  it("needs the parts, two objection responses, and an email for the email channel", () => {
    expect(validateScripts({ parts: good().parts.filter((p) => p.id !== "time") }, INPUT).ok).toBe(false);
    expect(validateScripts({ parts: good().parts.filter((p) => p.id !== "objection") }, INPUT).ok).toBe(false);
    expect(validateScripts(good(), { ...INPUT, channel: "email" }).ok).toBe(false);
    expect(validateScripts(good({ email: { subject: "Offer", body: "Hello, thank you for the offer." } }), { ...INPUT, channel: "email" }).ok).toBe(true);
  });
  it("rejects theatre, promises and mentions of a course", () => {
    for (const bad of ["Haha, just kidding.", "I guarantee I will perform.", "In my negotiation course we learned this."]) expect(validateScripts(good({ parts: [...good().parts, part("close", bad)] }), INPUT).ok).toBe(false);
  });
  it("the prompt never contains the walk-away", () => { const p = scriptPrompt(INPUT); expect(p.system + p.user).not.toContain("47 000"); });
});
describe("script run", () => {
  const model = (...replies: string[]): ChatModel & { n: number } => { const m = { n: 0, async complete() { return replies[Math.min(m.n++, replies.length - 1)]!; } }; return m; };
  it("repairs once", async () => { const m = model(JSON.stringify(good({ parts: [...good().parts, part("close", "How about 49 500?")] })), JSON.stringify(good())); const r = await runScripts(m, INPUT); expect(r.ok).toBe(true); expect(m.n).toBe(2); });
  it("gives up after one repair and never throws", async () => {
    expect((await runScripts(model("not json"), INPUT)).ok).toBe(false);
    expect((await runScripts({ complete: async () => { throw new Error("x"); } }, INPUT)).ok).toBe(false);
  });
});

// ---------- the Critic
const STATE = "- own_target: 52000 [user]\n- walk_away: 47000 [user]";
const OUT = JSON.stringify({ numbers: { target: 52000, anchor: 56000 } });
const BRIEF = `# Negotiation brief: Analyst offer\n\n## 1. Your numbers\n| | Monthly gross (SEK) | Source |\n|---|---|---|\n| Your target | 52 000 | [user] |\n| Your walk-away | 47 000 | [user] |\n\n## 5. What to say\n- The ask: "I would like 56 000 SEK a month."\n\n## 6. Concession plan\n| Step | You can move on | By | In exchange for |\n|---|---|---|---|\n| 1 | base | 3 000 | start date |\n\n## 8. Before the meeting\n- [ ] Print this brief\n\nBased on: BATNA\n\n*This brief is preparation support, not legal or financial advice.*`;
const ctx = (over: Partial<BriefContext> = {}): BriefContext => ({ lang: "en", brief: BRIEF, state: STATE, outputs: OUT, walkAway: 47000, target: 52000, batna: 45000, sources: [STATE, OUT, "56 000", "53 000", "3 000"], ...over });
describe("critic code checks", () => {
  it("a clean brief has no findings", () => expect(codeChecks(ctx())).toEqual([]));
  it("finds a placeholder, an untraced figure, a walk-away in a script, a missing tag, no disclaimer, no next step", () => {
    const ids = (b: string) => codeChecks(ctx({ brief: b })).map((f) => f.id);
    expect(ids(BRIEF.replace("Analyst offer", "{{short title}}"))).toContain("placeholder");
    expect(ids(BRIEF.replace("56 000", "61 000"))).toContain("numbers");
    expect(ids(BRIEF.replace("I would like 56 000 SEK", "My floor is 47 000 SEK"))).toContain("leaks");
    expect(ids(BRIEF.replace("| 52 000 | [user] |", "| 52 000 | |"))).toContain("tags");
    expect(ids(BRIEF.replace(/\*This brief.*\*/, ""))).toContain("completeness");
    expect(ids(BRIEF.replace("- [ ] Print this brief", "").replace("## 8. Before the meeting", ""))).toContain("completeness");
  });
  it("flags walk-away above target and mentions of the course", () => {
    expect(codeChecks(ctx({ walkAway: 53000 })).some((f) => f.id === "consistency" && f.severity === "must_fix")).toBe(true);
    expect(codeChecks(ctx({ brief: BRIEF + "\nAs we learned in the negotiation course." })).some((f) => f.id === "leaks")).toBe(true);
  });
  it("finds sections by number in any language", () => expect(sectionOf(BRIEF.replace("What to say", "Vad du ska säga"), 5)).toContain("The ask"));
  it("flags a brief that is too long", () => expect(codeChecks(ctx({ brief: BRIEF + " word".repeat(1200) })).some((f) => f.id === "length")).toBe(true));
});
describe("critic review", () => {
  const critic = (reply: string | Error): ChatModel => ({ async complete() { if (reply instanceof Error) throw reply; return reply; } });
  it("passes a clean brief, in a context without the chat history", async () => {
    let seen = ""; const m: ChatModel = { async complete(r) { seen = JSON.stringify(r); return '{"findings":[]}'; } };
    const r = await reviewBrief(m, ctx()); expect(r.verdict).toBe("pass"); expect(JSON.parse(seen).purpose).toBe("critic"); expect(JSON.parse(seen).messages).toHaveLength(1);
  });
  it("merges model findings with code findings; must_fix gives verdict fix", async () => {
    const r = await reviewBrief(critic('{"findings":[{"id":"honesty","severity":"must_fix","where":"section 5","what":"claims another offer","suggested_fix":"remove"},{"id":"bogus","severity":"must_fix"}]}'), ctx());
    expect(r.verdict).toBe("fix"); expect(r.checks_failed).toEqual(["honesty"]); expect(r.findings).toHaveLength(1);
  });
  it("still returns the code findings when the model fails", async () => { const r = await reviewBrief(critic(new Error("down")), ctx({ brief: BRIEF.replace("56 000", "61 000") })); expect(r.verdict).toBe("fix"); });
  it("the checklist comes from the vault", () => { expect(BRIEF_CHECKLIST.length).toBeGreaterThanOrEqual(10); expect(PREP_BRIEF_TEMPLATE).toContain("## 9."); });
});

// ---------- in the turn loop
function reach(stage: string): SessionState {
  const s = newState("en"); const vals: Record<string, unknown> = { path: "A", a_phase: "offer_received", experience_years: 4, own_target: 52000, walk_away: 47000, batna: 45000, offer_base: 50000, offer_variable: "none", offer_pension: { agreement: "ITP1" }, offer_vacation: 25, offer_benefits: "none", channel: "in person", weekly_hours: 40 };
  for (let i = 0; i < 60; i++) {
    const p = workPlan(s);
    if (p.stage === stage && p.runTool) break;                                  // the stage's tool is about to run
    if (p.stage === stage && !p.runTool && !p.missing.length && !p.ask.length) break;
    if (p.runTool === "numbers_engine") { s.outputs.numbers = runNumbersTool(s); continue; }
    if (p.runTool === "researcher") { setSlot(s, "market_range", { p25: 46000, median: 50000, p75: 57000, confidence: "medium" }, "researcher"); s.outputs.market_range = { p25: 46000 }; continue; }
    if (p.runTool === "offer_analyzer") { s.outputs.offer_analysis = { done: true }; continue; }
    if (p.runTool === "script_writer") { s.outputs.scripts = { parts: [] }; continue; }
    if (p.runTool) { s.outputs.evidence_summary = { done: true }; continue; }
    for (const id of p.missing.length ? p.missing : p.ask) setSlot(s, id, vals[id] ?? "x", "user");
  }
  return s;
}
const briefFor = (s: SessionState) => { const a = (s.outputs.numbers as any).defaultAnchor.amount as number; return BRIEF.replace("56 000", a.toLocaleString("en-US").replace(/,/g, " ")).replace("| 3 000 |", "| 52 000 |"); };
describe("scripts and brief in the turn loop", () => {
  it("the script writer runs at the scripts stage with only approved figures and writes the result to the state", async () => {
    const s = reach("scripts"); expect(workPlan(s).runTool).toBe("script_writer");
    const n = s.outputs.numbers as any; const a = approvedFrom(n); expect(a.anchor).toBe(n.defaultAnchor.amount); expect(a.positions.at(-1)).toBe(52000);
    expect(factsFor(s)).not.toMatch(/47000|own_target|walk_away/);
    const f = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");
    const text = JSON.stringify(good()).replace(/56 000/g, f(a.anchor)).replace(/53 000/g, f(a.positions[0]!));
    const r = await runScriptTool(s, { async complete(req) { return req.purpose === "script" ? text : "{}"; } });
    expect("failed" in r).toBe(false);
  });
  it("a failed script is stored as failed, not as text", async () => { const r = await runScriptTool(reach("scripts"), { complete: async () => "no" }); expect(r).toMatchObject({ failed: true }); });
  it("the Critic's must-fix finding triggers one rewrite, and a fixed brief carries no open note", async () => {
    const s = reach("brief"); let rewrites = 0, reviews = 0;
    const model: ChatModel = { async complete(r) {
      if (r.purpose === "extract") return "{}";
      if (r.purpose === "critic") { reviews++; return reviews === 1 ? '{"findings":[{"id":"honesty","severity":"must_fix","where":"section 5","what":"x","suggested_fix":"remove it"}]}' : '{"findings":[]}'; }
      if (r.purpose === "rewrite") { rewrites++; return briefFor(s) + "\n<suggestions>\n- ok\n- fine\n- next\n</suggestions>"; }
      return briefFor(s).replace("Print this brief", "Print this brief and read it") + "\n<suggestions>\n- ok\n- fine\n- next\n</suggestions>"; } };
    const r = await runTurn({ model }, s, "go");
    expect(rewrites).toBe(1); expect(reviews).toBe(2); expect(r.reply).not.toContain("Open points"); expect(r.state.outputs.critic_report).toMatchObject({ verdict: "pass" });
  });
  it("an unresolved must-fix is stated openly in the brief", async () => {
    const s = reach("brief");
    const model: ChatModel = { async complete(r) { if (r.purpose === "extract") return "{}"; if (r.purpose === "critic") return '{"findings":[{"id":"honesty","severity":"must_fix","where":"s5","what":"x","suggested_fix":"y"}]}'; return briefFor(s); } };
    const r = await runTurn({ model }, s, "go"); expect(r.reply).toContain("Open points in this brief"); expect(r.state.failures).toContain("critic:honesty");
  });
  it("the Critic runs once, on the first brief only", async () => {
    const s = reach("brief"); s.outputs.brief = true; let reviews = 0;
    await runTurn({ model: { async complete(r) { if (r.purpose === "critic") reviews++; return r.purpose === "extract" ? "{}" : briefFor(s); } } }, s, "make the opening shorter"); expect(reviews).toBe(0);
  });
});
