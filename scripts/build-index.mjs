// Builds data/index.json from the vault: only notes with retrievable: true, chunked by heading.
// Usage: node scripts/build-index.mjs "<vault folder>"   (or npm run build-index -- "<vault folder>")
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const vault = process.argv[2];
if (!vault) { console.error("Give the path to the vault folder"); process.exit(1); }
const OUT = new URL("../data/index.json", import.meta.url);
const STAGES = ["route", "intake", "position", "market", "numbers", "strategy", "scripts", "brief", "practice", "debrief"];
const AGENTS = ["coach", "researcher", "simulator", "scorer", "writer", "critic"];
const MIN_CHUNK = 40;

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  if (e.name.startsWith(".") || e.name === "_attachments") return [];
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
});
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null);
const list = (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const clean = (t) => t.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, "$1");

const notes = [], chunks = [], problems = [];
for (const file of walk(vault).sort()) {
  const src = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) continue;
  let fm; try { fm = parseYaml(m[1]); } catch (e) { problems.push(`${file}: bad YAML`); continue; }
  if (fm?.retrievable !== true) continue;
  const name = path.basename(file, ".md");
  const rel = path.relative(vault, file);
  const audience = list(fm.audience), paths = list(fm.paths), stages = list(fm.stages), lang = fm.lang;
  if (!audience.length || !paths.length || !stages.length || !lang) problems.push(`${rel}: retrievable but missing audience/paths/stages/lang`);
  for (const a of audience) if (!AGENTS.includes(a)) problems.push(`${rel}: unknown audience ${a}`);
  for (const s of stages) if (!STAGES.includes(s)) problems.push(`${rel}: unknown stage ${s}`);
  const title = String(fm.title ?? name.replace(/-/g, " "));
  notes.push({
    name, title, folder: path.dirname(rel), type: fm.type ?? null, status: fm.status ?? null,
    audience, cite: fm.cite ?? "ok", aliases: list(fm.aliases), tags: list(fm.tags), paths, stages,
    modifiers: list(fm.modifiers), lang, valid_as_of: iso(fm.valid_as_of), verify_before_use: fm.verify_before_use === true,
    confidence: fm.confidence ?? null, related: list(fm.related).map((r) => r.replace(/^\[\[|\]\]$/g, "")),
  });
  // split by headings, ignoring code fences
  const stack = []; let cur = { heading: [], lines: [] }; const secs = []; let fence = false;
  for (const line of m[2].split(/\r?\n/)) {
    if (/^```/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      secs.push(cur); const lvl = h[1].length; stack.length = lvl - 1; stack[lvl - 1] = h[2];
      cur = { heading: stack.filter(Boolean).slice(), lines: [] };
    } else cur.lines.push(line);
  }
  secs.push(cur);
  let i = 0;
  for (const s of secs) {
    const head = s.heading.length ? s.heading : [];
    const last = head[head.length - 1]?.toLowerCase();
    if (last === "related" || last === "sources") continue; // stored as metadata, not embedded
    const text = clean(s.lines.join("\n")).trim();
    if (text.length < MIN_CHUNK) continue;
    // the note's own H1 repeats the title; drop it from the path
    const hp = head.filter((x, k) => !(k === 0 && x.toLowerCase() === title.toLowerCase()));
    chunks.push({ id: `${name}#${i++}`, note: name, heading: hp.join(" > "), text });
  }
}
const names = new Set(notes.map((n) => n.name));
for (const n of notes) n.related = n.related.filter((r) => names.has(r));
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify({ built_on: new Date().toISOString().slice(0, 10), notes, chunks }));
console.log(`indexed ${notes.length} notes, ${chunks.length} chunks, ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
