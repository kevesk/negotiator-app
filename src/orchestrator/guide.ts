// The red thread: what happens next, and three one-tap answers. Pure functions, no imports from the index or retrieval code.
import type { Stage } from "@/retrieval/types";
type Lang = "en" | "sv";

/** What the user should do next, per stage. Owned by code so it is always present and always right for the stage. */
const NEXT: Record<Lang, Record<string, string>> = {
  en: {
    route: "Tell me whether this is a new job offer or your current job.",
    intake: "Share a few basics about your role and situation.",
    position_A: "Walk me through the offer, or your situation in the process.",
    position_B: "Tell me about your results and the raise you want.",
    market: "Share your own target, walk-away and alternative, then I look up the market.",
    numbers: "Look at your numbers and decide your target.",
    strategy: "Choose how you want to negotiate.",
    scripts: "Go through what to say, word for word.",
    brief: "Download your summary and take your brief into the meeting.",
    debrief: "Tell me how the meeting went.",
  },
  sv: {
    route: "Berätta om det gäller ett nytt jobberbjudande eller ditt nuvarande jobb.",
    intake: "Berätta några grunder om din roll och situation.",
    position_A: "Gå igenom erbjudandet, eller var du står i processen.",
    position_B: "Berätta om dina resultat och den höjning du vill ha.",
    market: "Berätta om ditt eget mål, din gräns och ditt alternativ, så slår jag upp marknaden.",
    numbers: "Titta på dina siffror och bestäm ditt mål.",
    strategy: "Välj hur du vill förhandla.",
    scripts: "Gå igenom vad du ska säga, ord för ord.",
    brief: "Ladda ner din sammanfattning och ta med underlaget till mötet.",
    debrief: "Berätta hur mötet gick.",
  },
};
export const nextStepText = (stage: Stage, path: "A" | "B" | undefined, lang: Lang): string =>
  NEXT[lang][stage === "position" ? `position_${path ?? "A"}` : stage] ?? NEXT[lang].intake ?? "";

/** Safe fallbacks when the model's suggestions are missing or fail the checks. Never contain a figure. */
const DEFAULTS: Record<Lang, Record<string, string[]>> = {
  en: {
    route: ["I received a job offer", "It's about my current job", "I'm still in the interview process"],
    _: ["I'm not sure, what do you suggest?", "Why do you ask that?", "Let's move on to the next step"],
  },
  sv: {
    route: ["Jag har fått ett jobberbjudande", "Det gäller mitt nuvarande jobb", "Jag är fortfarande i intervjuprocessen"],
    _: ["Jag är osäker, vad föreslår du?", "Varför frågar du det?", "Vi går vidare till nästa steg"],
  },
};
export const defaultSuggestions = (stage: Stage, lang: Lang): string[] => [...(DEFAULTS[lang][stage] ?? DEFAULTS[lang]._ ?? [])];

export const OUTPUT_FORMAT = `Format: plain text with light markdown only: **bold** for a few key terms, "- " for bullet lists, no headings. Keep replies short.
Always end the reply with exactly one clear question or the next step, so the user never has to wonder what comes next.
After the reply, add a block with exactly three short answers the user could tap to reply, written in the user's voice and in the user's language, each under 60 characters and clearly different from each other. They contain no figures, names or facts the user has not given. When you ask for a figure, offer options like "I don't know yet, help me estimate" instead of inventing a number. Format:
<suggestions>
- first answer
- second answer
- third answer
</suggestions>`;

/** Style rules for what the coach says, found by the evals. They sit in code until the author moves them into the vault rules. */
export const COACH_STYLE = `When your advice rests on a negotiation concept or a Swedish rule, end that part with one short line: *Based on: <concept names>*, for example *Based on: anchoring, BATNA*. Use concept names only, never a course, a file or a note marked reasoning only.
If the user asks you to guarantee or promise a result: say plainly that you cannot promise one, say what good preparation does improve (a clear ask backed by evidence, knowing your limits, a plan for objections, confidence) and what it cannot control (the other side's budget and decision), then go on with the work.
For a question about Swedish law, tax rules or agreements: lead with where to verify (the union, the collective agreement, a lawyer, the authority), offer to look it up, and give general orientation only after that, labelled unverified. Never state a legal conclusion as fact from memory. End that part with an explicit offer, for example: "Want me to look up what the current sources say?".
When a note states the current status of a law or rule with a date, report exactly what the note says, with its date, and tell the user to verify. Add no detail from memory.
When the user asks what the other side's maximum or budget is: say it cannot be known from outside, and name concrete ways to learn more: ask the employer for the salary range of the role, look at job ads with pay ranges, and read the process signals (who is involved, how fast they move, how they react to a question about range).
When the offer includes options, shares or other equity: show it apart from guaranteed pay, never put a value on it, and ask for the terms that decide its worth in one single question: the vesting schedule, the strike price, and what happens on an exit or when you leave. Say you cannot tell whether a tax exception applies and that the user should verify it with Skatteverket or an adviser. Keep the walk-away on guaranteed pay only.
When the user says they hold an offer from another employer and want to use it: first ask what the offer is (employer, role, pay, terms, deadline) and whether they would really take it; say the offer must be real and used honestly, never as a bluff; wait for the answers before any counter strategy.
When the user asks for a number before the basics are known: say in two short lines why a number now would be a guess and how the process works, name no figure, ask for the role and for the number the user has in mind or would be happy with, and offer a provisional frame (a range built from market data plus the user's own limits).
When market data is thin, an average only, or low confidence: show what the source gives with its source and date, say plainly what is missing (for an average only: that no range exists), and say how to firm it up: job ads with pay ranges, union statistics, the user's own evidence. Ask which of these the user can bring.`;

/** Splits a model draft into the visible reply and the suggestion lines. */
export function splitTrailer(draft: string): { body: string; suggestions: string[] } {
  const i = draft.search(/<suggestions>/i);
  if (i < 0) return { body: draft.replace(/<\/?suggestions>/gi, "").trim(), suggestions: [] };
  const body = draft.slice(0, i).trim();
  const block = draft.slice(i).replace(/<\/?suggestions>/gi, "");
  const lines = block.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "").trim()).filter(Boolean);
  return { body, suggestions: lines };
}

/** Exactly three usable suggestions: the model's where they pass, code defaults filling the rest. `ok` is the pre-send check on them. */
export function finalSuggestions(modelOnes: string[], stage: Stage, lang: Lang, ok: (joined: string) => boolean, userText: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  const hasNewFigure = (t: string) => (t.match(/\d[\d  .,]*\d|\d/g) ?? []).some((n) => !userText.includes(n.trim()));
  const good = modelOnes.filter((t) => t.length >= 2 && t.length <= 90 && !hasNewFigure(t));
  const passes = good.length > 0 && ok(good.join("\n"));
  for (const t of [...(passes ? good : []), ...defaultSuggestions(stage, lang)]) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } if (out.length === 3) break; }
  return out;
}
