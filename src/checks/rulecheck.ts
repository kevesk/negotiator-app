import { INDEX } from "@/retrieval";
import type { VaultIndex } from "@/retrieval";

const norm = (s: string) => s.replace(/\*\*/g, "").replace(/\W+/g, " ").toLowerCase().trim();
export interface RuleCheck { catalogue: number; inNotes: number; mismatches: string[] }

/**
 * Consistency of the decision-rule catalogue (Decision-Rules) with the full rule text in each concept note.
 * Ported from the vault's rulecheck: each RULE-nnn appears once in the catalogue and once in its concept note,
 * with the same title and text.
 */
export function checkRules(ix: VaultIndex = INDEX): RuleCheck {
  const cat = ix.chunks.filter((c) => c.note === "Decision-Rules").map((c) => c.text).join("\n");
  const catalogue = new Map<string, { title: string; text: string; concept: string }>();
  for (const m of cat.matchAll(/\| (RULE-\d+) \| \*\*(.+?)\*\* (.+?) \| (.+?) \|/g)) catalogue.set(m[1]!, { title: m[2]!.replace(/\.$/, ""), text: m[3]!.trim(), concept: m[4]!.trim() });
  const inNotes = new Map<string, { note: string; title: string; text: string }[]>();
  for (const c of ix.chunks) {
    const h = c.heading.split(" > ").pop()?.match(/^(RULE-\d+): (.+)$/); if (!h) continue;
    const text = c.text.split("\n").find((l) => l.trim())?.trim() ?? "";
    (inNotes.get(h[1]!) ?? inNotes.set(h[1]!, []).get(h[1]!)!).push({ note: c.note, title: h[2]!.replace(/\.$/, ""), text });
  }
  const mismatches: string[] = [];
  for (const [id, r] of [...catalogue].sort()) {
    const ns = inNotes.get(id) ?? [];
    if (ns.length !== 1) { mismatches.push(`${id}: found in ${ns.length} notes`); continue; }
    const n = ns[0]!;
    if (n.note !== r.concept.replace(/\[\[|\]\]/g, "")) mismatches.push(`${id}: concept note differs (${n.note})`);
    if (norm(n.title) !== norm(r.title)) mismatches.push(`${id}: title differs`);
    if (norm(n.text) !== norm(r.text)) mismatches.push(`${id}: text differs`);
  }
  for (const id of inNotes.keys()) if (!catalogue.has(id)) mismatches.push(`${id}: in a note but not in the catalogue`);
  return { catalogue: catalogue.size, inNotes: inNotes.size, mismatches };
}
