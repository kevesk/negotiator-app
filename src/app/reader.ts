// What the reader sees: the coach writes source tags for the checks; the reader gets plain text (D113).
// Pure functions, shared by the chat, the brief view and the PDF.
import type { SessionState } from "@/orchestrator/state";
type Lang = "en" | "sv";

/** Marks an assumption inside cleaned text; the renderers turn it into a small label. */
export const ASSUMED = "⁠{assumed}⁠";
const TAG = String.raw`\[(?:user|computed|researcher|assumed|estimate)[^\]\n]{0,40}\]`;
const COMBO = new RegExp(`${TAG}(?:\\s*(?:/|,|\\+|and|och|&)\\s*${TAG})+`, "gi");
const ONE = new RegExp(TAG, "gi");

/** Removes source tags, keeps "assumption" as a marker, and writes the Based-on line in the user's language. */
export function cleanForReader(text: string, lang: Lang): string {
  let t = text.replace(/\s*\[(?:unverified|overifierat)\s*:?\s*([^\]\n]{0,90})\]/gi, (_m, why: string) => (why.trim() ? ` (${why.trim()})` : ""));
  t = t.replace(COMBO, (m) => (/assumed/i.test(m) ? ` ${ASSUMED}` : ""));
  t = t.replace(ONE, (m) => (/assumed/i.test(m) ? ` ${ASSUMED}` : ""));
  t = t.replace(/[ \t]+([,.;:)])/g, "$1").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/ +$/gm, "");
  if (lang === "sv") t = t.replace(/(\*?)\s*Based on:/g, "$1Baseras på:");
  return t;
}
/** Drops table columns whose body cells are all empty after cleaning (a "Tag" or "Source" column, for example). */
export function dropEmptyColumns(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;
  const width = Math.max(...rows.map((r) => r.length));
  const keep = [...Array(width).keys()].filter((c) => rows.slice(1).some((r) => (r[c] ?? "").replace(ASSUMED, "").trim() !== ""));
  return rows.map((r) => keep.map((c) => r[c] ?? ""));
}

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") for (const k of ["monthly", "amount", "value"]) { const x = (v as Record<string, unknown>)[k]; if (typeof x === "number") return x; }
  return undefined;
};
const slot = (s: SessionState | null, id: string): unknown => { const v = s?.slots[id]; return v && !v.stale ? v.value : undefined; };

/** The figures the deal line shows, taken from the session. Anything unknown is left out. */
export interface DealFigures { walkAway?: number; target?: number; firstOffer?: number; current?: number; offer?: number; low?: number; mid?: number; high?: number }
export function dealFigures(s: SessionState | null): DealFigures {
  const range = (slot(s, "market_range") ?? s?.outputs.market_range) as { p25?: number; median?: number; p75?: number } | undefined;
  const numbers = s?.outputs.numbers as { defaultAnchor?: { amount?: number } } | undefined;
  return {
    walkAway: num(slot(s, "walk_away")), target: num(slot(s, "own_target")),
    firstOffer: num(slot(s, "first_offer")) ?? numbers?.defaultAnchor?.amount,
    current: num(slot(s, "current_base")), offer: num(slot(s, "offer_base")),
    low: typeof range?.p25 === "number" ? range.p25 : undefined, mid: typeof range?.median === "number" ? range.median : undefined, high: typeof range?.p75 === "number" ? range.p75 : undefined,
  };
}
export const kr = (n: number, lang: Lang) => `${Math.round(n).toLocaleString(lang === "sv" ? "sv-SE" : "en-GB").replace(/,/g, " ")} kr`;
