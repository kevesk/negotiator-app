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
