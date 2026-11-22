import type { Stage } from "@/retrieval";

export type Source = "user" | "researcher" | "computed" | "assumed";
export type Lang = "en" | "sv";
export interface SlotValue { value: unknown; unit?: string; source: Source; setAt: number; stale?: boolean; note?: string }
export interface SessionState {
  language: Lang;
  stage: Stage;
  modifiers: string[];
  slots: Record<string, SlotValue>;
  turn: number;
  notesUsed: string[];
  /** Tool results, kept in memory for the session only. */
  outputs: Record<string, unknown>;
  /** The user's own messages, used to trace figures (rule 2). */
  userTexts: string[];
  /** Stages that must be recomputed after a change. */
  recompute: string[];
  /** The conversation so far (session only). */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Pre-send failures, for the evals (no content kept beyond rule ids). */
  failures: string[];
  /** True once the user has said they are done; the app then shows the end of the session. */
  finished?: boolean;
}
export const newState = (language: Lang): SessionState => ({ language, stage: "route", modifiers: [], slots: {}, turn: 0, notesUsed: [], outputs: {}, userTexts: [], recompute: [], messages: [], failures: [] });
export const clone = (s: SessionState): SessionState => structuredClone(s);

export const slotValue = <T = unknown>(s: SessionState, id: string): T | undefined => { const v = s.slots[id]; return v && !v.stale && v.value !== null && v.value !== undefined ? (v.value as T) : undefined; };
export const isSet = (s: SessionState, id: string): boolean => slotValue(s, id) !== undefined;
export const pathOf = (s: SessionState): "A" | "B" | undefined => { const p = slotValue<string>(s, "path"); return p === "A" || p === "B" ? p : undefined; };

/** What a changed slot invalidates (Coach-Orchestrator-Spec: Going back and stale values). */
const DEPENDENTS: { when: (id: string) => boolean; outputs: string[]; stages: string[] }[] = [
  { when: (id) => ["path", "a_phase", "b_situation"].includes(id), outputs: ["offer_analysis", "market_range", "numbers", "scripts", "brief"], stages: ["intake", "position", "market", "numbers", "strategy", "scripts", "brief"] },
  { when: (id) => ["role_title", "experience_years", "industry", "employer_type", "location", "work_mode", "collective_agreement"].includes(id), outputs: ["market_range", "numbers", "scripts", "brief"], stages: ["market", "numbers", "strategy", "scripts", "brief"] },
  { when: (id) => ["own_target", "walk_away", "batna", "other_offers"].includes(id), outputs: ["numbers", "scripts", "brief"], stages: ["numbers", "strategy", "scripts", "brief"] },
  { when: (id) => id.startsWith("offer_"), outputs: ["offer_analysis", "numbers", "brief"], stages: ["position", "numbers", "brief"] },
  { when: (id) => ["priorities", "issue_weights", "option_values", "package_issues"].includes(id), outputs: ["package_scores", "scripts", "brief"], stages: ["strategy", "scripts", "brief"] },
  { when: (id) => id === "channel", outputs: ["scripts", "brief"], stages: ["scripts", "brief"] },
];
const DERIVED_KEYS: Record<string, string> = { market_range: "market_range" };

/** Sets a slot. A changed value invalidates what depends on it, so nothing stale is shown. Returns true if anything changed. */
export function setSlot(s: SessionState, id: string, value: unknown, source: Source, opts: { unit?: string; note?: string } = {}): boolean {
  const old = s.slots[id];
  if (old && !old.stale && JSON.stringify(old.value) === JSON.stringify(value) && old.source === source) return false;
  s.slots[id] = { value, source, setAt: s.turn, ...opts };
  if (old && !old.stale && old.value !== null && old.value !== undefined) markChanged(s, id);
  return true;
}
/** Marks the outputs and stages that depend on a changed slot for recomputation. */
export function markChanged(s: SessionState, id: string): void {
  for (const d of DEPENDENTS) if (d.when(id)) {
    for (const o of d.outputs) { delete s.outputs[o]; if (DERIVED_KEYS[o]) delete s.slots[DERIVED_KEYS[o]]; }
    for (const st of d.stages) if (!s.recompute.includes(st)) s.recompute.push(st);
  }
}
/** The user did not know: use a placeholder and label it, so the flow can continue (Flow-Overview: Gates). */
export const assume = (s: SessionState, id: string, value: unknown, note?: string) => setSlot(s, id, value, "assumed", { note });
/** A slot older than the session, or one the user says has changed, must be confirmed before use. */
export function markStale(s: SessionState, id: string): void { const v = s.slots[id]; if (v) { v.stale = true; markChanged(s, id); } }
