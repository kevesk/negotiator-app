// Script writer (Script-Writer-Spec): drafts the words the user will say or send. A prompt step with code checks:
// only approved figures, never the walk-away, no invention, one repair, never throws.
import { preSend, extractFigures, parseNumber } from "@/checks";
import type { ChatModel } from "@/orchestrator/model";
import { SCRIPT_BLOCK_TEMPLATE } from "./templates.generated";

export type ScriptPartId = "opening" | "ask" | "objection" | "trade" | "close" | "time";
export interface ScriptPart { id: ScriptPartId; text: string; numbers_used?: number[]; objection?: string }
export interface ScriptsOutput {
  language: "en" | "sv"; channel: string;
  parts: ScriptPart[]; email: { subject: string; body: string } | null;
  assumptions: string[]; provisional: boolean;
}
export interface ScriptInput {
  lang: "en" | "sv"; channel: string;
  /** What the user knows and has said, without the walk-away and without the target. */
  facts: string;
  /** Figures the script may contain (monthly gross SEK): the anchor, the concession positions, the employer's own offer. */
  approved: { anchor: number; positions: number[]; offer?: number };
  /** Never allowed in the script (the walk-away). */
  forbidden: number[];
  notes: string;
}
const IDS: ScriptPartId[] = ["opening", "ask", "objection", "trade", "close", "time"];
const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");
export const approvedFigures = (a: ScriptInput["approved"]): number[] => [...new Set([a.anchor, ...a.positions, ...(a.offer ? [a.offer] : [])])];

export const SCRIPT_RULES = `You are the script writer for a Swedish salary-negotiation preparation tool. Draft the words the user will say or send. You are not the coach and you do not give advice here.
Rules:
1. Use only the approved figures below, written as monthly gross SEK. Never write any other amount or percentage. Never write the walk-away or the user's target range.
2. No invention: every claim must come from the facts given. No made-up competing offers, deadlines, achievements or company details. If a fact is missing, write around it and list it under assumptions, and set provisional to true.
3. Tone: calm, factual, respectful, no theatre, no jokes, no emojis, no filler. Never mention a course, a teacher, slides, lectures or any author.
4. Spoken lines are short and speakable. Written text may be fuller.
5. Always include what to say after the other side answers, including "no" and "that is not negotiable".
6. Write in the requested language. Swedish must be natural workplace Swedish, not a literal translation.
7. The tool never sends anything; the user edits and sends it.
Output ONLY one JSON object, no prose:
{"parts":[{"id":"opening|ask|objection|trade|close|time","text":"...","objection":"(only for objection parts: what they say)","numbers_used":[numbers]}],"email":{"subject":"...","body":"..."} or null,"assumptions":["..."],"provisional":true|false}
Parts, in order: opening (first 30 seconds), ask (one figure or package with the reason), objection (two or three, each with the response), trade (the conditional wording for each concession step: "if ... then ..."), close (summarise and confirm the next step), time (a line for "I need to think about it").
If the channel is email, include the email object (subject and body); if the channel is unknown, write both spoken parts and an email.
The script block format for reference (the app formats it; you only return the JSON):
${SCRIPT_BLOCK_TEMPLATE}`;

export function scriptPrompt(i: ScriptInput): { system: string; user: string } {
  const figs = approvedFigures(i.approved);
  return {
    system: SCRIPT_RULES,
    user: [
      `Language: ${i.lang === "sv" ? "Swedish" : "English"}. Channel: ${i.channel || "unknown (write both)"}.`,
      `Approved figures (SEK a month, gross): ${figs.map(fmt).join(", ")}. The opening ask is ${fmt(i.approved.anchor)}.`,
      i.approved.positions.length ? `Concession positions after the ask, in order: ${i.approved.positions.map(fmt).join(", ")}. Only move to the next position in exchange for something.` : "",
      i.approved.offer ? `The employer's own current offer is ${fmt(i.approved.offer)}.` : "",
      "", "Facts you may use:", i.facts || "(none)",
      i.notes ? `\nBackground notes for the wording:\n${i.notes}` : "",
    ].filter((x) => x !== "").join("\n"),
  };
}

const parseJson = (t: string): any => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } };
const allText = (o: ScriptsOutput) => [...o.parts.map((p) => `${p.objection ?? ""}\n${p.text}`), o.email ? `${o.email.subject}\n${o.email.body}` : ""].join("\n\n");

/** Checks and cleans a script draft. Returns the problems, or the validated output. */
export function validateScripts(raw: unknown, i: ScriptInput): { ok: true; value: ScriptsOutput } | { ok: false; errors: string[] } {
  const errors: string[] = []; const r = raw as { parts?: unknown; email?: unknown; assumptions?: unknown; provisional?: unknown } | null;
  if (!r || !Array.isArray(r.parts)) return { ok: false, errors: ["the reply was not the expected JSON object"] };
  const parts: ScriptPart[] = [];
  for (const p of r.parts as any[]) {
    if (p && IDS.includes(p.id) && typeof p.text === "string" && p.text.trim()) parts.push({ id: p.id, text: p.text.trim(), objection: typeof p.objection === "string" ? p.objection.trim() : undefined, numbers_used: Array.isArray(p.numbers_used) ? p.numbers_used.filter((n: unknown) => typeof n === "number") : undefined });
  }
  for (const id of ["opening", "ask", "trade", "close", "time"] as const) if (!parts.some((p) => p.id === id)) errors.push(`missing part: ${id}`);
  if (parts.filter((p) => p.id === "objection").length < 2) errors.push("needs at least two objection responses, including one for \"no\" or \"not negotiable\"");
  const e = r.email as { subject?: unknown; body?: unknown } | null | undefined;
  const email = e && typeof e.subject === "string" && typeof e.body === "string" && e.body.trim() ? { subject: e.subject.trim(), body: e.body.trim() } : null;
  if (i.channel.toLowerCase().includes("email") && !email) errors.push("the channel is email but there is no email");
  const out: ScriptsOutput = { language: i.lang, channel: i.channel, parts, email, assumptions: Array.isArray(r.assumptions) ? r.assumptions.filter((a): a is string => typeof a === "string") : [], provisional: r.provisional === true };
  const text = allText(out);
  const approved = new Set(approvedFigures(i.approved));
  const bad = extractFigures(text).filter((f) => !approved.has(f.value));
  if (bad.length) errors.push(`figures that are not approved: ${[...new Set(bad.map((f) => f.raw.trim()))].slice(0, 5).join(", ")}; use only ${[...approved].map(fmt).join(", ")}`);
  const forbidden = new Set(i.forbidden);
  const leaked = [...text.matchAll(/\d[\d  .,]*\d|\d/g)].map((m) => parseNumber(m[0])).filter((v): v is number => v !== null && forbidden.has(v));
  if (leaked.length) errors.push("contains a figure that must never be shown to the employer");
  const pre = preSend(text, { stage: "scripts", sources: [...approved].map(String), numbersGateOpen: true });
  for (const f of pre.findings) if (f.severity === "error" && f.rule !== "H2") errors.push(`${f.rule}: ${f.detail}`);
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export async function runScripts(model: ChatModel, i: ScriptInput): Promise<{ ok: boolean; value?: ScriptsOutput; errors?: string[] }> {
  try {
    const { system, user } = scriptPrompt(i);
    let reply = await model.complete({ purpose: "script", system, messages: [{ role: "user", content: user }] });
    let v = validateScripts(parseJson(reply), i);
    if (!v.ok) {
      reply = await model.complete({ purpose: "script", system, messages: [{ role: "user", content: user }, { role: "assistant", content: reply }, { role: "user", content: `Fix these problems and return the full JSON again: ${v.errors.join("; ")}` }] });
      v = validateScripts(parseJson(reply), i);
    }
    return v.ok ? { ok: true, value: v.value } : { ok: false, errors: v.errors };
  } catch { return { ok: false, errors: ["the model did not answer"] }; }
}
