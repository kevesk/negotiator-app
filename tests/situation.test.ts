import { describe, it, expect } from "vitest";
import { situationNotes, situationCatalogue, situationGuide, isSituation } from "@/retrieval/situation";
import { parseExtraction, extractionPrompt } from "@/orchestrator/extract";
import { runTurn } from "@/orchestrator/turn";
import { newState, setSlot } from "@/orchestrator/state";
import type { ChatModel, ModelRequest } from "@/orchestrator/model";

const rs = { agent: "coach" as const, path: "A" as const, stage: "position" as const, modifiers: [], allowDraft: true, today: "2026-11-22" };

describe("situation notes", () => {
  it("lists flow, tactic and Sweden notes for the coach, not indexes or intake notes", () => {
    const names = situationNotes().map((n) => n.name);
    expect(names).toContain("A-Handling-Deadlines"); expect(names).toContain("Budget-Is-Fixed"); expect(names).toContain("Package-Scoring-Guide");
    expect(names.some((n) => /-Index$|-Overview$/.test(n))).toBe(false); expect(names).not.toContain("A-Intake");
  });
  it("the catalogue names each note once with its aliases", () => { const c = situationCatalogue(); expect(c).toMatch(/^A-Handling-Deadlines: .*exploding offer/m); });
  it("gives the full guidance of a note whose modifier is not set, without related, sources or examples", () => {
    const g = situationGuide("A-Handling-Deadlines", rs)!;
    expect(g).not.toBeNull(); expect(g.text).toContain("What the coach does"); expect(g.text).not.toMatch(/^(Related|Sources|Example)/m); expect(g.text.length).toBeLessThanOrEqual(3000);
  });
  it("refuses a note outside the catalogue or on the wrong path", () => {
    expect(situationGuide("BATNA", rs)).toBeNull();
    expect(situationGuide("B-When-the-Answer-Is-No", rs)).toBeNull(); // a Path B note on Path A
    expect(situationGuide("B-When-the-Answer-Is-No", { ...rs, path: "B", stage: "position" })).not.toBeNull();
  });
  it("the extraction keeps at most two known situation names", () => {
    const e = parseExtraction('{"slots":{},"situations":["A-Handling-Deadlines","Made-Up-Note","Exploding-Deadline","Competing-Offer"]}', isSituation);
    expect(e.situations).toEqual(["A-Handling-Deadlines", "Exploding-Deadline"]);
  });
  it("the extraction prompt carries the catalogue only when given", () => {
    expect(extractionPrompt([])).not.toContain("situations:"); expect(extractionPrompt([], "X: y")).toContain("X: y");
  });
});

describe("situation guidance in the turn", () => {
  const scripted = (extract: string, reply: string): ChatModel & { calls: ModelRequest[] } => {
    const calls: ModelRequest[] = [];
    return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? extract : reply; } };
  };
  it("puts the chosen note's guidance first in the coach prompt", async () => {
    const s = newState("en"); setSlot(s, "path", "A", "user"); setSlot(s, "a_phase", "offer_received", "user");
    const m = scripted('{"slots":{},"situations":["A-Handling-Deadlines"]}', "A one-day deadline is often a position, not a fact. What is behind it?");
    const r = await runTurn({ model: m }, s, "They want an answer by tomorrow or the offer is gone.");
    const sys = m.calls.find((c) => c.purpose === "reply")!.system;
    expect(sys).toContain("Situation guidance"); expect(sys).toContain("What the coach does"); expect(r.state.notesUsed).toContain("A-Handling-Deadlines");
  });
  it("without a situation the generic topic-first line stays", async () => {
    const m = scripted("{}", "Is this about a job offer, or a salary discussion at the job you have now?");
    await runTurn({ model: m }, newState("en"), "Hi");
    expect(m.calls.find((c) => c.purpose === "reply")!.system).not.toContain("Situation guidance");
  });
});

describe("the user's own figures", () => {
  it("repeating a walk-away the user gave is not blocked before the numbers stage", async () => {
    const s = newState("en"); setSlot(s, "path", "A", "user"); setSlot(s, "a_phase", "offer_received", "user"); setSlot(s, "walk_away", 60000, "user");
    const m: ChatModel = { async complete(req) { return req.purpose === "extract" ? "{}" : "Your walk-away of 60 000 stays fixed. What is the role title?"; } };
    const r = await runTurn({ model: m }, s, "Which package should I pick?");
    expect(r.usedFallback).toBe(false); expect(r.findings.map((f) => f.rule)).not.toContain("H7");
  });
  it("a walk-away figure the user never gave is still blocked", async () => {
    const s = newState("en"); setSlot(s, "path", "A", "user"); setSlot(s, "a_phase", "offer_received", "user");
    const m: ChatModel = { async complete(req) { return req.purpose === "extract" ? "{}" : "Set your walk-away at 61 000. What is the role title?"; } };
    const r = await runTurn({ model: m }, s, "Which package should I pick?");
    expect(r.usedFallback).toBe(true);
  });
});
