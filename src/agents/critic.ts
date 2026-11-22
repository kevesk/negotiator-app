// Critic (Critic-Reviewer-Spec): reviews the final brief in a separate context before the user sees it. It reports; it never rewrites.
import { preSend, extractFigures, allowedValues, parseNumber } from "@/checks";
import type { ChatModel } from "@/orchestrator/model";
import { BRIEF_CHECKLIST } from "./templates.generated";

export type CheckId = "placeholder" | "numbers" | "tags" | "market" | "sources" | "guesses" | "consistency" | "recommendation" | "leaks" | "honesty" | "completeness" | "length";
export interface CriticFinding { id: CheckId; severity: "must_fix" | "should_fix" | "note"; where: string; what: string; suggested_fix: string }
export interface CriticReport { verdict: "pass" | "fix"; findings: CriticFinding[]; checks_failed: CheckId[] }
export interface BriefContext {
  lang: "en" | "sv"; brief: string;
  /** Slots with their tags, without the chat history. */
  state: string; outputs: string;
  walkAway?: number; target?: number; batna?: number;
  /** Texts the brief's figures may come from (slots, tool outputs). */
  sources: string[];
}
export const MAX_WORDS = 1100;
const IDS: CheckId[] = ["placeholder", "numbers", "tags", "market", "sources", "guesses", "consistency", "recommendation", "leaks", "honesty", "completeness", "length"];

/** Plain-language labels for the user, one per check. Owned by code so no model text is shown as a finding. */
export const FINDING_LABEL: Record<"en" | "sv", Record<CheckId, string>> = {
  en: { placeholder: "a field in the brief was left empty", numbers: "a figure could not be matched to your data or the tools", tags: "a figure is missing its source tag", market: "the market data is incomplete or overstated", sources: "a source or date is missing", guesses: "a guess may be shown as a fact", consistency: "your numbers or scripts do not fully agree", recommendation: "a recommendation check was not met", leaks: "something private or off-limits appears in the text", honesty: "a line may say something you could not truthfully say", completeness: "a required part is missing", length: "the brief is longer than 800 words" },
  sv: { placeholder: "ett fält i underlaget lämnades tomt", numbers: "en siffra kunde inte kopplas till dina uppgifter eller verktygen", tags: "en siffra saknar källtagg", market: "marknadsdatan är ofullständig eller överdriven", sources: "en källa eller ett datum saknas", guesses: "en gissning kan visas som fakta", consistency: "dina siffror eller manus stämmer inte helt överens", recommendation: "en rekommendationskontroll är inte uppfylld", leaks: "något privat eller förbjudet finns i texten", honesty: "en rad kan säga något du inte sanningsenligt kan säga", completeness: "en obligatorisk del saknas", length: "underlaget är längre än 800 ord" },
};

/** Section numbers in the prep brief template (Output-Templates, template 5, D113): the numbers table, and the parts the employer hears. */
export const SECTION = { numbers: 2, toEmployer: [7, 8, 9] } as const;
/** Sections of the brief by their numbers ("## 5. ..."), language-independent. */
export function sectionOf(brief: string, n: number): string {
  const m = brief.match(new RegExp(`^##\\s*${n}\\.[^\\n]*\\n([\\s\\S]*?)(?=^##\\s*\\d+\\.|$(?![\\s\\S]))`, "m")); return m?.[1] ?? "";
}
const near = (v: number, w: number) => Math.abs(v - w) < 0.5;

/** The checks that code can make without a model (diffing figures, leaks, placeholders, length, required lines). */
export function codeChecks(c: BriefContext): CriticFinding[] {
  const out: CriticFinding[] = []; const add = (id: CheckId, severity: CriticFinding["severity"], where: string, what: string, fix: string) => out.push({ id, severity, where, what, suggested_fix: fix });
  if (/\{\{[^}]*\}\}/.test(c.brief)) add("placeholder", "must_fix", "brief", "a template placeholder is still in the text", "Fill every field or write \"unknown\" with the reason.");
  const allowed = allowedValues(c.sources, [c.target, c.walkAway, c.batna].filter((x): x is number => typeof x === "number"));
  const loose = (v: number) => allowed.has(v) || allowed.has(Math.round(v)) || allowed.has(Math.round(v * 10) / 10);
  const untraced = extractFigures(c.brief).filter((f) => !loose(f.value));
  if (untraced.length) add("numbers", "must_fix", "brief", `figures not found in the state or tool results: ${[...new Set(untraced.map((f) => f.raw.trim()))].slice(0, 5).join(", ")}`, "Use only figures from the state and tool results, unchanged.");
  // the walk-away may appear in the numbers table but never in the text meant for the employer
  const say = SECTION.toEmployer.map((n) => sectionOf(c.brief, n)).join("\n");
  if (c.walkAway !== undefined) {
    const hit = [...say.matchAll(/\d[\d  .,]*\d|\d/g)].map((m) => parseNumber(m[0])).some((v) => v !== null && near(v, c.walkAway!));
    if (hit) add("leaks", "must_fix", "sections 7 to 9", "the walk-away figure appears in text meant for the employer", "Remove the walk-away from the scripts and the concession table.");
  }
  const pre = preSend(c.brief, { stage: "brief", sources: [...c.sources, String(c.target ?? ""), String(c.walkAway ?? "")], numbersGateOpen: true });
  for (const f of pre.findings) if (f.severity === "error" && f.rule !== "H2") add(f.rule === "H20" || f.rule === "H21" ? "leaks" : "honesty", "must_fix", "brief", f.detail, "Remove or reword it.");
  if (c.target !== undefined && c.walkAway !== undefined && c.walkAway > c.target) add("consistency", "must_fix", "section 2", "the walk-away is above the target", "Show the conflict to the user and do not present it as settled.");
  if (c.walkAway !== undefined && c.batna !== undefined && c.walkAway < c.batna) add("consistency", "should_fix", "section 2", "the walk-away is below the best alternative", "Say so openly in the brief.");
  const rows = sectionOf(c.brief, SECTION.numbers).split("\n").filter((l) => /^\|/.test(l) && /\d{4}|\d\s?\d{3}/.test(l));
  const untagged = rows.filter((l) => !/\[(user|researcher|computed|assumed)\]/i.test(l));
  if (untagged.length) add("tags", "should_fix", "section 2", `${untagged.length} row(s) with a figure have no source tag`, "Add [user], [researcher], [computed] or [assumed] to every figure.");
  if (!/legal or financial advice|juridisk|finansiell rådgivning|rådgivning/i.test(c.brief)) add("completeness", "should_fix", "end", "the preparation-support line is missing", "End with the line that this is preparation support, not legal or financial advice.");
  if (!/- \[ \]|next step|nästa steg/i.test(c.brief)) add("completeness", "should_fix", "end", "no next step", "Add the checklist and a clear next step.");
  const words = c.brief.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) add("length", "should_fix", "brief", `${words} words`, "Cut to 700 to 1,100 words: only what the user needs, no fluff.");
  return out;
}

export const CRITIC_SYSTEM = `You are the Critic: you review a salary-negotiation prep brief before the user sees it. You work from the brief, the state and the tool results only. You never rewrite the brief; you report.
Check the brief against this list:
${BRIEF_CHECKLIST.map((x, i) => `${i + 1}. ${x}`).join("\n")}
Also check: consistency between target, anchor, walk-away, concession steps and the scripts; that no line in a script says something the user cannot truthfully say (no invented offers, deadlines or achievements); that market data shows range or average with confidence, sources and date, and that an average-only result is not shown as a range; that guesses carry the guess label and are not used in the numbers; that nothing private (the walk-away, the target range) appears in text meant for the employer; that nothing mentions an author, a course, its weeks, slides or cases.
You do not judge whether the user's target is wise. Anything that nothing in the state or tool results supports must be flagged, not assumed.
Output ONLY one JSON object: {"findings":[{"id":"${IDS.join("|")}","severity":"must_fix|should_fix|note","where":"section","what":"short","suggested_fix":"short"}]}. Return {"findings":[]} for a clean brief. Use must_fix only for a real error, never for style.`;

const parse = (t: string): { findings?: unknown } | null => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } };
/** Runs the code checks and the model review, in a separate context from the coach (no chat history). */
export async function reviewBrief(model: ChatModel, c: BriefContext): Promise<CriticReport> {
  const findings = codeChecks(c);
  try {
    const reply = await model.complete({ purpose: "critic", system: CRITIC_SYSTEM, cachePrefix: CRITIC_SYSTEM, messages: [{ role: "user", content: `Language of the brief: ${c.lang}\n\nSTATE (slots with tags):\n${c.state}\n\nTOOL RESULTS:\n${c.outputs}\n\nBRIEF:\n${c.brief}` }] });
    const j = parse(reply);
    if (Array.isArray(j?.findings)) for (const f of j!.findings as any[]) {
      if (f && IDS.includes(f.id) && ["must_fix", "should_fix", "note"].includes(f.severity) && !findings.some((x) => x.id === f.id && x.severity === f.severity && x.where === String(f.where ?? ""))) findings.push({ id: f.id, severity: f.severity, where: String(f.where ?? "").slice(0, 60), what: String(f.what ?? "").slice(0, 240), suggested_fix: String(f.suggested_fix ?? "").slice(0, 240) });
    }
  } catch { findings.push({ id: "completeness", severity: "note", where: "review", what: "the model review did not run; only the code checks were applied", suggested_fix: "" }); }
  const failed = [...new Set(findings.filter((f) => f.severity !== "note").map((f) => f.id))];
  return { verdict: findings.some((f) => f.severity === "must_fix") ? "fix" : "pass", findings, checks_failed: failed };
}
