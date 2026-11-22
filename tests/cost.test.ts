import { describe, it, expect } from "vitest";
import { modelFor, systemBlocks, FAST_MODEL, DEFAULT_MODEL } from "@/server/anthropic";
import { runTurn } from "@/orchestrator/turn";
import { newState, setSlot } from "@/orchestrator/state";
import type { ChatModel, ModelRequest } from "@/orchestrator/model";

describe("which model does what", () => {
  it("the small jobs use the fast model", () => { for (const p of ["extract", "setup", "judge"] as const) expect(modelFor(p, DEFAULT_MODEL, FAST_MODEL)).toBe(FAST_MODEL); });
  it("everything the user reads uses the main model", () => { for (const p of ["reply", "rewrite", "script", "critic"] as const) expect(modelFor(p, DEFAULT_MODEL, FAST_MODEL)).toBe(DEFAULT_MODEL); });
});

describe("prompt caching", () => {
  it("splits a cached prefix from the rest", () => {
    const b = systemBlocks({ system: "RULES\nstate", cachePrefix: "RULES\n" }) as { text: string; cache_control?: unknown }[];
    expect(b).toHaveLength(2); expect(b[0]).toMatchObject({ text: "RULES\n", cache_control: { type: "ephemeral" } }); expect(b[1]!.text).toBe("state"); expect(b[1]!.cache_control).toBeUndefined();
  });
  it("sends a plain string when there is no usable prefix", () => {
    expect(systemBlocks({ system: "abc" })).toBe("abc"); expect(systemBlocks({ system: "abc", cachePrefix: "xyz" })).toBe("abc");
    expect(systemBlocks({ system: "abc", cachePrefix: "abc" })).toHaveLength(1);
  });

  const record = (reply: string): ChatModel & { calls: ModelRequest[] } => {
    const calls: ModelRequest[] = [];
    return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? "{}" : reply; } };
  };
  it("the coach prompt starts with the same cached part on different turns and stages", async () => {
    const m1 = record("Is this about a job offer, or a salary discussion at the job you have now?");
    await runTurn({ model: m1 }, newState("en"), "Hi");
    const s = newState("en"); setSlot(s, "path", "A", "user"); setSlot(s, "a_phase", "offer_received", "user");
    const m2 = record("What is the role title, and how many years of experience do you have?");
    await runTurn({ model: m2 }, s, "I got an offer");
    const r1 = m1.calls.find((c) => c.purpose === "reply")!, r2 = m2.calls.find((c) => c.purpose === "reply")!;
    expect(r1.cachePrefix!.length).toBeGreaterThan(2000); expect(r1.cachePrefix).toBe(r2.cachePrefix);
    expect(r1.system.startsWith(r1.cachePrefix!)).toBe(true); expect(r2.system.startsWith(r2.cachePrefix!)).toBe(true);
    expect(r1.cachePrefix).not.toContain("Current state:"); // the per-turn state stays outside the cache
  });
  it("the extraction prompt caches everything but the list of facts still needed", async () => {
    const m1 = record("x"), m2 = record("x");
    await runTurn({ model: m1 }, newState("en"), "Hi");
    const s = newState("en"); setSlot(s, "path", "A", "user"); await runTurn({ model: m2 }, s, "An offer");
    const e1 = m1.calls.find((c) => c.purpose === "extract")!, e2 = m2.calls.find((c) => c.purpose === "extract")!;
    expect(e1.cachePrefix).toBe(e2.cachePrefix); expect(e1.cachePrefix).not.toContain("Slots still needed"); expect(e1.system).toContain("Slots still needed");
  });
});
