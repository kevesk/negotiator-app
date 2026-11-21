import { anthropicModel, anthropicResearcher } from "@/server/anthropic";
import { handleChat } from "@/server/chat";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY;
  let body: unknown; try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const model = key ? anthropicModel({ apiKey: key, model: process.env.ANTHROPIC_MODEL }) : null;
  const today = new Date().toISOString().slice(0, 10);
  // live market research is on unless MARKET_RESEARCH=off (it needs web search enabled for the organisation in the Anthropic Console)
  const researcher = key && process.env.MARKET_RESEARCH !== "off" ? anthropicResearcher({ apiKey: key, model: process.env.ANTHROPIC_MODEL, today }) : undefined;
  const r = await handleChat((body ?? {}) as Record<string, unknown>, model, today, researcher);
  return Response.json(r.body, { status: r.status });
}
