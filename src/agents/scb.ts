// Market range from SCB's official wage structure statistics (D114): table TAB5932, "Genomsnittlig månadslön och
// lönespridning efter sektor, yrke (SSYK 2012) och kön", with the average, median and percentiles for about 430
// occupation groups. The model only picks the occupation group; the figures come straight from SCB, so they are exact.
// Only an occupation code and a sector are sent to SCB, never anything the user wrote.
import type { MarketRange } from "@/orchestrator/tools";
import type { ChatModel } from "@/orchestrator/model";

export const SCB_TABLE = "TAB5932";
/** PxWebApi 2 (data) and 1 (the list of occupation groups). If SCB moves them, the lookup fails and the web researcher runs instead. */
export const SCB_DATA_URL = `https://api.scb.se/OV0104/v2beta/api/v2/tables/${SCB_TABLE}/data`;
export const SCB_META_URL = "https://api.scb.se/OV0104/v1/doris/sv/ssd/START/AM/AM0110/AM0110A/LoneSpridSektYrk4AN";
/** Average, median, 10th, 25th, 75th and 90th percentile, in this order. */
const MEASURES = ["000007CD", "000007CE", "000007CF", "000007CG", "000007CH", "000007CI"] as const;
export type Sector = "0" | "1-3" | "4-5";
export interface ScbGroup { code: string; name: string }
export interface ScbRange { code: string; name: string; year: string; sector: Sector; average?: number; median?: number; p10?: number; p25?: number; p75?: number; p90?: number }
type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string>; json(): Promise<unknown> }>;

/** The sector to ask for: public, private, or all when unknown. */
export function sectorFor(employerType: unknown): Sector {
  const t = String(employerType ?? "").toLowerCase();
  if (/public|offentlig|kommun|region|stat|myndighet|government|municipal/.test(t)) return "1-3";
  if (/private|privat|company|företag|bolag|bank|startup|ab\b/.test(t)) return "4-5";
  return "0";
}
export function dataUrl(code: string, sector: Sector): string {
  const q = [`lang=sv`, `valueCodes[Yrke2012]=${code}`, `valueCodes[Tid]=top(1)`, `valueCodes[Sektor]=${encodeURIComponent(sector)}`, `valueCodes[Kon]=${encodeURIComponent("1+2")}`, `valueCodes[ContentsCode]=${MEASURES.join(",")}`, `outputFormat=csv`];
  return `${SCB_DATA_URL}?${q.join("&")}`;
}
const num = (x: string | undefined): number | undefined => { const v = Number(String(x ?? "").replace(/[\s"]/g, "")); return Number.isFinite(v) && v > 0 ? v : undefined; };
/** Reads SCB's CSV: the row for both sexes, then the six measures in the order asked. Missing cells ("..") stay undefined. */
export function parseScbCsv(csv: string, group: ScbGroup, sector: Sector): ScbRange | null {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const year = lines[0]!.match(/\b(20\d{2})\b/)?.[1] ?? "";
  const row = lines.slice(1).map((l) => l.split(/[,;]/)).find((c) => c[2]?.replace(/"/g, "").trim() === "1+2");
  if (!row) return null;
  const [average, median, p10, p25, p75, p90] = row.slice(3, 9).map(num);
  if (median === undefined && average === undefined) return null;
  return { code: group.code, name: group.name, year, sector, average, median, p10, p25, p75, p90 };
}
/** SCB's figures as the market range the rest of the app uses, with plain-language provenance. */
export function toRange(r: ScbRange): MarketRange {
  const range = r.p25 !== undefined && r.p75 !== undefined;
  return {
    p25: r.p25, median: r.median ?? r.average, p75: r.p75, averageOnly: !range,
    confidence: range ? "medium" : "low",
    sources: [`SCB, lönestrukturstatistik ${r.year}, yrkesgrupp ${r.code} ${r.name}`],
    valid_as_of: r.year ? `${r.year}-12-31` : undefined,
  };
}

/** The list of occupation groups, read once per server instance from SCB's table description. */
let groupsCache: ScbGroup[] | null = null;
export async function scbGroups(fetchFn: Fetch, signal?: AbortSignal): Promise<ScbGroup[]> {
  if (groupsCache) return groupsCache;
  const res = await fetchFn(SCB_META_URL, { signal }); if (!res.ok) throw new Error("scb_meta");
  const j = (await res.json()) as { variables?: { code: string; values: string[]; valueTexts: string[] }[] };
  const v = j.variables?.find((x) => x.code === "Yrke2012"); if (!v) throw new Error("scb_meta_shape");
  groupsCache = v.values.map((code, i) => ({ code, name: v.valueTexts[i] ?? code })).filter((g) => /^\d{4}$/.test(g.code) && !/^000/.test(g.code));
  return groupsCache;
}
export const resetScbCache = () => { groupsCache = null; };

export const PICK_SYSTEM = (groups: ScbGroup[]) => `You map a job to Sweden's occupational classification SSYK 2012. Below is every occupation group in SCB's salary statistics, one per line as "code name".
Pick the group whose work best matches the job described (the work done matters more than the title). If the exact job has no group of its own, pick the closest broader group that contains it (for example a mortgage advisor at a bank is in "Banktjänstemän"). Output ONLY one JSON object: {"code":"<4 digits>","alt":"<4 digits of a second plausible group, or empty>","why":"<one short line>"}.

${groups.map((g) => `${g.code} ${g.name}`).join("\n")}`;

/** Lets the model pick the group, then fetches the range. Null when SCB cannot be reached or has no figures. */
export async function scbMarketRange(input: { role: string; industry?: string; employerType?: unknown; duties?: string }, deps: { model: ChatModel; fetch: Fetch; timeoutMs?: number }): Promise<{ range: MarketRange; research: Record<string, unknown> } | null> {
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 15_000);
  try {
    const groups = await scbGroups(deps.fetch, signal);
    const system = PICK_SYSTEM(groups);
    const reply = await deps.model.complete({ purpose: "extract", system, cachePrefix: system, messages: [{ role: "user", content: `Job: ${input.role}${input.duties ? `\nWork done: ${input.duties}` : ""}${input.industry ? `\nIndustry: ${input.industry}` : ""}` }] });
    const a = reply.indexOf("{"), b = reply.lastIndexOf("}"); const j = a >= 0 && b > a ? JSON.parse(reply.slice(a, b + 1)) : {};
    const byCode = new Map(groups.map((g) => [g.code, g]));
    const sector = sectorFor(input.employerType);
    for (const code of [j.code, j.alt].filter((c): c is string => typeof c === "string" && byCode.has(c))) {
      for (const sec of sector === "0" ? (["0"] as Sector[]) : ([sector, "0"] as Sector[])) { // fall back to all sectors when the sector cell is empty
        const res = await deps.fetch(dataUrl(code, sec), { signal }); if (!res.ok) continue;
        const r = parseScbCsv(await res.text(), byCode.get(code)!, sec); if (!r) continue;
        return { range: toRange(r), research: { source: "scb", group: `${r.code} ${r.name}`, sector: sec, year: r.year, figures: r, why: j.why ?? "", note: "National figures for the whole occupation group; the user's city, experience and employer can move them." } };
      }
    }
    return null;
  } catch { return null; }
}
