import { describe, it, expect } from "vitest";
import { newState, setSlot, workPlan, runTurn, type SessionState, type ChatModel, type ModelRequest } from "@/orchestrator";

// Live bug: answering the channel question ("phone") ran the script writer, then the whole brief (reply, critic, rewrite,
// critic again) in the same request, which passed the server's time limit, so the user saw an error on every retry.
const fill = (s: SessionState, o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) setSlot(s, k, v, "user"); return s; };
const atScripts = () => {
  const s = fill(newState("sv"), { path: "B", b_situation: "annual_review", role_title: "Bolånerådgivare", experience_years: 5, location: "Linköping", current_base: 38000, achievements: ["a"], ask_type: "raise", priorities: ["pay"], negotiate_scope: "salary only", batna: "look for other jobs", own_target: 44000, walk_away: 41000, counterpart: "my manager" });
  s.outputs.evidence_summary = {}; s.outputs.market_range = { unavailable: true };
  s.outputs.numbers = { defaultAnchor: { amount: 48000 }, concession: { steps: [{ amount: 2000 }, { amount: 1200 }, { amount: 800 }] } };
  setSlot(s, "first_offer", 48000, "user");
  return s;
};
const SCRIPT = JSON.stringify({ parts: [
  { id: "opening", text: "Tack för att du tar dig tid." }, { id: "ask", text: "Jag föreslår 48 000 kr i månaden.", numbers_used: [48000] },
  { id: "objection", objection: "Nej", text: "Vad skulle krävas?" }, { id: "objection", objection: "Det går inte att förhandla", text: "Vad kan vi titta på?" },
  { id: "trade", text: "Om vi landar på 46 000 kr, kan vi då bestämma en översyn?", numbers_used: [46000] }, { id: "close", text: "Ska vi sammanfatta?" }, { id: "time", text: "Får jag fundera till i morgon?" },
], email: { subject: "Lön", body: "Hej, jag föreslår 48 000 kr i månaden." }, assumptions: [], provisional: false });
const model = (): ChatModel & { calls: ModelRequest[] } => { const calls: ModelRequest[] = []; return { calls, async complete(req) { calls.push(req); return req.purpose === "extract" ? "{}" : req.purpose === "script" ? SCRIPT : req.purpose === "critic" ? '{"verdict":"pass","findings":[],"checks_failed":[]}' : "Här är ditt manus. Vill du gå vidare till underlaget?"; } }; };

describe("the channel answer", () => {
  for (const channel of ["phone", "in person", "video", "email", "unknown"]) {
    it(`"${channel}": the turn that writes the scripts shows them and does not also write the brief`, async () => {
      const s = atScripts(); expect(workPlan(s).stage).toBe("scripts");
      setSlot(s, "channel", channel, "user");
      const m = model(); const r = await runTurn({ model: m }, s, channel);
      expect(r.plan.stage).toBe("scripts"); expect(r.isBrief).toBe(false);
      expect(m.calls.map((c) => c.purpose)).not.toContain("critic");
      expect(r.state.outputs.scripts).toBeTruthy();
      const r2 = await runTurn({ model: model() }, r.state, "gå vidare");
      expect(r2.plan.stage).toBe("brief");
    });
  }
  it("a skipped channel behaves the same", async () => {
    const s = atScripts(); const m = model(); const r = await runTurn({ model: m }, s, "hoppa över", { skip: true });
    expect(r.plan.stage).toBe("scripts"); expect(m.calls.map((c) => c.purpose)).not.toContain("critic");
  });
});
