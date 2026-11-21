import { parseEvent, recordEvent } from "@/server/events";
export const runtime = "nodejs";
/** Anonymous counters only: a rating for the brief. The event is validated and holds no content. */
export async function POST(req: Request): Promise<Response> {
  let body: unknown; try { body = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  const e = parseEvent(body); if (!e || e.event !== "rating") return Response.json({ ok: false }, { status: 400 });
  recordEvent(e); return Response.json({ ok: true });
}
