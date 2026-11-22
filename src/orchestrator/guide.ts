// The red thread: what happens next, and up to three one-tap answers. Pure functions, no imports from the index or retrieval code.
import type { Stage } from "@/retrieval/types";
type Lang = "en" | "sv";

/** What the user should do next, per stage. Owned by code so it is always present and always right for the stage. */
const NEXT: Record<Lang, Record<string, string>> = {
  en: {
    route: "Tell me whether this is a new job offer or your current job.",
    intake: "Share a few basics about your role and situation.",
    position_A: "Walk me through the offer, or your situation in the process.",
    position_B: "Tell me about your results and the raise you want.",
    interests: "Tell me what matters to you, and whether it's salary only or a whole package.",
    market: "Share your alternative, your target and your lowest acceptable pay; then I check the market once.",
    numbers: "Choose your first offer: above your target, with reasons.",
    strategy: "Plan your packages and your answers to tough questions.",
    scripts: "Go through what to say, word for word.",
    brief: "Save your summary as a PDF and take it into the meeting.",
    debrief: "Tell me how the meeting went.",
  },
  sv: {
    route: "Berätta om det gäller ett nytt jobberbjudande eller ditt nuvarande jobb.",
    intake: "Berätta några grunder om din roll och situation.",
    position_A: "Gå igenom erbjudandet, eller var du står i processen.",
    position_B: "Berätta om dina resultat och den höjning du vill ha.",
    interests: "Berätta vad som är viktigt för dig, och om det gäller bara lön eller ett helt paket.",
    market: "Berätta ditt alternativ, ditt mål och din lägsta godtagbara lön; sedan kollar jag marknaden en gång.",
    numbers: "Välj ditt första bud: över ditt mål, med skäl.",
    strategy: "Planera dina paket och dina svar på svåra frågor.",
    scripts: "Gå igenom vad du ska säga, ord för ord.",
    brief: "Spara din sammanfattning som PDF och ta med den till mötet.",
    debrief: "Berätta hur mötet gick.",
  },
};
export const nextStepText = (stage: Stage, path: "A" | "B" | undefined, lang: Lang): string =>
  NEXT[lang][stage === "position" ? `position_${path ?? "A"}` : stage] ?? NEXT[lang].intake ?? "";

/** Safe fallbacks when the model's suggestions are missing or fail the checks. Never contain a figure. */
const DEFAULTS: Record<Lang, Record<string, string[]>> = {
  en: {
    route: ["I received a job offer", "It's about my current job", "I'm still in the interview process"],
  },
  sv: {
    route: ["Jag har fått ett jobberbjudande", "Det gäller mitt nuvarande jobb", "Jag är fortfarande i intervjuprocessen"],
  },
};
/** Only the opening has fixed answers; elsewhere a suggestion must come from the question itself, or there is none (D112). */
export const defaultSuggestions = (stage: Stage, lang: Lang): string[] => [...(DEFAULTS[lang][stage] ?? [])];
/** Answers that only announce an answer ("I'll write it now") or ask for another search are not answers (D112). */
const NOT_AN_ANSWER = /\b(i'?ll|i will|let me|i'?m going to|i can (write|share|show|tell|send)|jag (ska|kommer att|skriver|visar|berättar|delar)|låt mig)\b|\b(search|look) (again|once more)|sök (igen|en gång till)|\bnew search\b|ny sökning/i;

export const OUTPUT_FORMAT = `Format: light markdown. Start with the answer in one or two sentences. Use **bold** for the key figure or decision, short "- " lists for options or steps, and a short "### " heading only when a reply has two or more distinct parts. Keep paragraphs to two or three sentences. Keep replies short.
Always end the reply with exactly one clear question or the next step, so the user never has to wonder what comes next.
After the reply, you may add up to three tap-to-send answers to your question, in the user's voice and language, each under 60 characters. Only add them when your question has a few likely short answers that truly answer it: yes or no, a choice between options you named, "salary only" or "a package", which of the items you listed matter. For open questions (role, title, salary, results, what happened), add none: the user types. Never add an answer that only announces an answer ("I'll write it now", "I'll show my results"), never one that asks you to search again, and never figures, names or facts the user has not given. When you offer practice, one answer is "Skip practice". Format, or leave the block out:
<suggestions>
- first answer
- second answer
</suggestions>`;

/** Style rules for what the coach says, found by the evals. They sit in code until the author moves them into the vault rules. */
/** Coach style rules: generated from the vault (Coach-Persona-and-Rules, "Coach style rules"). Edit them there, then run build-prompt. */
export { COACH_STYLE } from "@/agents/hard-rules.generated";

/** Splits a model draft into the visible reply and the suggestion lines. */
export function splitTrailer(draft: string): { body: string; suggestions: string[] } {
  const i = draft.search(/<suggestions>/i);
  if (i < 0) return { body: draft.replace(/<\/?suggestions>/gi, "").trim(), suggestions: [] };
  const body = draft.slice(0, i).trim();
  const block = draft.slice(i).replace(/<\/?suggestions>/gi, "");
  const lines = block.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\*\*/g, "").replace(/^["“]|["”]$/g, "").trim()).filter(Boolean);
  return { body, suggestions: lines };
}

/** Up to three tap-to-send answers: the model's where they are real answers and pass the checks; fixed ones only at the opening (D112). `ok` is the pre-send check. */
export function finalSuggestions(modelOnes: string[], stage: Stage, lang: Lang, ok: (joined: string) => boolean, userText: string): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  const hasNewFigure = (t: string) => (t.match(/\d[\d  .,]*\d|\d/g) ?? []).some((n) => !userText.includes(n.trim()));
  const good = modelOnes.filter((t) => t.length >= 2 && t.length <= 90 && !hasNewFigure(t) && !NOT_AN_ANSWER.test(t));
  const passes = good.length > 0 && ok(good.join("\n"));
  for (const t of [...(passes ? good : []), ...defaultSuggestions(stage, lang)]) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } if (out.length === 3) break; }
  return out;
}
