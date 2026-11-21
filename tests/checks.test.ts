import { describe, it, expect } from "vitest";
import { preSend, extractFigures, parseNumber, checkRules, FALLBACK } from "@/checks";
import type { ReplyContext } from "@/checks";
import { buildSystemPrompt } from "@/agents/prompt";
import { HARD_RULES } from "@/agents/hard-rules.generated";

const ctx = (o: Partial<ReplyContext> = {}): ReplyContext => ({ stage: "strategy", sources: ["I earn 45 000 kr and want 52 000 kr. Market median 50 000 kr, P75 56 000."], numbersGateOpen: true, ...o });
const rules = (reply: string, c = ctx()) => preSend(reply, c).findings.filter((f) => f.severity === "error").map((f) => f.rule);
const GOOD = "Your target of 52 000 kr [user] sits just above the median of 50 000 kr. Which employer evidence supports it?";

describe("number parsing", () => {
  it.each([["52 000", 52000], ["52 000", 52000], ["52,000", 52000], ["52.000", 52000], ["4,5", 4.5], ["32.38", 32.38], ["1 234 567", 1234567], ["0,5", 0.5]])("%s", (t, v) => expect(parseNumber(t)).toBe(v));
  it("does not read '1 2 3' as one number", () => expect(parseNumber("1 2 3")).toBeNull());
  it("extracts money, percent and big plain numbers; ignores years and small numbers", () => {
    const f = extractFigures("In 2026 you get 52 000 kr, tax 32,4 %, and 3 steps over 12 months. Ref 5000.");
    expect(f.map((x) => [x.value, x.kind])).toEqual([[52000, "money"], [32.4, "percent"], [5000, "plain"]]);
  });
});

describe("H2: figures need a source", () => {
  it("accepts figures from the user's and notes' texts", () => expect(rules(GOOD)).toEqual([]));
  it("accepts engine numbers passed in", () => expect(rules("Net would be 38 649 kr. Want to see the anchor?", ctx({ allowedNumbers: [38649] }))).toEqual([]));
  it("rejects an invented figure", () => expect(rules("Most people in your role earn 61 500 kr. Shall we go on?")).toEqual(["H2"]));
  it("rejects an invented percentage", () => expect(rules("A typical raise is 7 %. Want me to check?")).toEqual(["H2"]));
  it("accepts written-out Swedish format of an allowed figure", () => expect(rules("Du vill ha 52.000 kr. Vill du gå vidare?")).toEqual([]));
});

describe("H5 questions, H7 gates, H10 next step", () => {
  it("rejects three questions", () => expect(rules("Where do you work? What do you earn? How long? ")).toContain("H5"));
  it("allows questions inside script examples", () => expect(rules('Say: "Can we talk about pay? Is Friday ok? Or Monday?" Does that work for you?', ctx({ stage: "scripts" }))).toEqual([]));
  it("rejects a target figure before the gate is open", () => expect(rules("Your target should be 52 000 kr. Agree?", ctx({ numbersGateOpen: false }))).toContain("H7"));
  it("allows a target figure once the gate is open", () => expect(rules("Your target is 52 000 kr. Agree?")).toEqual([]));
  it("flags a reply without a next step", () => expect(preSend("That is how anchoring works.", ctx()).findings.map((f) => f.rule)).toContain("H10"));
});

describe("H12 promises, H13 identity data", () => {
  it("rejects a promise", () => expect(rules("I guarantee they will accept this. Ready?")).toContain("H12"));
  it("rejects a claim to know their budget", () => expect(rules("I know their budget, it is high. Want a number?")).toContain("H12"));
  it("rejects Swedish promises", () => expect(rules("Jag garanterar att det går bra. Vill du fortsätta?")).toContain("H12"));
  it("rejects asking for a personnummer", () => expect(rules("Please share your personnummer so I can check. Okay?")).toContain("H13"));
  it("allows saying not to share it", () => expect(rules("You never need to give me a personnummer. What is your job title?")).toEqual([]));
});

describe("H20 author and course, H21 professional", () => {
  it.each(["In my course we practised this. Want to try?", "At NTU we learned that anchors matter. Want to try?", "As the slides say, anchor high. Next step?", "Som kursen visar ska du ankra högt. Vill du försöka?"])("rejects %s", (r) => expect(rules(r)).toContain("H20"));
  it("rejects naming a reasoning-only note", () => { const r = preSend("This links to Week 13 Coalitions and Job Negotiation. Shall we go on?", ctx()); expect(r.findings.some((f) => f.rule === "H20")).toBe(true); });
  it("allows ordinary negotiation talk", () => expect(rules("Anchoring means making the first offer. Based on: Anchoring. Want to set yours?")).toEqual([]));
  it.each(["Haha, good one. Next?", "Great plan 😀 Ready?", "In my experience this always works. Ready?", "När jag förhandlade gick det bra. Vill du börja?"])("rejects %s", (r) => expect(rules(r)).toContain("H21"));
});

describe("fallback and prompt", () => {
  it("fallback messages exist in both languages and pass the checks", () => { for (const l of ["en", "sv"] as const) expect(preSend(FALLBACK[l], ctx({ sources: [] })).ok).toBe(true); });
  it("the prompt holds all 21 rules, the persona, the language and the state", () => {
    for (let i = 1; i <= 21; i++) expect(HARD_RULES).toContain(`\n${i}. `);
    const p = buildSystemPrompt({ lang: "sv", path: "A", stage: "numbers", modifiers: ["competing_offer"] });
    expect(p).toContain("Svara på svenska"); expect(p).toContain("path A, stage numbers, modifiers competing_offer"); expect(p).toContain("Persona:");
  });
  it("the prompt never names the author or the course", () => expect(preSend(buildSystemPrompt({ lang: "en", stage: "route" }).split("20. ")[0]!, ctx()).findings.some((f) => f.rule === "H20")).toBe(false));
});

describe("decision-rule catalogue (ported rulecheck)", () => {
  it("59 rules, each in the catalogue and in exactly one concept note, identical text", () => {
    const r = checkRules(); expect(r.mismatches).toEqual([]); expect(r.catalogue).toBe(59); expect(r.inNotes).toBe(59);
  });
});
