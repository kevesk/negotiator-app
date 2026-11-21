import { FLOW, SLOT_DEFS } from "./flow.generated";
import { setSlot, type SessionState } from "./state";
import type { ChatModel } from "./model";

const MODIFIERS = Object.keys(FLOW.modifiers);
/** Slots the user may supply; derived values come from tools. A range typed in by the user is allowed (thin slice). */
const ALLOWED = new Set([...Object.keys(SLOT_DEFS).filter((id) => id !== "language"), "market_range"]);

export interface Extraction { slots: Record<string, { value: unknown; unit?: string }>; modifiers: string[] }

export function extractionPrompt(missing: string[]): string {
  return [
    "Read the user's latest message and extract facts into slots. Output ONLY one JSON object, no prose:",
    '{"slots": {"<slot_id>": {"value": <value>, "unit": "<optional unit>"}}, "modifiers": ["<modifier>"]}',
    "Rules: use only ids from the allowed list; include a slot only if the user clearly stated it; never guess; money is SEK, monthly gross unless the user says otherwise (keep their unit in `unit`); dates are ISO; booleans for yes/no.",
    `Slots still needed (prefer these): ${missing.join(", ") || "none"}.`,
    `Allowed ids: ${[...ALLOWED].join(", ")}.`,
    `Allowed modifiers: ${MODIFIERS.join(", ")}.`,
  ].join("\n");
}
/** Parses a model's extraction reply defensively: anything unusable is dropped, never guessed. */
export function parseExtraction(text: string): Extraction {
  const out: Extraction = { slots: {}, modifiers: [] };
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return out;
  let j: any; try { j = JSON.parse(text.slice(a, b + 1)); } catch { return out; }
  if (j && typeof j.slots === "object" && j.slots) for (const [id, v] of Object.entries<any>(j.slots)) {
    if (!ALLOWED.has(id) || v === null || typeof v !== "object" || !("value" in v) || v.value === null || v.value === undefined || v.value === "") continue;
    out.slots[id] = { value: v.value, unit: typeof v.unit === "string" ? v.unit : undefined };
  }
  if (Array.isArray(j?.modifiers)) out.modifiers = j.modifiers.filter((m: unknown) => typeof m === "string" && MODIFIERS.includes(m));
  return out;
}
/** Applies an extraction to the state as `[user]` data. Returns the ids that changed. */
export function applyExtraction(s: SessionState, e: Extraction): string[] {
  const changed: string[] = [];
  for (const [id, v] of Object.entries(e.slots)) if (setSlot(s, id, v.value, "user", { unit: v.unit })) changed.push(id);
  for (const m of e.modifiers) if (!s.modifiers.includes(m)) s.modifiers.push(m);
  return changed;
}
export async function extractSlots(model: ChatModel, s: SessionState, message: string, missing: string[]): Promise<Extraction> {
  const reply = await model.complete({ purpose: "extract", system: extractionPrompt(missing), messages: [...s.messages.slice(-4), { role: "user", content: message }] });
  return parseExtraction(reply);
}
