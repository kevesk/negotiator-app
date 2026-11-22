import { HARD_RULES, PERSONA } from "./hard-rules.generated";
import type { Stage } from "@/retrieval";

export type Lang = "en" | "sv";
export interface PromptState { lang: Lang; path?: "A" | "B"; stage: Stage; modifiers?: string[] }

const LANGUAGE: Record<Lang, string> = {
  en: "Answer in English. Give a Swedish term with a short English gloss the first time it matters.",
  sv: "Svara på svenska. Ge en engelsk term med en kort svensk förklaring första gången den behövs.",
};
const TAGS = "Tag every figure with [user], [researcher], [computed] or [assumed]. Figures come only from the user's messages, the notes you are given, the researcher or the numbers engine; if you need a calculation, ask the numbers engine, never calculate yourself.";
const NOTES = "Notes you are given may be marked UNVERIFIED, POSSIBLY OUTDATED or LOW CONFIDENCE: say so when you use them. Notes marked REASONING ONLY shape your thinking but are never named, quoted or retold.";

/** The system prompt sent on every turn: persona, the hard rules, language, and the current state. Rules are never left to retrieval (D66). */
/** The part of the coach prompt that only changes with the language: rules, persona, tags, notes guidance (cached by the API client). */
export function stableSystemPrompt(lang: PromptState["lang"]): string {
  return [HARD_RULES, "", "Persona:", PERSONA, "", TAGS, NOTES, LANGUAGE[lang]].join("\n");
}
export function stateLine(s: PromptState): string {
  return `Current state: path ${s.path ?? "not yet set"}, stage ${s.stage}${s.modifiers?.length ? `, modifiers ${s.modifiers.join(", ")}` : ""}.`;
}
export function buildSystemPrompt(s: PromptState): string {
  return [stableSystemPrompt(s.lang), "", stateLine(s)].join("\n");
}
