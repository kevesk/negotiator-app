import { runScripts, type ScriptInput, type ScriptsOutput } from "@/agents/scripts";
import { retrieve, renderForPrompt } from "@/retrieval";
import { slotValue, type SessionState } from "./state";
import type { ChatModel } from "./model";
import type { NumbersResult } from "./tools";
import { STAGE_GOAL } from "./controller";

/** Slots the script writer must never see: the walk-away and the target (D: scripts hold only approved figures). */
const HIDDEN = new Set(["own_target", "walk_away"]);
export function factsFor(s: SessionState): string {
  return Object.entries(s.slots).filter(([k, v]) => !v.stale && !HIDDEN.has(k)).map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)} [${v.source}]`).join("\n");
}
/** The anchor and the positions after each concession, from the numbers engine's plan. */
export function approvedFrom(n: NumbersResult, offer?: number): ScriptInput["approved"] {
  const anchor = n.defaultAnchor.amount; let pos = anchor; const positions: number[] = [];
  for (const st of n.concession.steps) { pos -= st.amount; positions.push(pos); }
  return { anchor, positions, offer };
}
export function scriptInputFrom(s: SessionState, today?: string, allowDraft = true): ScriptInput | null {
  const n = s.outputs.numbers as NumbersResult | undefined; if (!n?.defaultAnchor) return null;
  const offer = slotValue<number | { amount?: number }>(s, "offer_base"); const offerMonthly = typeof offer === "number" ? offer : undefined;
  const r = retrieve([STAGE_GOAL.scripts, String(slotValue(s, "channel") ?? "")].join(" "), { agent: "writer", path: slotValue<"A" | "B">(s, "path") ?? "A", stage: "scripts", modifiers: s.modifiers, allowDraft, today });
  const walk = slotValue<number>(s, "walk_away");
  return { lang: s.language, channel: String(slotValue(s, "channel") ?? ""), facts: factsFor(s), approved: approvedFrom(n, s.slots.offer_base?.unit ? undefined : offerMonthly), forbidden: typeof walk === "number" ? [walk] : [], notes: renderForPrompt(r.items) };
}
export async function runScriptTool(s: SessionState, model: ChatModel, today?: string, allowDraft = true): Promise<ScriptsOutput | { failed: true; errors?: string[] }> {
  const input = scriptInputFrom(s, today, allowDraft); if (!input) return { failed: true, errors: ["the numbers stage has not produced an anchor"] };
  const r = await runScripts(model, input);
  return r.ok && r.value ? r.value : { failed: true, errors: r.errors };
}
