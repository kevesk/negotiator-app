import { runTurn, newState, type SessionState, type ChatModel, type Lang, type TurnDeps } from "@/orchestrator";

export const LIMITS = { message: 4000, messages: 80, messageChars: 12000, stateBytes: 300_000 };
export interface ChatRequest { message?: unknown; state?: unknown; language?: unknown }
export interface ChatResponse { status: number; body: unknown }

const isLang = (x: unknown): x is Lang => x === "en" || x === "sv";
function validState(x: unknown): x is SessionState {
  const s = x as SessionState | null;
  return !!s && typeof s === "object" && isLang(s.language) && typeof s.turn === "number" && s.slots !== null && typeof s.slots === "object" &&
    Array.isArray(s.messages) && s.messages.length <= LIMITS.messages && s.messages.every((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= LIMITS.messageChars) &&
    Array.isArray(s.userTexts) && Array.isArray(s.modifiers) && s.outputs !== null && typeof s.outputs === "object" && Array.isArray(s.notesUsed) && Array.isArray(s.recompute) && Array.isArray(s.failures);
}
/** Validates the request and runs one turn. The server keeps nothing: the session state travels with the browser (D79). */
export async function handleChat(body: ChatRequest, model: ChatModel | null, today?: string, researcher?: TurnDeps["researcher"]): Promise<ChatResponse> {
  if (!model) return { status: 503, body: { error: "not_configured" } };
  if (typeof body.message !== "string" || !body.message.trim()) return { status: 400, body: { error: "empty_message" } };
  if (body.message.length > LIMITS.message) return { status: 413, body: { error: "message_too_long" } };
  let state: SessionState;
  if (body.state === undefined || body.state === null) { if (!isLang(body.language)) return { status: 400, body: { error: "language_required" } }; state = newState(body.language); }
  else { if (JSON.stringify(body.state).length > LIMITS.stateBytes || !validState(body.state)) return { status: 400, body: { error: "bad_state" } }; state = body.state; }
  try {
    const r = await runTurn({ model, researcher, allowDraft: process.env.RELEASE_MODE !== "1", today }, state, body.message);
    return { status: 200, body: { reply: r.reply, state: r.state, sidebar: r.sidebar, next: r.next, suggestions: r.suggestions, stage: r.plan.stage, usedFallback: r.usedFallback } };
  } catch {
    return { status: 502, body: { error: "model_error" } }; // no content in the error, nothing logged
  }
}
