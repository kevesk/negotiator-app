import { extractFigures, allowedValues } from "./numbers";
import { findCiteNeverLeaks } from "@/retrieval";
import type { Stage } from "@/retrieval";

export interface Finding { rule: string; severity: "error" | "flag"; detail: string }
export interface ReplyContext {
  stage: Stage;
  /** Texts the reply may draw figures from: the user's messages, retrieved notes, researcher output, engine output. */
  sources: string[];
  /** Extra allowed numbers (for example engine results passed as numbers). */
  allowedNumbers?: number[];
  /** True once the slots for target, anchor and walk-away exist or were explicitly assumed (rule 7). */
  numbersGateOpen: boolean;
}
export interface PreSendResult { ok: boolean; findings: Finding[] }

const GATE_WORDS = /(target|anchor|walk[- ]?away|reservation|landing|mållön|ankare|ankarsiffra|golv|lägsta acceptabla)[^.\n?]{0,50}?\d[\d  .,]{3,}/i;
const PROMISE = /\b(i guarantee|guaranteed|i promise|they (will|'ll) (definitely |certainly )?(accept|agree|say yes)|i know (their|the employer'?s|the company'?s) budget|their budget is|jag garanterar|jag lovar|de kommer (säkert |definitivt )?(att )?(acceptera|säga ja)|jag vet (deras|arbetsgivarens|företagets) budget|deras budget är)\b/i;
const ID_REQUEST = /\b(share|provide|send|enter|give me|what is your|what's your|ange|skicka|dela|ge mig|vad är ditt|vad är din)\b[^.\n?]{0,60}\b(personnummer|personal (identity|id) number|social security( number)?|bank account|kontonummer|bankkonto|iban|card number|kortnummer)\b/i;
const AUTHOR_COURSE = /\b(ntu|nanyang|(the|this|our|my) course|negotiation course|my (professor|lecturer|teacher|classmates?)|in class|class (exercise|case|results?)|slides?|lectures?|the author|who (built|wrote|created) (me|this)|my creator|kursen|kursmaterialet|föreläsningen|författaren|min (professor|lärare|kursare))\b/i;
const UNPROFESSIONAL = /\b(haha+|hehe+|lol|lmao|rofl|just kidding)\b|\p{Extended_Pictographic}/iu;
const ANECDOTE = /\b(i once|i remember (when|a)|in my experience|when i (was|worked|negotiated)|my own (experience|negotiation)|a friend of mine|jag minns|enligt min erfarenhet|när jag (var|jobbade|förhandlade)|en gång när jag|en vän till mig)\b/i;

/** Removes quoted script lines and code so example sentences are not mistaken for the coach's own questions or claims. */
const stripQuotes = (t: string) => t.replace(/```[\s\S]*?```/g, " ").replace(/"[^"\n]{3,}"|“[^”\n]{3,}”|»[^«\n]{3,}«/g, " ").replace(/^>.*$/gm, " ");

/**
 * Checks a drafted reply against the hard rules that code can test (rules 2, 5, 7, 10, 12, 13, 20, 21).
 * Errors trigger one rewrite and then the safe fallback message; flags are informational.
 */
export function preSend(reply: string, ctx: ReplyContext): PreSendResult {
  const findings: Finding[] = []; const add = (rule: string, severity: Finding["severity"], detail: string) => findings.push({ rule, severity, detail });
  const text = stripQuotes(reply);

  // H2: every figure must trace to the user, a retrieved note, the researcher or the engine
  const allowed = allowedValues(ctx.sources, ctx.allowedNumbers);
  const loose = (v: number) => allowed.has(v) || allowed.has(Math.round(v)) || allowed.has(Math.round(v * 10) / 10);
  const untraced = extractFigures(reply).filter((f) => !loose(f.value));
  if (untraced.length) add("H2", "error", `figures without a source: ${[...new Set(untraced.map((f) => f.raw.trim()))].slice(0, 5).join(", ")}`);

  // H5: at most two questions, except where the reply carries script text
  if (!["scripts", "brief", "practice"].includes(ctx.stage)) {
    const q = (text.match(/\?/g) ?? []).length; if (q > 2) add("H5", "error", `${q} questions in one reply`);
  }
  // H7: no target, anchor or walk-away figures before the gate is open
  if (!ctx.numbersGateOpen && GATE_WORDS.test(text)) add("H7", "error", "a target, anchor or walk-away figure before the required slots exist");
  // H10: ends with a next step
  const last = text.trim().split(/\n\s*\n/).pop() ?? "";
  if (!/\?|next step|nästa steg|you can|du kan|want me to|vill du att jag|try |prova |today|idag|let me know|säg till/i.test(last)) add("H10", "flag", "reply may not end with a next step");
  // H12: no promises, no claims about the other side's budget
  if (PROMISE.test(text)) add("H12", "error", "promises an outcome or claims to know the counterpart's budget");
  // H13: never ask for ID or bank details
  const idm = ID_REQUEST.exec(text);
  if (idm && !/\b(never|don'?t|do not|no need|not need|inte|aldrig|behöver inte|ingen anledning)\b[^.\n]{0,40}$/i.test(text.slice(Math.max(0, idm.index - 40), idm.index + idm[0].length - 0).split(idm[1]!)[0]!)) add("H13", "error", "asks for identity or bank details");
  // H20: nothing about the author, the course or its cases; never name a cite-never note
  if (AUTHOR_COURSE.test(text)) add("H20", "error", "mentions the author, the course or its material");
  const leaks = findCiteNeverLeaks(text); if (leaks.length) add("H20", "error", `names a reasoning-only note: ${leaks.slice(0, 3).join(", ")}`);
  // H21: strictly professional
  if (UNPROFESSIONAL.test(text)) add("H21", "error", "joke, emoji or filler");
  if (ANECDOTE.test(text)) add("H21", "error", "personal anecdote or claimed experience");

  return { ok: !findings.some((f) => f.severity === "error"), findings };
}

export const FALLBACK: Record<"en" | "sv", string> = {
  en: "I could not put together a reliable answer to that just now. Could you tell me a bit more about your situation, or rephrase the question? The next detail I need is what you want to focus on first.",
  sv: "Jag kunde inte formulera ett tillförlitligt svar på det just nu. Kan du berätta lite mer om din situation eller formulera om frågan? Nästa sak jag behöver veta är vad du vill börja med.",
};
