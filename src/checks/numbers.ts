export type FigureKind = "percent" | "money" | "plain";
export interface Figure { value: number; kind: FigureKind; raw: string }

const NUM = /\d[\d  .,]*\d|\d/g;
/** Parses one numeric token written Swedish or English style ("52 000", "52,000", "52.000", "4,5", "32.38"). */
export function parseNumber(tok: string): number | null {
  let t = tok.replace(/ /g, " ").trim();
  if (/ /.test(t)) { // spaces count only as thousand separators when every later group has exactly 3 digits
    const parts = t.split(" "); if (!parts.slice(1).every((p) => /^\d{3}([.,]\d+)?$/.test(p))) return null;
    t = parts.join("");
  }
  const hasDot = t.includes("."), hasComma = t.includes(",");
  if (hasDot && hasComma) { const dec = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ","; const th = dec === "." ? "," : "."; t = t.split(th).join("").replace(dec, "."); }
  else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ","; const parts = t.split(sep);
    if (parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3 && parts[0]!.length <= 3 && parts[0] !== "0")) t = parts.join(""); // thousands
    else t = parts.join(".");
  }
  const v = Number(t); return Number.isFinite(v) ? v : null;
}

/** Figures in a text that a reader could take as a number to rely on: percentages, money, and any number of 1,000 or more. */
export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  const clean = text.replace(/\[(user|researcher|computed|assumed)\]/gi, " ");
  for (const m of clean.matchAll(NUM)) {
    const raw = m[0]; const value = parseNumber(raw); if (value === null) continue;
    const after = clean.slice(m.index! + raw.length, m.index! + raw.length + 12).toLocaleLowerCase("sv-SE");
    const before = clean.slice(Math.max(0, m.index! - 5), m.index!).toLocaleLowerCase("sv-SE");
    const kind: FigureKind = /^\s*(%|procent|percent|per cent)/.test(after) ? "percent" : /^\s*(kr\b|kronor|sek\b|:-|kr\.)/.test(after) || /sek\s*$/.test(before) ? "money" : "plain";
    const year = kind === "plain" && Number.isInteger(value) && value >= 1900 && value <= 2100;
    const dateLike = /^[-/.]\d/.test(after);
    if (kind === "plain" && (value < 1000 || year || dateLike)) continue;
    out.push({ value, kind, raw });
  }
  return out;
}
/** All figures (any size) in the source texts a reply may draw on. */
export function allowedValues(texts: string[], extra: number[] = []): Set<number> {
  const s = new Set<number>(extra);
  for (const t of texts) for (const m of t.matchAll(NUM)) { const v = parseNumber(m[0]); if (v !== null) s.add(v); }
  return s;
}
