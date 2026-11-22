import { INDEX, passesFilter } from "./search";
import type { NoteMeta, RetrievalState, VaultIndex } from "./types";

/**
 * Situation notes: the vault notes that tell the coach what to do when the user raises a specific situation
 * (a deadline, two offers, "no budget", a promotion, a points comparison, a Swedish rule). Keyword search often misses them
 * because users describe the situation in their own words, so the extraction step picks one or two by name and the coach
 * receives their guidance in full. See Retrieval-Design, "Situation notes".
 */
const SITUATION_FOLDER = /^(02-Flows|03-Tactics-and-Counters|04-Sweden-Context)(\/|$)/;
const NOT_A_SITUATION = /(-Index|-Overview)$|^(Routing-Question|A-Intake|B-Intake)$/;
/** Sections that are not guidance: links, provenance and worked examples stay out of the guide text. */
const SKIP_HEADING = /^(related|sources|example|illustrative|exempel|källor)/i;
export const MAX_SITUATIONS = 2;
const GUIDE_CHARS = 3000;

export function situationNotes(ix: VaultIndex = INDEX): NoteMeta[] {
  return ix.notes.filter((n) => SITUATION_FOLDER.test(n.folder) && n.audience.includes("coach") && !NOT_A_SITUATION.test(n.name));
}
const NAMES = new Set(situationNotes().map((n) => n.name));
export const isSituation = (name: string): boolean => NAMES.has(name);

/** One line per note for the extraction prompt: the name and a few of its aliases. */
export function situationCatalogue(ix: VaultIndex = INDEX): string {
  return situationNotes(ix).map((n) => `${n.name}: ${n.aliases.slice(0, 4).join("; ")}`).join("\n");
}

export interface SituationGuide { note: string; title: string; text: string }
/**
 * The guidance sections of a situation note, in order, capped. The note must pass the usual filter for audience, path,
 * language and status; its modifier and stage gates are waived, as for an alias named in the message.
 */
export function situationGuide(name: string, s: RetrievalState, ix: VaultIndex = INDEX): SituationGuide | null {
  const n = ix.notes.find((x) => x.name === name);
  if (!n || !isSituation(name)) return null;
  if (!passesFilter(n, { ...s, modifiers: n.modifiers, stage: n.stages.includes(s.stage) ? s.stage : (n.stages[0] ?? s.stage) })) return null;
  let text = "";
  for (const c of ix.chunks.filter((c) => c.note === name && !SKIP_HEADING.test(c.heading))) {
    const part = `${c.heading}: ${c.text}`.trim();
    if (text.length + part.length > GUIDE_CHARS) { if (!text) text = part.slice(0, GUIDE_CHARS); break; }
    text += (text ? "\n" : "") + part;
  }
  return text ? { note: n.name, title: n.title, text } : null;
}
