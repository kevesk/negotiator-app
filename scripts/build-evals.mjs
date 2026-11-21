// Generates evals/cases.generated.json from the case files in 10-Evals/Cases of the vault.
// Usage: node scripts/build-evals.mjs "<vault folder>"
import fs from "node:fs";
import path from "node:path";
const vault = process.argv[2]; if (!vault) { console.error("Give the vault folder"); process.exit(1); }
const dir = path.join(vault, "10-Evals/Cases");
const cases = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
  const md = fs.readFileSync(path.join(dir, file), "utf8").replace(/^﻿/, "");
  for (const block of md.split(/\n(?=### )/).filter((b) => b.startsWith("### "))) {
    const head = block.match(/^### ([A-Z]{2,3}-\d+) · (.*)$/m); if (!head) continue;
    const field = (name) => { const m = block.match(new RegExp(`^- \\*\\*${name}:\\*\\*\\s*(.*)$`, "m")); return m ? m[1].trim() : ""; };
    const list = (s) => s.split(/;\s+/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean);
    const input = field("Input"); const quoted = input.match(/["“]([^"”]+)["”]/);
    const check = field("Check").toLowerCase();
    cases.push({
      id: head[1], name: head[2].trim(), file: file.replace(/\.md$/, ""),
      tests: field("Tests").split(/,\s*/).filter(Boolean), setup: field("Setup"), input, message: quoted ? quoted[1] : null,
      must: list(field("Must")), mustNot: list(field("Must not")), check, severity: field("Severity").toLowerCase(),
      judge: /judge/.test(check), human: /human/.test(check),
    });
  }
}
const ids = new Set(cases.map((c) => c.id));
if (ids.size !== cases.length) throw new Error("duplicate case ids");
for (const c of cases) if (!c.id || !c.must.length || !["critical", "major", "minor"].includes(c.severity) || !c.check) throw new Error("incomplete case: " + c.id);
if (cases.length !== 76) console.warn(`warning: expected 76 cases, found ${cases.length}`);
fs.mkdirSync(new URL("../evals/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../evals/cases.generated.json", import.meta.url), JSON.stringify({ built_on: new Date().toISOString().slice(0, 10), cases }, null, 1));
const by = (k) => cases.reduce((m, c) => ((m[c[k]] = (m[c[k]] ?? 0) + 1), m), {});
console.log("eval cases:", cases.length, JSON.stringify(by("severity")));
