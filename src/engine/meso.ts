// Package builder for multiple equivalent simultaneous offers (MESO, Medvec and Galinsky). Deterministic; no model call.
// It builds two or three packages that are worth about the same to the user (by the user's own weights) but are made
// of really different things, so the employer's choice shows what it values most and the employer gets a real choice.
import { scorePackages, type Issue, type Pkg } from "./scoring";

export type Level = 0 | 1 | 2; // light, middle, strong version of an item
/** What each level is worth to the user, 0 to 100 (the same scale as Scoring-Systems: the walk-away is 0, the best option 100). */
export const LEVEL_RATING: Record<Level, number> = { 0: 30, 1: 65, 2: 100 };
export type Theme = "cash" | "time" | "growth";
type Cost = "budget" | "low" | "later";
interface Catalogue { id: string; match: RegExp; theme: Theme; cost: Cost; label: { en: string; sv: string }; levels: { en: [string, string, string]; sv: [string, string, string] } }

/** The items people most often negotiate in Sweden, each with three realistic versions. Base pay is computed from the user's numbers. */
export const CATALOGUE: Catalogue[] = [
  { id: "base", match: /^(base|basic|monthly)?\s*(salary|pay|wage)$|^(grund|månads)?lön$|^base$/i, theme: "cash", cost: "budget", label: { en: "Base salary", sv: "Grundlön" }, levels: { en: ["", "", ""], sv: ["", "", ""] } },
  { id: "bonus", match: /bonus|variable|commission|provision|rörlig/i, theme: "cash", cost: "later", label: { en: "Bonus", sv: "Bonus" }, levels: { en: ["bonus up to 3% of yearly salary", "bonus up to 6% of yearly salary", "bonus up to 10% of yearly salary"], sv: ["bonus upp till 3 % av årslönen", "bonus upp till 6 % av årslönen", "bonus upp till 10 % av årslönen"] } },
  { id: "pension", match: /pension/i, theme: "cash", cost: "budget", label: { en: "Pension", sv: "Pension" }, levels: { en: ["pension 1 percentage point above the agreement", "pension 2 percentage points above the agreement", "pension 4 percentage points above the agreement"], sv: ["pension 1 procentenhet över avtalet", "pension 2 procentenheter över avtalet", "pension 4 procentenheter över avtalet"] } },
  { id: "vacation", match: /vacation|holiday|leave|semester|ledig|days off/i, theme: "time", cost: "low", label: { en: "Vacation", sv: "Semester" }, levels: { en: ["2 extra vacation days", "4 extra vacation days", "6 extra vacation days"], sv: ["2 extra semesterdagar", "4 extra semesterdagar", "6 extra semesterdagar"] } },
  { id: "remote", match: /remote|home|hybrid|distans|hemma|work from/i, theme: "time", cost: "low", label: { en: "Remote work", sv: "Distansarbete" }, levels: { en: ["1 day a week from home", "2 days a week from home", "3 days a week from home"], sv: ["1 dag i veckan hemifrån", "2 dagar i veckan hemifrån", "3 dagar i veckan hemifrån"] } },
  { id: "flex", match: /flex|hours|schedule|working time|arbetstid|tider/i, theme: "time", cost: "low", label: { en: "Flexible hours", sv: "Flexibel arbetstid" }, levels: { en: ["flexible start and end times", "flexible hours around core hours 9 to 15", "fully flexible hours, judged on results"], sv: ["flexibel start- och sluttid", "flexibla tider kring kärntid 9 till 15", "helt flexibla tider, bedöms på resultat"] } },
  { id: "start", match: /start|tillträde|begin/i, theme: "time", cost: "low", label: { en: "Start date", sv: "Startdatum" }, levels: { en: ["start date flexible by 2 weeks", "start up to 1 month later", "start up to 2 months later"], sv: ["startdatum flexibelt med 2 veckor", "start upp till 1 månad senare", "start upp till 2 månader senare"] } },
  { id: "training", match: /train|educat|course|learning|development budget|utbild|kurs|kompetens|certif/i, theme: "growth", cost: "later", label: { en: "Training budget", sv: "Utbildningsbudget" }, levels: { en: ["10 000 SEK a year for training", "20 000 SEK a year for training", "35 000 SEK a year for training"], sv: ["10 000 kr om året till utbildning", "20 000 kr om året till utbildning", "35 000 kr om året till utbildning"] } },
  { id: "title", match: /title|role|promotion|responsib|titel|befordran|roll|ansvar/i, theme: "growth", cost: "low", label: { en: "Title and role", sv: "Titel och roll" }, levels: { en: ["a written development path for the next role", "senior title after 6 months", "senior title from the start"], sv: ["en skriftlig utvecklingsplan mot nästa roll", "seniortitel efter 6 månader", "seniortitel från start"] } },
  { id: "review", match: /review|raise|revision|follow-?up|översyn|löneöversyn|utvärdering/i, theme: "growth", cost: "later", label: { en: "Salary review", sv: "Lönerevision" }, levels: { en: ["salary review after 12 months with agreed criteria", "salary review after 6 months with agreed criteria", "salary review after 6 months with a stated minimum raise"], sv: ["lönerevision efter 12 månader med överenskomna kriterier", "lönerevision efter 6 månader med överenskomna kriterier", "lönerevision efter 6 månader med en angiven lägstahöjning"] } },
  { id: "security", match: /secur|notice|stabil|trygg|uppsägning|probation|prövotid|provanst/i, theme: "growth", cost: "low", label: { en: "Job security", sv: "Trygghet" }, levels: { en: ["a shorter probation period", "a notice period of 3 months for the employer", "no probation period and a notice period of 3 months for the employer"], sv: ["kortare provanställning", "3 månaders uppsägningstid från arbetsgivaren", "ingen provanställning och 3 månaders uppsägningstid från arbetsgivaren"] } },
];
const GENERIC = (label: string) => ({ id: label.toLowerCase().replace(/[^a-z0-9åäö]+/gi, "_"), theme: "growth" as Theme, cost: "low" as Cost });

export interface MesoIssue { id: string; label: string; weight: number }
export interface MesoItem { issue: string; label: string; level: Level; text: string; theme: Theme; cost: Cost }
export interface MesoPackage {
  id: string; /** "cash", "time" or "growth": what this package leans on most. */ lean: Theme; items: MesoItem[]; score: number;
  /** Relative cost to the employer: "budget" takes the most cash now, "low" the least, "later" is in between. */ employerCost: Cost;
  /** What the employer choosing this package tells the user. */ shows: string;
}
export interface MesoResult {
  packages: MesoPackage[]; issues: MesoIssue[]; spread: number;
  /** Ranking from the scoring engine; the packages share one group when they are worth about the same. */
  sameValue: boolean; basis: string; notes: string[];
  /** The middle version of each item besides base pay, most important first: realistic things to ask for in return for a concession. */
  trades: string[];
}
const round500 = (n: number) => Math.round(n / 500) * 500;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");

/** Normalises weights to 100 and keeps at most six items. */
export function normaliseWeights(raw: { label: string; weight: number }[]): MesoIssue[] {
  const top = [...raw].filter((r) => r.weight > 0 && r.label.trim()).sort((a, b) => b.weight - a.weight).slice(0, 6);
  const sum = top.reduce((a, r) => a + r.weight, 0); if (!sum) return [];
  const exact = top.map((r) => (r.weight / sum) * 100); const w = exact.map(Math.floor);
  let rest = 100 - w.reduce((a, b) => a + b, 0);
  for (const i of exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)) { if (rest-- <= 0) break; w[i]!++; }
  return top.map((r, i) => ({ id: "", label: r.label.trim(), weight: w[i]! }));
}
const catalogueFor = (label: string) => CATALOGUE.find((c) => c.match.test(label));

/** Reads the weights from whatever shape the extraction stored: { item: points } or a list of { item, points }. */
export function weightsFromSlot(v: unknown): { label: string; weight: number }[] {
  const out: { label: string; weight: number }[] = [];
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && /^\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : undefined);
  if (Array.isArray(v)) for (const it of v) { if (it && typeof it === "object") { const o = it as Record<string, unknown>; const label = o.issue ?? o.item ?? o.label ?? o.name ?? o.id; const w = n(o.weight ?? o.points ?? o.value ?? o.score); if (typeof label === "string" && w !== undefined) out.push({ label, weight: w }); } }
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const w = n(x) ?? n((x as Record<string, unknown> | undefined)?.weight ?? (x as Record<string, unknown> | undefined)?.points); if (w !== undefined) out.push({ label: k.replace(/_/g, " "), weight: w }); }
  return out;
}

export interface MesoInput { weights: { label: string; weight: number }[]; target?: number; walkAway?: number; lang?: "en" | "sv" }

/** Three levels of base pay between the walk-away (rating 0) and the target (rating 100), so each level matches its rating on the same scale. */
function baseLevels(walkAway: number, target: number): [number, number, number] {
  const at = (r: number) => round500(walkAway + ((target - walkAway) * r) / 100);
  return [at(LEVEL_RATING[0]), at(LEVEL_RATING[1]), round500(target)];
}

export function buildPackages(inp: MesoInput): MesoResult | { needs: string[] } {
  const lang = inp.lang ?? "en";
  const issues = normaliseWeights(inp.weights);
  if (issues.length < 2) return { needs: ["issue_weights"] };
  const cat = issues.map((is) => catalogueFor(is.label));
  const base = cat.findIndex((c) => c?.id === "base");
  const haveBase = base >= 0 && inp.target !== undefined && inp.walkAway !== undefined && inp.target > inp.walkAway;
  const ids = issues.map((is, i) => { const c = cat[i]; return c ? (cat.findIndex((x) => x?.id === c.id) === i ? c.id : `${c.id}_${i}`) : `${GENERIC(is.label).id}_${i}`; });
  issues.forEach((is, i) => { is.id = ids[i]!; });
  const n = issues.length;
  const rating = (l: number) => LEVEL_RATING[l as Level];
  const score = (c: number[]) => c.reduce((a, l, i) => a + (issues[i]!.weight * rating(l)) / 100, 0);
  // every combination of light, middle and strong versions (3 to the power of 6 at most, 729)
  const combos: number[][] = [[]];
  for (let i = 0; i < n; i++) { const next: number[][] = []; for (const c of combos) for (const l of [0, 1, 2]) next.push([...c, l]); combos.splice(0, combos.length, ...next); }
  const dist = (a: number[], b: number[]) => a.reduce((s, l, i) => s + issues[i]!.weight * Math.abs(l - b[i]!), 0); // weighted distance
  const differing = (a: number[], b: number[]) => a.filter((l, i) => l !== b[i]).length;
  // a real choice: the packages differ on most items, and on at least two of them by two steps (strong against light)
  const bigGaps = (a: number[], b: number[]) => a.filter((l, i) => Math.abs(l - b[i]!) === 2).length;
  const leanOf = (c: number[]): Theme => { const by: Record<Theme, number> = { cash: 0, time: 0, growth: 0 }; c.forEach((l, i) => { by[(cat[i]?.theme ?? "growth")] += (issues[i]!.weight * rating(l)) / 100; }); return (Object.keys(by) as Theme[]).sort((x, y) => by[y] - by[x])[0]!; };
  /** Higher is better: the closest pair is still far apart, the packages lean on different kinds of items, and they are worth a lot to the user. */
  const objective = (set: number[][], top: number) => { let m = Infinity, sum = 0; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) { const d = dist(set[i]!, set[j]!); m = Math.min(m, d); sum += d; } return 3 * m + sum + 40 * new Set(set.map(leanOf)).size + 0.8 * top; };
  // strict first; a little more room in value, and last a looser difference rule, only when the strict search finds nothing (few items, uneven points)
  const ATTEMPTS = [
    { gap: 4, minDiff: n >= 4 ? n - 1 : Math.min(2, n), minBig: n >= 4 ? 2 : 1 }, { gap: 6, minDiff: n >= 4 ? n - 1 : Math.min(2, n), minBig: n >= 4 ? 2 : 1 },
    { gap: 8, minDiff: Math.min(2, n), minBig: 1 }, { gap: 10, minDiff: Math.min(2, n), minBig: 0 }, { gap: 40, minDiff: 1, minBig: 0 }, // last resort: two different packages, even if their values are not close
  ];
  let best: { set: number[][]; value: number; s: number } | undefined;
  for (const at of ATTEMPTS) {
    const ok = (a: number[], b: number[]) => differing(a, b) >= at.minDiff && bigGaps(a, b) >= at.minBig;
    for (const want of [3, 2]) {
      for (let top = 92; top >= 50; top -= n <= 2 ? 1 : 3) {
        let band = combos.filter((c) => { const s = score(c); return s <= top && s > top - at.gap; });
        if (band.length > 110) { const step = band.length / 110; band = Array.from({ length: 110 }, (_, k) => band[Math.floor(k * step)]!); }
        const consider = (set: number[][]) => { const v = objective(set, top); if (!best || v > best.value) best = { set, value: v, s: top }; };
        for (let i = 0; i < band.length; i++) for (let j = i + 1; j < band.length; j++) {
          if (!ok(band[i]!, band[j]!)) continue;
          if (want === 2) consider([band[i]!, band[j]!]);
          else for (let k = j + 1; k < band.length; k++) if (ok(band[i]!, band[k]!) && ok(band[j]!, band[k]!)) consider([band[i]!, band[j]!, band[k]!]);
        }
      }
      if (best) break;
    }
    if (best) break;
  }
  if (!best) return { needs: ["issue_weights"] };

  const lv = haveBase ? baseLevels(inp.walkAway!, inp.target!) : undefined;
  const textFor = (i: number, level: number): string => {
    const c = cat[i];
    if (c?.id === "base") return lv ? `${lang === "sv" ? "grundlön" : "base salary"} ${fmt(lv[level]!)} ${lang === "sv" ? "kr i månaden" : "SEK a month"}` : lang === "sv" ? ["lägre grundlön", "grundlön mellan", "högre grundlön"][level]! : ["lower base salary", "middle base salary", "higher base salary"][level]!;
    if (c) return c.levels[lang][level]!;
    const l = issues[i]!.label.toLowerCase();
    return lang === "sv" ? [`en liten del av ${l}`, `en medelstor del av ${l}`, `en stor del av ${l}`][level]! : [`a small step on ${l}`, `a medium step on ${l}`, `a big step on ${l}`][level]!;
  };
  const meta = (i: number) => cat[i] ?? { ...GENERIC(issues[i]!.label), label: { en: issues[i]!.label, sv: issues[i]!.label } };
  const lean = (c: number[]): Theme => { const by: Record<Theme, number> = { cash: 0, time: 0, growth: 0 }; c.forEach((l, i) => { by[meta(i).theme] += (issues[i]!.weight * rating(l)) / 100; }); return (Object.keys(by) as Theme[]).sort((a, b) => by[b] - by[a])[0]!; };
  const SHOWS: Record<Theme, { en: string; sv: string }> = {
    cash: { en: "Choosing this suggests the budget has room now and they would rather pay than change how you work.", sv: "Väljer de detta har de utrymme i budgeten nu och betalar hellre än ändrar hur du arbetar." },
    time: { en: "Choosing this suggests pay is tight but they can be flexible about time and place.", sv: "Väljer de detta är lönen snäv men de kan vara flexibla med tid och plats." },
    growth: { en: "Choosing this suggests they prefer to promise growth or a later raise over paying more now.", sv: "Väljer de detta föredrar de att lova utveckling eller en senare höjning framför att betala mer nu." },
  };
  const letters = ["A", "B", "C"];
  // lean: the kind of item each package is strongest on compared with the other packages (not in absolute terms, where base pay always wins)
  const themeScore = (c: number[], th: Theme) => c.reduce((a, l, i) => a + (meta(i).theme === th ? (issues[i]!.weight * rating(l)) / 100 : 0), 0);
  const present = (["cash", "time", "growth"] as Theme[]).filter((th) => issues.some((_, i) => meta(i).theme === th));
  const rel = best.set.map((c) => Object.fromEntries(present.map((th) => [th, themeScore(c, th) - best!.set.reduce((a, o) => a + themeScore(o, th), 0) / best!.set.length])) as Record<Theme, number>);
  const leans: (Theme | undefined)[] = best.set.map(() => undefined); const used = new Set<Theme>();
  for (const [k, th] of best.set.flatMap((_, k) => present.map((th) => [k, th] as const)).sort((a, b) => rel[b[0]]![b[1]] - rel[a[0]]![a[1]])) {
    if (leans[k] || used.has(th) || rel[k]![th] <= 0) continue; leans[k] = th; used.add(th);
  }
  // cost to the employer, relative: which package takes the most cash now (base pay and pension), which the least
  const cashNow = (c: number[]) => c.reduce((a, l, i) => a + (meta(i).cost === "budget" ? l * (cat[i]?.id === "base" ? 3 : 1) : meta(i).cost === "later" ? l * 0.3 : 0), 0);
  const cash = best.set.map(cashNow); const hi = Math.max(...cash), lo = Math.min(...cash);
  const costOf = (k: number): Cost => (hi === lo ? "later" : cash[k] === hi ? "budget" : cash[k] === lo ? "low" : "later");
  const GENERIC_SHOWS = { en: "Choosing this shows which of the differences between the packages they value most.", sv: "Väljer de detta visar det vad de värderar mest av det som skiljer paketen åt." };
  const packages: MesoPackage[] = best.set.map((c, k) => ({
    id: letters[k]!, lean: leans[k] ?? lean(c), items: c.map((l, i) => ({ issue: issues[i]!.id, label: meta(i).label[lang], level: l as Level, text: textFor(i, l), theme: meta(i).theme, cost: meta(i).cost })),
    score: Math.round(score(c) * 10) / 10, employerCost: costOf(k), shows: leans[k] ? SHOWS[leans[k]!][lang] : GENERIC_SHOWS[lang],
  }));
  // the scoring engine confirms the packages are worth about the same to the user
  const sc = scorePackages(issues.map((is): Issue => ({ id: is.id, weight: is.weight, kind: "rated" })), best.set.map((c, k): Pkg => ({ id: letters[k]!, values: Object.fromEntries(c.map((l, i) => [issues[i]!.id, rating(l)])) })));
  const sameValue = sc.ranking.length === best.set.length && new Set(sc.ranking.map((r) => r.tieGroup)).size === 1;
  const scores = packages.map((p) => p.score);
  return {
    packages, issues, spread: Math.round((Math.max(...scores) - Math.min(...scores)) * 10) / 10, sameValue,
    basis: haveBase ? `base salary levels run from ${fmt(inp.walkAway!)} (walk-away, rating 0) to ${fmt(inp.target!)} (target, rating 100)` : "no base salary levels: salary was not one of the items or the target and walk-away are missing",
    trades: issues.map((is, i) => ({ is, c: cat[i] })).filter((x) => x.c && x.c.id !== "base").sort((a, b) => b.is.weight - a.is.weight).map((x) => x.c!.levels[lang][1]),
    notes: [lang === "sv" ? "Nivåerna är förslag att justera efter vad arbetsgivaren faktiskt kan erbjuda." : "The levels are proposals; adjust them to what this employer can actually offer."],
  };
}
