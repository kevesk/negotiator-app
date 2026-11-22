import { describe, it, expect } from "vitest";
import { INDEX, retrieve, passesFilter, aliasMatches, findCiteNeverLeaks, renderForPrompt, tokenize } from "@/retrieval";
import type { Agent, Stage, RetrievalState } from "@/retrieval";

const dev = (o: Partial<RetrievalState> = {}): RetrievalState => ({ agent: "coach", path: "A", stage: "strategy", allowDraft: true, today: "2026-11-21", ...o });
const names = (q: string, s: RetrievalState) => retrieve(q, s).items.map((i) => i.note);

describe("index", () => {
  it("contains only retrievable notes with the required fields", () => {
    expect(INDEX.notes.length).toBeGreaterThan(200);
    for (const n of INDEX.notes) { expect(n.audience.length).toBeGreaterThan(0); expect(n.paths.length).toBeGreaterThan(0); expect(n.stages.length).toBeGreaterThan(0); }
  });
  it("every chunk belongs to an indexed note; related links point to indexed notes", () => {
    const set = new Set(INDEX.notes.map((n) => n.name));
    for (const c of INDEX.chunks) expect(set.has(c.note)).toBe(true);
    for (const n of INDEX.notes) for (const r of n.related) expect(set.has(r)).toBe(true);
  });
  it("Related and Sources sections are not embedded", () => { for (const c of INDEX.chunks) expect(/(^| > )(Related|Sources)$/i.test(c.heading)).toBe(false); });
  it("no wikilink syntax remains in chunk text", () => { for (const c of INDEX.chunks) expect(c.text.includes("[[")).toBe(false); });
});

describe("hard filter", () => {
  const agents: Agent[] = ["coach", "researcher", "writer", "critic"];
  const stages: Stage[] = ["intake", "position", "market", "numbers", "strategy", "scripts", "brief", "debrief"];
  const queries = ["how do I make a first offer", "BATNA walk-away", "salary range market data", "email to the employer", "counter offer", "skatt och nettolön"];
  it("never returns a note that fails the filter, for any agent, path, stage and query", () => {
    const byName = new Map(INDEX.notes.map((n) => [n.name, n]));
    for (const agent of agents) for (const path of ["A", "B"] as const) for (const stage of stages) for (const q of queries) {
      const st = dev({ agent, path, stage, modifiers: ["competing_offer"] });
      const hits = aliasMatches(q);
      for (const it of retrieve(q, st).items) {
        const n = byName.get(it.note)!;
        // a note passes the filter, or the message named it by alias and it passes with the stage and modifier gates waived
        const ok = passesFilter(n, st) || (hits.has(n.name) && passesFilter(n, { ...st, modifiers: n.modifiers, stage: n.stages[0] ?? st.stage }));
        expect(ok, `${agent}/${path}/${stage}/${q}: ${it.note}`).toBe(true);
      }
    }
  });
  it("never returns roleplay personas or scenarios to the coach", () => {
    const hidden = new Set(INDEX.notes.filter((n) => n.type === "persona" || n.type === "scenario").map((n) => n.name));
    expect(hidden.size).toBeGreaterThan(0);
    for (const stage of ["practice", "strategy", "debrief"] as Stage[]) for (const q of ["employer hidden budget", "roleplay counterpart", "hiring manager persona", "salary negotiation practice"])
      for (const it of retrieve(q, dev({ stage })).items) expect(hidden.has(it.note)).toBe(false);
  });
  it("the researcher sees researcher notes, the coach does not see benchmark notes", () => {
    const bench = new Set(INDEX.notes.filter((n) => n.type === "benchmark").map((n) => n.name));
    for (const it of retrieve("salary benchmark engineering", dev({ stage: "market" })).items) expect(bench.has(it.note)).toBe(false);
  });
  it("release mode needs reviewed or final status, so draft notes give nothing", () => expect(retrieve("BATNA", dev({ allowDraft: false })).items).toEqual([]));
  it("modifier notes only appear when the modifier is active", () => {
    const mod = INDEX.notes.filter((n) => n.modifiers.includes("fixed_scale") && n.audience.includes("coach") && n.stages.includes("strategy") && n.paths.includes("A") && n.modifiers.length === 1);
    expect(mod.length).toBeGreaterThan(0);
    for (const n of mod) expect(passesFilter(n, dev())).toBe(false), expect(passesFilter(n, dev({ modifiers: ["fixed_scale"] }))).toBe(true);
  });
});

describe("ranking", () => {
  it("an explicit alias reaches a modifier-gated note before the modifier is set", () => {
    expect(names("är jag anställd under kollektivavtal?", dev({ stage: "intake" }))).toContain("Collective-Agreements");
    expect(names("how do I negotiate a bonus", dev({ stage: "intake" }))).not.toContain("Collective-Agreements");
  });
  it("finds BATNA for a BATNA query", () => expect(names("What is my BATNA?", dev({ stage: "position" }))).toContain("BATNA"));
  it("finds the anchoring concept for 'first offer'", () => expect(names("should I make the first offer and anchor high", dev())).toEqual(expect.arrayContaining(["Anchoring"])));
  it("Swedish alias: skiktgräns finds the tax thresholds note", () => expect(names("hur funkar skiktgränsen för min lön", dev({ stage: "numbers" }))).toContain("Income-Tax-Thresholds"));
  it("Swedish alias: märket finds the industry benchmark note", () => { const hits = [...aliasMatches("vad är märket i min bransch")]; expect(hits.length).toBeGreaterThan(0); });
  it("returns one chunk per note", () => { const it = retrieve("anchoring first offer counteroffer", dev()).items.map((i) => i.note); expect(new Set(it).size).toBe(it.length); });
  it("respects the cap and the character budget", () => { const r = retrieve("negotiation salary offer", dev(), { maxChunks: 5, charBudget: 3000 }); expect(r.items.length).toBeLessThanOrEqual(5); expect(r.chars).toBeLessThanOrEqual(3000); });
  it("one-hop expansion adds linked notes marked as links", () => { const r = retrieve("BATNA", dev({ stage: "position" })); expect(r.items.some((i) => i.via === "link")).toBe(true); });
  it("falls back to the stage note when nothing matches", () => { const r = retrieve("zzzqqq xxyyzz", dev({ stage: "numbers" })); expect(r.fallback).toBe(true); expect(r.items[0]?.note).toBe("Numbers-Stage"); });
  it("is deterministic", () => expect(retrieve("anchor", dev())).toEqual(retrieve("anchor", dev())));
  it("tokenizer keeps Swedish letters", () => expect(tokenize("Skiktgränsen för lönen")).toContain("skiktgränsen"));
});

describe("special handling", () => {
  it("flags unverified law and tax notes and outdated facts", () => {
    const r = retrieve("pay transparency directive Sweden law", dev({ stage: "market" }), { maxChunks: 8 });
    const flagged = r.items.filter((i) => i.flags.verify_before_use);
    expect(flagged.length).toBeGreaterThan(0);
    expect(renderForPrompt(flagged)).toContain("UNVERIFIED");
    const old = retrieve("tax", dev({ stage: "numbers", today: "2027-02-01" })).items.filter((i) => i.flags.outdated);
    expect(old.length).toBeGreaterThan(0);
  });
  it("cite-never items are marked reasoning-only in the prompt", () => {
    const item = { title: "X", heading: "", text: "secret reasoning", cite: "never" as const, flags: { verify_before_use: false, outdated: false, valid_as_of: null, confidence: null } };
    expect(renderForPrompt([item])).toContain("REASONING ONLY");
  });
  it("the leak check catches a cite-never title in a reply and ignores ordinary words", () => {
    const never = INDEX.notes.find((n) => n.cite === "never")!;
    expect(findCiteNeverLeaks(`As discussed in ${never.title}, you should...`)).toContain(never.name);
    expect(findCiteNeverLeaks("Start by writing down your walk-away number.")).toEqual([]);
  });
});

describe("alias waiver covers the stage gate", () => {
  it("a note named by its alias is found even at a stage it is not listed for", () => {
    const r = retrieve("Gäller lönetransparensdirektivet redan?", { agent: "coach", path: "A", stage: "route", modifiers: [], allowDraft: true, today: "2026-11-22" });
    expect(r.items.map((i) => i.note)).toContain("Pay-Transparency-Status");
  });
  it("without the alias the note stays out of the route stage", () => {
    const r = retrieve("Is this about a job offer?", { agent: "coach", path: "A", stage: "route", modifiers: [], allowDraft: true, today: "2026-11-22" });
    expect(r.items.map((i) => i.note)).not.toContain("Pay-Transparency-Status");
  });
});
