import { slotValue, setSlot, type SessionState } from "./state";

const TIME_SENSITIVE = ["offer_deadline", "review_date"];
const HEAD = "SESSION SUMMARY v1";
/** The paste-back summary: slots with their source tags, the numbers and the language. Contains no original documents. */
export function toSummary(s: SessionState): string {
  const slots = Object.fromEntries(Object.entries(s.slots).filter(([, v]) => !v.stale).map(([k, v]) => [k, { value: v.value, unit: v.unit, source: v.source }]));
  return `${HEAD}\n\`\`\`json\n${JSON.stringify({ language: s.language, modifiers: s.modifiers, slots, numbers: s.outputs.numbers ?? null }, null, 1)}\n\`\`\``;
}
/** Reads a pasted summary as `[user]` data. Time-sensitive items are returned for the coach to confirm. */
export function fromSummary(text: string, s: SessionState): { ok: boolean; confirm: string[]; unreadable?: string } {
  if (!text.includes(HEAD)) return { ok: false, confirm: [], unreadable: "not a session summary" };
  const m = text.match(/```json\n([\s\S]*?)\n```/); if (!m) return { ok: false, confirm: [], unreadable: "no data block" };
  let j: any; try { j = JSON.parse(m[1]!); } catch { return { ok: false, confirm: [], unreadable: "data block could not be read" }; }
  if (!j || typeof j.slots !== "object") return { ok: false, confirm: [], unreadable: "no slots" };
  for (const [id, v] of Object.entries<any>(j.slots)) if (v && "value" in v) setSlot(s, id, v.value, "user", { unit: v.unit, note: v.source !== "user" ? `was ${v.source}` : undefined });
  if (Array.isArray(j.modifiers)) s.modifiers = [...new Set([...s.modifiers, ...j.modifiers])];
  return { ok: true, confirm: TIME_SENSITIVE.filter((id) => slotValue(s, id) !== undefined) };
}
