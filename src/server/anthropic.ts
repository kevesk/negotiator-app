import Anthropic from "@anthropic-ai/sdk";
import type { ChatModel, ModelRequest, ChatMessage } from "@/orchestrator";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** The API needs the first message from the user and alternating roles. */
export function normaliseMessages(msgs: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    if (!m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content; else out.push({ ...m });
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}
/** The cheaper model for the small jobs: reading facts out of a message, and the eval harness's setup and grading (cost decision, 2026-11-22). */
export const FAST_MODEL = "claude-haiku-5-5";
const FAST_PURPOSES = new Set<ModelRequest["purpose"]>(["extract", "setup", "judge", "script"]);
const MAX_TOKENS: Record<ModelRequest["purpose"], number> = { extract: 1600, setup: 3000, judge: 1500, reply: 8000, rewrite: 8000, script: 6000, critic: 6000 };

/** Which model a call uses: everything the user reads on the main model, the small jobs on the fast one. */
export function modelFor(purpose: ModelRequest["purpose"], main: string, fast: string): string {
  return FAST_PURPOSES.has(purpose) ? fast : main;
}
/**
 * The system prompt as the API takes it. A `cachePrefix` that starts the prompt becomes its own block marked for caching,
 * so later calls with the same start are billed at the cached rate; the rest follows uncached.
 */
export function systemBlocks(req: Pick<ModelRequest, "system" | "cachePrefix">): string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const pre = req.cachePrefix;
  if (!pre || !req.system.startsWith(pre)) return req.system;
  const rest = req.system.slice(pre.length);
  return [{ type: "text", text: pre, cache_control: { type: "ephemeral" } }, ...(rest.trim() ? [{ type: "text" as const, text: rest }] : [])];
}
/**
 * The language model behind the coach: the Anthropic Claude API (D102). The main model writes everything the user reads;
 * a cheaper model does the small jobs (FAST_MODEL). Nothing the user types is logged here (D79).
 */
export function anthropicModel(opts: { apiKey: string; model?: string; fastModel?: string }): ChatModel {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 120_000 });
  const main = opts.model ?? DEFAULT_MODEL, fast = opts.fastModel ?? FAST_MODEL;
  return {
    async complete(req: ModelRequest): Promise<string> {
      // A reply cut off by the token limit is never sent as if it were whole (a live test produced a brief that stopped mid-sentence):
      // it is asked for once more with twice the room, and a second cut-off is an error the caller handles.
      const base = MAX_TOKENS[req.purpose] ?? 2500;
      for (const max_tokens of [base, base * 2]) {
        const res = await client.messages.create({ model: modelFor(req.purpose, main, fast), max_tokens, system: systemBlocks(req), messages: normaliseMessages(req.messages) });
        if (res.stop_reason !== "max_tokens") return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      }
      throw new Error("model output was cut off by the token limit");
    },
  };
}

import { runResearch, toMarketRange, researchInputFrom } from "@/agents/researcher";
import { scbMarketRange } from "@/agents/scb";
import { slotValue, type SessionState } from "@/orchestrator";
/** Live market research on the Claude API's web search and fetch tools, limited to the source catalogue (milestone 6). */
/**
 * Market research: SCB's official statistics first (D114): the cheap model picks the occupation group, the figures come from
 * SCB directly. Only when SCB has nothing does the web researcher run. Either way the search runs once per session.
 */
export function anthropicResearcher(opts: { apiKey: string; model?: string; fastModel?: string; today: string; fetch?: typeof fetch }) {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 40_000 });
  const picker = anthropicModel({ apiKey: opts.apiKey, model: opts.model, fastModel: opts.fastModel });
  return async (s: SessionState) => {
    const scb = await scbMarketRange({ role: String(slotValue(s, "role_title") ?? ""), duties: slotValue<string>(s, "role_description"), industry: slotValue<string>(s, "industry"), employerType: slotValue(s, "employer_type") },
      { model: picker, fetch: (opts.fetch ?? fetch) as never });
    if (scb) return scb;
    const input = researchInputFrom((id) => slotValue(s, id)); // never includes own target, walk-away or current pay
    const r = await runResearch(input, { client: client as never, model: opts.model ?? DEFAULT_MODEL, today: opts.today });
    if (!r.ok || !r.value) return { range: null, research: { failed: true, gaps_and_next_steps: ["No figures could be verified from the source catalogue. Ask the user for a job ad with a pay range, a union or Saco pay survey, or their own data."] } };
    return { range: toMarketRange(r.value), research: r.value };
  };
}
