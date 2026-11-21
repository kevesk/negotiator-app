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
/**
 * The language model behind the coach: the Anthropic Claude API, one model for every step (D96, D102).
 * Nothing the user types is logged here (D79).
 */
export function anthropicModel(opts: { apiKey: string; model?: string }): ChatModel {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 });
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    async complete(req: ModelRequest): Promise<string> {
      const res = await client.messages.create({
        model, max_tokens: req.purpose === "extract" ? 700 : 1500,
        system: req.system, messages: normaliseMessages(req.messages),
      });
      return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    },
  };
}

import { runResearch, toMarketRange, researchInputFrom } from "@/agents/researcher";
import { slotValue, type SessionState } from "@/orchestrator";
/** Live market research on the Claude API's web search and fetch tools, limited to the source catalogue (milestone 6). */
export function anthropicResearcher(opts: { apiKey: string; model?: string; today: string }) {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 40_000 });
  return async (s: SessionState) => {
    const input = researchInputFrom((id) => slotValue(s, id)); // never includes own target, walk-away or current pay
    const r = await runResearch(input, { client: client as never, model: opts.model ?? DEFAULT_MODEL, today: opts.today });
    if (!r.ok || !r.value) return { range: null, research: { failed: true, gaps_and_next_steps: ["No figures could be verified from the source catalogue. Ask the user for a job ad with a pay range, a union or Saco pay survey, or their own data."] } };
    return { range: toMarketRange(r.value), research: r.value };
  };
}
