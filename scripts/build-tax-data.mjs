// Builds data/tax/tax-2026.json from Skatteverket's raw .txt files (column 1 only).
// Layout (Postbeskrivning allmanna tabeller): pos1-2 type, 3 B|%, 4-5 table, 6-12 low, 13-19 high, 20-24 col 1.
import fs from "node:fs";
const INCOME_YEAR = 2026;
const raw = (f) => fs.readFileSync(new URL(`../data/tax/raw/${f}`, import.meta.url), "utf8").replace(/^﻿/, "");
const tables = {};
for (const line of raw("allmanna-tabeller-manad.txt").split(/\r?\n/)) {
  if (!line.trim()) continue;
  if (line.slice(0, 2) !== "30") throw new Error("unexpected period type: " + line);
  const kind = line[2]; const t = line.slice(3, 5);
  const low = Number(line.slice(5, 12)); const highS = line.slice(12, 19).trim();
  const high = highS === "" ? null : Number(highS); const col1 = Number(line.slice(19, 24));
  if (![low, col1].every(Number.isFinite) || (high !== null && !Number.isFinite(high))) throw new Error("bad row: " + line);
  const e = (tables[t] ??= { bands: [], pct: [] });
  (kind === "B" ? e.bands : e.pct).push([low, high, col1]);
}
const keys = Object.keys(tables).map(Number).sort((a, b) => a - b);
if (keys[0] !== 29 || keys.at(-1) !== 42 || keys.length !== 14) throw new Error("expected tables 29..42, got " + keys);
const municipalities = {};
const lines = raw("skattesatser-kommuner-2026.txt").split(/\r?\n/).filter(Boolean);
for (const l of lines.slice(1)) {
  const f = l.split("\t"); const name = f[2]; const exCh = Number(f[5]);
  if (municipalities[name] !== undefined && municipalities[name] !== exCh) throw new Error("parishes differ in " + name);
  municipalities[name] = exCh;
}
const out = {
  meta: {
    income_year: INCOME_YEAR, column: 1, retrieved_on: "2026-11-21",
    source_urls: [
      "https://www.skatteverket.se/download/18.1522bf3f19aea8075ba5af/1765287119989/allmanna-tabeller-manad.txt",
      "https://www.skatteverket.se/download/18.1522bf3f19aea8075ba428/1765291540367/skattesatser-kommuner-2026.txt",
    ],
    municipal_rate_field: "Summa, exkl. kyrkoavgift (municipal + regional + burial fee)",
  },
  params: {
    national_average_rate: 32.38,
    employer_contribution: 31.42,
    reduced_contribution: { rate: 20.81, monthly_cap: 25000, birth_years: [2003, 2007], from: "2026-04-01", to: "2027-09-30" },
    valid_as_of: "2026-11-21",
  },
  tables, municipalities,
};
fs.writeFileSync(new URL("../data/tax/tax-2026.json", import.meta.url), JSON.stringify(out));
console.log("tables", keys.length, "bands", Object.values(tables).reduce((a, t) => a + t.bands.length, 0), "municipalities", Object.keys(municipalities).length);
