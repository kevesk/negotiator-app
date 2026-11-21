import data from "../../data/index.json";
import { tokenize, words } from "./text";
import type { NoteMeta, Chunk, VaultIndex, RetrievalState, RetrievalOptions, Retrieved, RetrievalResult } from "./types";

export const INDEX = data as unknown as VaultIndex;

const DEFAULTS = { maxChunks: 8, charBudget: 6000, linkSlots: 3 };
const SWEDEN_HINT = /\b(sverige|swedish|sweden|skatt|tax|lön|lag|law|kollektivavtal|märket|fack|union|arbetsgivaravgift|pension)/i;
// Roleplay material must never reach the coach, even if a note's audience is misconfigured.
const ROLEPLAY_TYPES = new Set(["persona", "scenario"]);

interface Prepared {
  idf: Map<string, number>; avgLen: number;
  tf: Map<string, Map<string, number>>; len: Map<string, number>;
  chunkNote: Map<string, NoteMeta>; chunkById: Map<string, Chunk>; notes: Map<string, NoteMeta>; byNote: Map<string, Chunk[]>;
}
function prepare(ix: VaultIndex): Prepared {
  const notes = new Map(ix.notes.map((n) => [n.name, n]));
  const tf = new Map<string, Map<string, number>>(), len = new Map<string, number>(), df = new Map<string, number>();
  const chunkNote = new Map<string, NoteMeta>(), chunkById = new Map<string, Chunk>(), byNote = new Map<string, Chunk[]>();
  let total = 0;
  for (const c of ix.chunks) {
    const n = notes.get(c.note)!; chunkNote.set(c.id, n); chunkById.set(c.id, c);
    (byNote.get(c.note) ?? byNote.set(c.note, []).get(c.note)!).push(c);
    // title and heading count double
    const toks = [...tokenize(c.text), ...tokenize(n.title), ...tokenize(n.title), ...tokenize(c.heading), ...tokenize(c.heading)];
    const m = new Map<string, number>(); for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    tf.set(c.id, m); len.set(c.id, toks.length); total += toks.length;
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = ix.chunks.length, idf = new Map<string, number>();
  for (const [t, d] of df) idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  return { idf, avgLen: total / Math.max(1, N), tf, len, chunkNote, chunkById, notes, byNote };
}
let prepared: { ix: VaultIndex; p: Prepared } | undefined;
const prep = (ix: VaultIndex) => (prepared?.ix === ix ? prepared.p : (prepared = { ix, p: prepare(ix) }).p);

/** The hard filter from the conversation state (Retrieval-Design: Filter, then rank). */
export function passesFilter(n: NoteMeta, s: RetrievalState): boolean {
  if (!n.audience.includes(s.agent)) return false;
  if (s.agent === "coach" && n.type && ROLEPLAY_TYPES.has(n.type)) return false;
  if (!n.paths.includes(s.path)) return false;
  if (!n.stages.includes(s.stage)) return false;
  if (n.modifiers.length && !n.modifiers.some((m) => (s.modifiers ?? []).includes(m))) return false;
  if (n.lang !== "en" && n.lang !== "en-sv") return false;
  if (!(s.allowDraft ?? false) && n.status !== "reviewed" && n.status !== "final") return false;
  return true;
}

/** Notes whose alias (or title) appears in the query. Swedish definite forms match by prefix (min 5 letters). */
export function aliasMatches(query: string, ix: VaultIndex = INDEX): Set<string> {
  const q = words(query); const hit = new Set<string>();
  const has = (w: string) => q.some((x) => x === w || (w.length >= 5 && x.startsWith(w)));
  for (const n of ix.notes) for (const a of [n.title, ...n.aliases]) {
    const aw = words(a); if (aw.length && aw.every(has) && aw.join("").length >= 3) { hit.add(n.name); break; }
  }
  return hit;
}

function bm25(p: Prepared, qTerms: string[], id: string): number {
  const m = p.tf.get(id)!; const L = p.len.get(id)!; let s = 0;
  for (const t of qTerms) { const f = m.get(t); if (!f) continue; s += p.idf.get(t)! * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (L / p.avgLen)))); }
  return s;
}
const stageNote = (stage: string) => `${stage[0]!.toUpperCase()}${stage.slice(1)}-Stage`;
const MARKET_ALIAS: Record<string, string> = { market: "Market-Range-Stage" };

function toItem(c: Chunk, n: NoteMeta, score: number, via: Retrieved["via"], s: RetrievalState): Retrieved {
  const year = Number((s.today ?? new Date().toISOString()).slice(0, 4));
  return {
    note: n.name, title: n.title, heading: c.heading, text: c.text, score: Math.round(score * 1000) / 1000, via, cite: n.cite,
    flags: { verify_before_use: n.verify_before_use, outdated: !!n.valid_as_of && Number(n.valid_as_of.slice(0, 4)) < year, confidence: n.confidence, valid_as_of: n.valid_as_of },
  };
}

/**
 * Retrieve notes for one turn. Hard filter, then rank (keyword BM25 plus alias matches, optionally a
 * semantic score), boosts, one chunk per note, a cap and character budget, then one-hop `related` expansion
 * under the same filter. If nothing survives, the stage's own note is returned as a fallback.
 */
export function retrieve(query: string, s: RetrievalState, o: RetrievalOptions = {}, ix: VaultIndex = INDEX): RetrievalResult {
  const { maxChunks, charBudget, linkSlots } = { ...DEFAULTS, ...o };
  const p = prep(ix);
  const aliasHits = aliasMatches(query, ix);
  // An explicit alias in the message (e.g. "kollektivavtal", "lönetransparensdirektivet") waives the modifier and stage gates for that note only,
  // so the notes that help detect a modifier are reachable before it is set. Audience, path, stage,
  // language and status still apply.
  const eligible = new Set(ix.notes.filter((n) => passesFilter(n, s) || (aliasHits.has(n.name) && passesFilter(n, { ...s, modifiers: n.modifiers, stage: n.stages.includes(s.stage) ? s.stage : (n.stages[0] ?? s.stage) }))).map((n) => n.name));
  const qTerms = [...new Set([...tokenize(query), ...[...aliasHits].flatMap((nm) => tokenize(p.notes.get(nm)!.title))])];
  const ids = ix.chunks.filter((c) => eligible.has(c.note)).map((c) => c.id);
  const sem = o.semantic?.(query, ids);
  const sweden = SWEDEN_HINT.test(query);
  const mods = new Set(s.modifiers ?? []);

  let best = new Map<string, { c: Chunk; score: number }>();
  const raw = ids.map((id) => bm25(p, qTerms, id));
  const maxRaw = Math.max(1e-9, ...raw);
  ids.forEach((id, k) => {
    const n = p.chunkNote.get(id)!; const c = p.chunkById.get(id)!;
    let score = raw[k]! / maxRaw;
    if (sem) score = 0.5 * score + 0.5 * (sem.get(id) ?? 0);
    if (aliasHits.has(n.name)) score += 0.35;
    if (score <= 0.02 && !aliasHits.has(n.name)) return;
    if (n.modifiers.some((m) => mods.has(m))) score *= 1.15;
    if (n.name === stageNote(s.stage) || (s.stage === "market" && n.name === MARKET_ALIAS.market)) score *= 1.15;
    if (sweden && n.type === "sweden") score *= 1.2;
    const cur = best.get(n.name); if (!cur || score > cur.score) best.set(n.name, { c, score });
  });
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));

  const items: Retrieved[] = []; let chars = 0; const used = new Set<string>();
  const push = (c: Chunk, score: number, via: Retrieved["via"]) => {
    const n = p.notes.get(c.note)!;
    if (used.has(n.name) || items.length >= maxChunks || chars + c.text.length > charBudget) return false;
    used.add(n.name); chars += c.text.length; items.push(toItem(c, n, score, via, s)); return true;
  };
  for (const r of ranked) { if (items.length >= maxChunks - linkSlots) break; push(r.c, r.score, "search"); }
  // one-hop expansion from the top notes, lower priority, same filter, same budget
  let links = 0;
  for (const top of items.slice(0, 3).filter((i) => i.via === "search")) {
    for (const rel of p.notes.get(top.note)!.related) {
      if (links >= linkSlots || items.length >= maxChunks || used.has(rel) || !eligible.has(rel)) continue;
      const chs = p.byNote.get(rel) ?? []; if (!chs.length) continue;
      const pick = [...chs].sort((a, b) => bm25(p, qTerms, b.id) - bm25(p, qTerms, a.id))[0]!;
      if (push(pick, top.score * 0.5, "link")) links++;
    }
  }
  // fill remaining search slots
  for (const r of ranked) { if (items.length >= maxChunks) break; push(r.c, r.score, "search"); }

  if (!items.length) {
    // the stage's own note; intake and position have no shared stage note, so use the path's notes
    const candidates = [stageNote(s.stage), `${s.path}-${s.stage[0]!.toUpperCase()}${s.stage.slice(1)}`, `${s.path}-Path-Overview`];
    for (const nm of candidates) {
      const c = eligible.has(nm) ? p.byNote.get(nm)?.[0] : undefined;
      if (c) { push(c, 0, "fallback"); break; }
    }
    return { items, fallback: true, chars };
  }
  return { items, fallback: false, chars };
}
