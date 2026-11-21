import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { handleChat, LIMITS } from "@/server/chat";
import { normaliseMessages } from "@/server/anthropic";
import { newState, type ChatModel } from "@/orchestrator";

const fake = (reply = "Is this about a job offer, or a salary discussion at the job you have now?"): ChatModel => ({ async complete(r) { return r.purpose === "extract" ? "{}" : reply; } });

describe("chat endpoint logic", () => {
  it("503 when no API key is configured", async () => expect((await handleChat({ message: "hi", language: "en" }, null)).status).toBe(503));
  it("400 on an empty message", async () => expect((await handleChat({ message: "  ", language: "en" }, fake())).status).toBe(400));
  it("413 on a very long message", async () => expect((await handleChat({ message: "x".repeat(LIMITS.message + 1), language: "en" }, fake())).status).toBe(413));
  it("400 without a language for a new session", async () => expect((await handleChat({ message: "hi" }, fake())).status).toBe(400));
  it("400 on a malformed state", async () => { expect((await handleChat({ message: "hi", state: { nope: 1 } }, fake())).status).toBe(400); expect((await handleChat({ message: "hi", state: { ...newState("en"), messages: [{ role: "system", content: "x" }] } }, fake())).status).toBe(400); });
  it("runs a turn and returns the new state, the sidebar step and no server-side copy", async () => {
    const r = await handleChat({ message: "hi", language: "en" }, fake()); const b = r.body as any;
    expect(r.status).toBe(200); expect(b.state.turn).toBe(1); expect(b.sidebar).toBe("Situation"); expect(b.reply).toContain("job offer");
    const r2 = await handleChat({ message: "I got an offer", state: b.state }, fake("Thanks. What is the role title?")); expect(r2.status).toBe(200); expect((r2.body as any).state.turn).toBe(2);
  });
  it("502 without content when the model fails", async () => {
    const bad: ChatModel = { async complete() { throw new Error("secret user text"); } };
    const r = await handleChat({ message: "my salary is 40 000", language: "en" }, bad); expect(r.status).toBe(502); expect(JSON.stringify(r.body)).not.toContain("secret");
  });
});
describe("model client helpers", () => {
  it("makes messages start with the user and alternate", () => {
    expect(normaliseMessages([{ role: "assistant", content: "hi" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "" }, { role: "assistant", content: "c" }]))
      .toEqual([{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" }]);
  });
});
describe("browser bundle stays clean", () => {
  it("client components never import the index, the retrieval code or server code", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk("src/app").filter((x) => /\.(tsx?)$/.test(x) && !x.includes(`${path.sep}api${path.sep}`))) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "@\/(retrieval|server|checks|engine|agents)[/"]/);
      expect(src, f).not.toMatch(/from "@\/orchestrator"/);
      expect(src, f).not.toMatch(/data\/index\.json/);
    }
  });
});
