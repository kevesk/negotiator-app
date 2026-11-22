import { it, expect } from "vitest";
import fs from "node:fs";
import { anthropicModel } from "@/server/anthropic";
import { HARD_RULES } from "@/agents/hard-rules.generated";
import { runCase, evaluateGate, staleNotes, report, REPEATS, type EvalCase, type RunResult, type Setup } from "./harness";
import data from "./cases.generated.json";
import index from "../data/index.json";

// Choose what to run with environment variables:
//   EVAL_SCOPE = critical | quick | full   (critical: critical cases x5; quick: every case once; full: critical x5, major x2, minor x1)
//   EVAL_ONLY  = comma-separated case ids (overrides which cases run; the scope still decides the repeats: quick once, critical or full by severity)
const scope = process.env.EVAL_SCOPE ?? "quick";
const only = (process.env.EVAL_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const key = process.env.ANTHROPIC_API_KEY;

it.skipIf(!key)("run the eval cases and apply the release gate", async () => {
  const model = anthropicModel({ apiKey: key!, model: process.env.ANTHROPIC_MODEL });
  const judge = process.env.EVAL_JUDGE_MODEL ? anthropicModel({ apiKey: key!, model: process.env.EVAL_JUDGE_MODEL }) : undefined;
  const all = (data.cases as unknown as EvalCase[]);
  const chosen = only.length ? all.filter((c) => only.includes(c.id)) : scope === "critical" ? all.filter((c) => c.severity === "critical") : all;
  const today = new Date().toISOString().slice(0, 10);
  const cache = new Map<string, Setup>(); const results: RunResult[] = [];
  const queue = chosen.flatMap((c) => Array.from({ length: scope === "quick" ? 1 : REPEATS[c.severity] }, (_, i) => ({ c, run: i + 1 })));
  let next = 0; const worker = async () => { for (;;) { const job = queue[next++]; if (!job) return; results.push(await runCase(job.c, job.run, { model, judge, today }, cache)); } };
  await Promise.all(Array.from({ length: Number(process.env.EVAL_CONCURRENCY ?? 4) }, worker));
  results.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.run - b.run);
  const gate = evaluateGate(chosen, results);
  const stale = staleNotes((index as { notes: { name: string; verify_before_use: boolean; valid_as_of: string | null }[] }).notes, today);
  const promptVersion = `rules-${[...HARD_RULES].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(16)}`;
  const md = report({ date: today, model: process.env.ANTHROPIC_MODEL ?? "default", promptVersion, cases: chosen, results, gate, stale });
  fs.mkdirSync("evals/results", { recursive: true });
  fs.writeFileSync(`evals/results/eval-${today}-${scope}.md`, md); fs.writeFileSync(`evals/results/eval-${today}-${scope}.json`, JSON.stringify({ gate, stale, results }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.split("\n## ")[0] + "\n");
  console.log(md); // the whole report, so the failures can be read in the job log
  expect(gate.criticalFailures).toEqual([]); // a single critical failure blocks the release
}, 3_600_000);
