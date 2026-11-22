import { accessRequired, accessOk, codeLimiter, visitorKey, minutes } from "@/server/access";

export const runtime = "nodejs";

/** Whether this deployment asks for an access code. No model call, no cost. */
export async function GET(): Promise<Response> {
  return Response.json({ required: accessRequired() });
}
/** Checks a code before the chat starts. Wrong guesses are capped per visitor. */
export async function POST(req: Request): Promise<Response> {
  const lim = codeLimiter.hit(visitorKey(req.headers));
  if (!lim.ok) return Response.json({ error: "too_many_attempts", retryAfterMinutes: minutes(lim.retryAfterMs) }, { status: 429 });
  let body: { code?: unknown } = {}; try { body = await req.json(); } catch { /* empty body: treated as no code */ }
  return accessOk(typeof body.code === "string" ? body.code : null) ? Response.json({ ok: true }) : Response.json({ error: "wrong_code" }, { status: 401 });
}
