import { INDEX } from "./search";
import type { VaultIndex } from "./types";
import { words } from "./text";

/** Titles of notes the coach may use for reasoning only (cite: never). */
export function neverCiteTitles(ix: VaultIndex = INDEX): { name: string; title: string }[] {
  return ix.notes.filter((n) => n.cite === "never").map((n) => ({ name: n.name, title: n.title }));
}
/**
 * Pre-send check (rule 20): does a reply name a cite-never note by its title?
 * Whole-phrase match on normalised words, so "Week 3" does not match "Weekend".
 */
export function findCiteNeverLeaks(reply: string, ix: VaultIndex = INDEX): string[] {
  const rw = ` ${words(reply).join(" ")} `;
  return neverCiteTitles(ix).filter(({ title }) => { const t = words(title).join(" "); return t.length >= 4 && rw.includes(` ${t} `); }).map((x) => x.name);
}
/** Renders retrieved items for the prompt. Cite-never text is wrapped and marked as reasoning only. */
export function renderForPrompt(items: { title: string; heading: string; text: string; cite: "ok" | "never"; flags: { verify_before_use: boolean; outdated: boolean; valid_as_of: string | null; confidence: string | null } }[]): string {
  return items.map((i) => {
    const tags = [i.flags.verify_before_use ? "UNVERIFIED: check live before relying on it" : "", i.flags.outdated ? `POSSIBLY OUTDATED (valid as of ${i.flags.valid_as_of})` : "", i.flags.confidence === "low" ? "LOW CONFIDENCE" : ""].filter(Boolean);
    const head = `### ${i.title}${i.heading ? " > " + i.heading : ""}${tags.length ? `  [${tags.join("; ")}]` : ""}`;
    return i.cite === "never" ? `${head}\n[REASONING ONLY: never name, quote or retell this to the user]\n${i.text}` : `${head}\n${i.text}`;
  }).join("\n\n");
}
