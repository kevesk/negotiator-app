import { RESEARCHER_RULES, OUTPUT_SCHEMA, RESEARCH_METHOD } from "./researcher-prompt.generated";

/** Sources the researcher may search and fetch, from the source catalogue (05-Researcher/Source-Catalog). Review this list. */
export const ALLOWED_DOMAINS = [
  "scb.se", "mi.se", "skr.se", "kolada.se",                                   // tier 1: official statistics
  "saco.se", "sverigesingenjorer.se", "unionen.se", "sulf.se", "naturvetarna.se", "akavia.se", "tco.se", "lo.se", // tier 2: unions and Saco
  "arbetsformedlingen.se", "se.indeed.com",                                     // tier 3: job ads with pay ranges
  "nigelwright.com",                                                            // tier 4: recruiter guides
  "svensktnaringsliv.se",
];
export const host = (url: string): string | null => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
export const domainAllowed = (url: string): boolean => { const h = host(url); return !!h && ALLOWED_DOMAINS.some((d) => h === d || h.endsWith("." + d)); };
const normUrl = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "").toLowerCase(); } catch { return u.toLowerCase(); } };

export interface ResearchInput {
  role_title: string; role_description?: string; experience_years: number | string; industry: string; employer_type: string; location: string; work_mode: string;
  skills_edge?: string; collective_agreement?: unknown; employer_pay_info?: unknown;
}
export interface ResearchSource { name: string; tier: number | string; measure: "average" | "median" | "quartile" | "advertised range"; value: number | string; year_or_date: string; retrieved_on: string; url_or_reference: string }
export interface ResearchOutput {
  request: Record<string, unknown>; unit: string;
  range: { p25: number | null; median: number | null; p75: number | null; average: number | null; range_note?: string };
  confidence: { level: "low" | "medium" | "high"; reasons: string[] };
  sources: ResearchSource[] | "none found";
  adjustments_applied?: unknown[]; caveats?: string[]; valid_as_of: string; user_data?: unknown[]; gaps_and_next_steps?: string[]; total_comp_facts?: unknown[];
}
export interface MessagesClient { messages: { create(params: any, opts?: any): Promise<any> } }
export interface ResearcherDeps { client: MessagesClient; model: string; today: string; maxSearches?: number; maxFetches?: number; timeoutMs?: number }

const MAX_TURNS = 6;
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const numbersIn = (v: unknown): number[] => typeof v === "number" ? [v] : typeof v === "string"
  ? [...v.matchAll(/\d{1,3}(?:[\u00a0\u202f ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(/[\u00a0\u202f ]/g, "").replace(",", "."))).filter(Number.isFinite) : [];
/** A range figure must come from a source: the same figure, or the source's yearly or hourly figure converted to monthly (the researcher reports the original value). */
export function matchesSource(fig: number, sources: ResearchSource[]): boolean {
  const factors = [1, 1 / 12, 1 / 13, 1 / 14, 1 / 12.2, (40 * 52) / 12];
  return sources.some((s) => numbersIn(s.value).filter((v) => v >= 100).some((v) => factors.some((f) => Math.abs(v * f - fig) <= 1)));
}

/**
 * Checks a researcher result before the coach may use it (Market-Researcher-Spec: Behaviour that the code enforces).
 * Returns a cleaned result, or the list of problems.
 */
export function validateResearch(raw: unknown, retrievedUrls: Set<string>, today: string): { ok: true; value: ResearchOutput } | { ok: false; errors: string[] } {
  const errors: string[] = []; const r = raw as ResearchOutput | null;
  if (!r || typeof r !== "object") return { ok: false, errors: ["not an object"] };
  if (typeof r.unit !== "string") errors.push("unit missing");
  if (!r.range || typeof r.range !== "object") errors.push("range block missing");
  if (!r.confidence || !["low", "medium", "high"].includes(r.confidence.level) || !Array.isArray(r.confidence.reasons) || !r.confidence.reasons.length) errors.push("confidence needs a level and at least one reason");
  const none = r.sources === "none found" || (Array.isArray(r.sources) && r.sources.length === 0);
  if (!none && !Array.isArray(r.sources)) errors.push("sources must be a list or 'none found'");
  if (errors.length) return { ok: false, errors };

  const srcs = Array.isArray(r.sources) ? r.sources : [];
  for (const s of srcs) {
    if (typeof s?.url_or_reference !== "string" || !/^https?:\/\//.test(s.url_or_reference)) errors.push(`source "${s?.name}" has no web address`);
    else if (!domainAllowed(s.url_or_reference)) errors.push(`source "${s.name}" is outside the source catalogue`);
    else if (!retrievedUrls.has(normUrl(s.url_or_reference))) errors.push(`source "${s.name}" was not retrieved in this search`);
  }
  const figs = (["p25", "median", "p75", "average"] as const).map((k) => [k, num(r.range?.[k])] as const).filter(([, v]) => v !== null) as [string, number][];
  if (none && figs.length) errors.push("figures given but no sources");
  for (const [k, v] of figs) if (!matchesSource(v, srcs)) errors.push(`${k} ${v} does not match any source value`);
  const hasRange = srcs.some((s) => s.measure === "quartile" || s.measure === "advertised range");
  if ((num(r.range?.p25) !== null || num(r.range?.p75) !== null) && !hasRange) errors.push("P25 or P75 given but no source gives a range (D68)");
  if (errors.length) return { ok: false, errors };

  const out: ResearchOutput = JSON.parse(JSON.stringify(r));
  out.valid_as_of = today;                                                    // set by code, not by the model
  if (Array.isArray(out.sources)) for (const s of out.sources) s.retrieved_on = today;
  const onlyAverage = figs.length > 0 && figs.every(([k]) => k === "average");
  if (onlyAverage || (!hasRange && figs.length)) { out.confidence.level = "low"; out.range.range_note ??= "range unavailable; source gives average only"; }
  if (none) { out.confidence.level = "low"; out.sources = "none found"; }
  return { ok: true, value: out };
}

const userPrompt = (i: ResearchInput, today: string) =>
  `Today is ${today}. Research the Swedish market range for this role and return ONE JSON object that follows the output schema, inside a \`\`\`json block, and nothing after it. Every figure must come from a page you searched or fetched in this task, and every source must carry its web address.\n\nRole: ${JSON.stringify(i)}`;
export const researcherSystem = () => `${RESEARCHER_RULES}\n\nOutput schema:\n${OUTPUT_SCHEMA}\n\nMethod notes (follow them):\n${RESEARCH_METHOD}\n\nUse only the web_search and web_fetch tools, limited to the allowed domains. Do not use remembered figures. Output the JSON object only.`;

function parseJson(text: string): unknown | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try { return JSON.parse(fenced); } catch { return null; }
}
function collectUrls(content: any[], into: Set<string>) {
  for (const b of content ?? []) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) into.add(normUrl(r.url));
    if (b.type === "web_fetch_tool_result" && b.content?.url) into.add(normUrl(b.content.url));
  }
}
/** One research run: a bounded tool loop, then validation, one repair attempt, then a null result. Never throws. */
export async function runResearch(input: ResearchInput, deps: ResearcherDeps): Promise<{ ok: boolean; value?: ResearchOutput; errors?: string[] }> {
  const urls = new Set<string>(); const system = researcherSystem();
  const tools = [
    { type: "web_search_20260318", name: "web_search", max_uses: deps.maxSearches ?? 6, allowed_domains: ALLOWED_DOMAINS },
    { type: "web_fetch_20260318", name: "web_fetch", max_uses: deps.maxFetches ?? 4, allowed_domains: ALLOWED_DOMAINS },
  ];
  const messages: any[] = [{ role: "user", content: userPrompt(input, deps.today) }];
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 40_000);
  let lastErrors: string[] = ["no result"];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let text = "";
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await deps.client.messages.create({ model: deps.model, max_tokens: 4000, system, tools, messages }, { signal });
        collectUrls(res.content, urls);
        messages.push({ role: "assistant", content: res.content });
        text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (res.stop_reason === "pause_turn") continue; // the server tool loop was paused: continue it
        break;
      }
      const parsed = parseJson(text);
      const v: ReturnType<typeof validateResearch> = parsed ? validateResearch(parsed, urls, deps.today) : { ok: false, errors: ["the reply was not valid JSON"] };
      if (v.ok) return { ok: true, value: v.value };
      lastErrors = v.errors;
      messages.push({ role: "user", content: `The result was rejected: ${v.errors.join("; ")}. Fix only these problems using pages you actually retrieved, and return the full JSON object again. If a figure cannot be backed by a retrieved source, set it to null.` });
    }
  } catch { lastErrors = ["the research call failed or timed out"]; }
  return { ok: false, errors: lastErrors };
}
/** The market_range slot value for the orchestrator, from a validated result. Null when no figure was found. */
export function toMarketRange(r: ResearchOutput) {
  const { p25, median, p75, average } = r.range;
  const names = Array.isArray(r.sources) ? r.sources.map((s) => s.name) : [];
  if (p25 === null && median === null && p75 === null && average === null) return null;
  const averageOnly = p25 === null && p75 === null && median === null;
  return { p25: p25 ?? undefined, median: median ?? average ?? undefined, p75: p75 ?? undefined, averageOnly, confidence: r.confidence.level, sources: names, valid_as_of: r.valid_as_of };
}
/** Builds the researcher's input from the session. Own target, walk-away and current pay are never passed (Market-Researcher-Spec). */
export function researchInputFrom(slot: (id: string) => unknown): ResearchInput {
  return { role_title: String(slot("role_title") ?? ""), role_description: slot("role_description") as string | undefined, experience_years: slot("experience_years") as number, industry: String(slot("industry") ?? ""), employer_type: String(slot("employer_type") ?? ""), location: String(slot("location") ?? ""), work_mode: String(slot("work_mode") ?? ""), skills_edge: slot("skills_edge") as string | undefined, collective_agreement: slot("collective_agreement"), employer_pay_info: slot("employer_pay_info") };
}
