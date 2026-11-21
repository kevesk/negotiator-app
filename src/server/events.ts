// Anonymous counters (D88, D79): only the event name and a rating. No message content, no session id, no IP, nothing linking to a person.
export type AppEvent =
  | { event: "brief_produced" }
  | { event: "rating"; value: "useful" | "somewhat" | "not_useful" }
  | { event: "error"; type: string };
export interface CounterStore { record(e: AppEvent): void }
const ERROR_TYPES = new Set(["model_error", "not_configured", "bad_state", "message_too_long", "bad_json", "empty_message", "language_required"]);
const RATINGS = new Set(["useful", "somewhat", "not_useful"]);

/** Validates an incoming event; anything unknown is dropped. */
export function parseEvent(x: unknown): AppEvent | null {
  const o = x as Record<string, unknown> | null; if (!o || typeof o !== "object") return null;
  if (o.event === "brief_produced") return { event: "brief_produced" };
  if (o.event === "rating" && typeof o.value === "string" && RATINGS.has(o.value)) return { event: "rating", value: o.value as "useful" | "somewhat" | "not_useful" };
  if (o.event === "error" && typeof o.type === "string" && ERROR_TYPES.has(o.type)) return { event: "error", type: o.type };
  return null;
}
/** Default store: one JSON line per event in the host's log, counted from there. A database can replace it later without touching callers. */
export const logStore: CounterStore = { record(e) { console.log(JSON.stringify({ negotiator_counter: e })); } };
export function recordEvent(e: AppEvent | null, store: CounterStore = logStore): void { if (e) { try { store.record(e); } catch { /* counters never break the app */ } } }
