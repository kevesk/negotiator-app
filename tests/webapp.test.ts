import { describe, it, expect, vi } from "vitest";
import { parseEvent, recordEvent, type AppEvent, type CounterStore } from "@/server/events";
import { handleChat } from "@/server/chat";
import { T } from "@/app/ui-text";
import type { ChatModel } from "@/orchestrator";

describe("anonymous counters", () => {
  it("accepts only the known events and drops anything else", () => {
    expect(parseEvent({ event: "rating", value: "useful" })).toEqual({ event: "rating", value: "useful" });
    expect(parseEvent({ event: "brief_produced" })).toEqual({ event: "brief_produced" });
    for (const bad of [null, "x", { event: "rating", value: "great" }, { event: "error", type: "my salary is 50000" }, { event: "other" }]) expect(parseEvent(bad)).toBeNull();
  });
  it("an event holds no content, even if extra fields are sent", () => {
    const e = parseEvent({ event: "rating", value: "useful", text: "secret", sessionId: "abc", ip: "1.2.3.4" }); expect(JSON.stringify(e)).toBe('{"event":"rating","value":"useful"}');
  });
  it("a failing store never breaks the app", () => { expect(() => recordEvent({ event: "brief_produced" }, { record() { throw new Error("down"); } })).not.toThrow(); });
  it("model errors are counted without content", async () => {
    const seen: AppEvent[] = []; const store: CounterStore = { record: (e) => void seen.push(e) };
    const bad: ChatModel = { async complete() { throw new Error("boom: my salary is 50 000"); } };
    const r = await handleChat({ message: "hi", language: "en" }, bad, "2026-11-22", undefined, store);
    expect(r.status).toBe(502); expect(seen).toEqual([{ event: "error", type: "model_error" }]); expect(JSON.stringify(seen)).not.toContain("50 000");
  });
  it("the chat response says whether the reply is the first brief", async () => {
    const m: ChatModel = { async complete(r) { return r.purpose === "extract" ? "{}" : "Is it an offer or your current job?"; } };
    const r = await handleChat({ message: "hi", language: "en" }, m, "2026-11-22"); expect((r.body as { brief: boolean }).brief).toBe(false);
  });
});
describe("interface text", () => {
  it("has every new label in both languages", () => {
    for (const k of ["notice", "privacy", "copy", "copied", "savePdf", "briefReady", "ratingQ", "ratingThanks"] as const) { expect(T.en[k].length).toBeGreaterThan(2); expect(T.sv[k].length).toBeGreaterThan(2); }
    expect(Object.keys(T.en.ratings)).toEqual(Object.keys(T.sv.ratings));
  });
  it("the provider notice says what is true: the service stores nothing, a provider processes the text", () => { expect(T.en.notice).toMatch(/AI provider/); expect(T.en.notice).toMatch(/stores nothing/); expect(T.sv.notice).toMatch(/AI-leverantör/); });
});
vi.restoreAllMocks();
