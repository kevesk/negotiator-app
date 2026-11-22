import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Markdown } from "@/app/markdown";
import { splitTrailer, finalSuggestions, nextStepText, defaultSuggestions } from "@/orchestrator/guide";
import { runTurn, newState, type ChatModel } from "@/orchestrator";
import { handleChat } from "@/server/chat";

const html = (t: string) => renderToStaticMarkup(createElement(Markdown, { text: t }));
describe("markdown", () => {
  it("turns **word** into bold and leaves no asterisks", () => {
    const h = html("This is **important** and **very, very** key.\n\n- one **a**\n- two\n\nStray ** and *half"); expect(h).toContain("<strong>important</strong>"); expect(h).toContain("<li>one <strong>a</strong></li>"); expect(h).not.toContain("*");
  });
  it("renders italics, numbered lists, headings and tables", () => {
    const h = html("## Title\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nan *emphasised* word"); expect(h).toContain("<strong>Title</strong>"); expect(h).toContain("<ol>"); expect(h).toContain("<th>A</th>"); expect(h).toContain("<em>emphasised</em>");
  });
  it("never injects HTML", () => expect(html("<script>x</script> **b**")).not.toContain("<script>"));
});
describe("suggestions", () => {
  it("splits the trailer from the reply", () => {
    const r = splitTrailer("Hello.\n\nWhat next?\n<suggestions>\n- **A** one\n- Two\n3. Three\n</suggestions>"); expect(r.body).toBe("Hello.\n\nWhat next?"); expect(r.suggestions).toEqual(["A one", "Two", "Three"]);
  });
  it("always returns exactly three, filling with safe defaults", () => {
    const s = finalSuggestions(["Only one"], "market", "en", () => true, ""); expect(s).toHaveLength(3); expect(s[0]).toBe("Only one");
    expect(finalSuggestions([], "route", "sv", () => true, "")).toEqual(defaultSuggestions("route", "sv"));
  });
  it("drops invented figures and anything that fails the checks", () => {
    expect(finalSuggestions(["My target is 62 000 SEK", "Maybe"], "market", "en", () => true, "I earn 50 000")).not.toContain("My target is 62 000 SEK");
    expect(finalSuggestions(["a b", "c d", "e f"], "intake", "en", () => false, "")).toEqual(defaultSuggestions("intake", "en"));
  });
  it("has a next step for every stage in both languages", () => { for (const st of ["route", "intake", "position", "market", "numbers", "strategy", "scripts", "brief", "debrief"] as const) for (const l of ["en", "sv"] as const) expect(nextStepText(st, "B", l).length).toBeGreaterThan(10); });
});
describe("turn and endpoint", () => {
  const model = (reply: string): ChatModel => ({ async complete(r) { return r.purpose === "extract" ? "{}" : reply; } });
  it("returns the next step and three suggestions, and hides the trailer from the reply", async () => {
    const r = await runTurn({ model: model("Is it a new offer or your current job?\n<suggestions>\n- A new offer\n- My current job\n- Not sure\n</suggestions>") }, newState("en"), "Hi");
    expect(r.reply).not.toContain("suggestions"); expect(r.suggestions).toEqual(["A new offer", "My current job", "Not sure"]); expect(r.next.length).toBeGreaterThan(10);
  });
  it("falls back to defaults when the model gives no suggestions, and the endpoint passes them on", async () => {
    const res = await handleChat({ message: "Hi", language: "en" }, model("Is it a new offer or your current job?")); const b = res.body as any;
    expect(b.suggestions).toHaveLength(3); expect(b.next).toBeTruthy(); expect(b.reply).not.toContain("<");
  });
});
describe("checklists", () => { it("shows task-list items as checkboxes", () => { const h = html("- [ ] Print this\n- [x] Done"); expect(h).toContain("☐ Print this"); expect(h).toContain("☑ Done"); }); });

describe("coach style rules come from the vault", () => {
  it("one rule per line, generated from Coach-Persona-and-Rules", async () => {
    const { COACH_STYLE } = await import("@/orchestrator/guide");
    const gen = await import("@/agents/hard-rules.generated");
    expect(COACH_STYLE).toBe(gen.COACH_STYLE); expect(COACH_STYLE.split("\n").length).toBeGreaterThanOrEqual(14);
    expect(COACH_STYLE).toContain("*Based on:"); expect(COACH_STYLE).not.toMatch(/\*\*[^*]+\.\*\*/); // labels stay in the vault
  });
});
