// Eval harness (Eval-Method): runs the written cases through the real turn loop and grades each reply.
// Rule checks are code; judge checks are a separate model call; human checks are collected into a sheet.
import { runTurn, newState, setSlot, workPlan, slotValue, STAGE_ORDER, type ChatModel, type SessionState, type TurnResult } from "@/orchestrator";
import { runNumbersTool } from "@/orchestrator/tools";
import { runOfferTool } from "@/orchestrator/offer";
import { parseExtraction } from "@/orchestrator/extract";
import type { MarketRange } from "@/orchestrator/tools";

export interface EvalCase {
  id: string; name: string; file: string; tests: string[]; setup: string; input: string; message: string | null;
  must: string[]; mustNot: string[]; check: string; severity: "critical" | "major" | "minor"; judge: boolean; human: boolean;
}
export type TargetStage = "route" | "intake" | "position" | "market" | "numbers" | "strategy" | "scripts" | "brief";
export interface Setup { slots: Record<string, { value: unknown; unit?: string }>; researcher: "none" | MarketRange | null; message: string; language: "en" | "sv"; stage: TargetStage }
export interface Verdict { item: string; pass: boolean; reason: string }
export interface RunResult {
  caseId: string; run: number; reply: string; usedFallback: boolean;
  rule: { ok: boolean; failures: string[] };
  judge?: { ok: boolean; must: Verdict[]; mustNot: Verdict[]; error?: string };
  needsHuman: boolean; pass: boolean; notes: string[]; error?: string;
}

/** How many times each case runs: critical five times (a single failure counts), major twice, minor once (Eval-Method). */
export const REPEATS = { critical: 5, major: 2, minor: 1 } as const;

const parseJson = (t: string): any => { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; } };

export const SETUP_SYSTEM = `You prepare a test state for a salary-negotiation coaching chatbot (Sweden). You are given a written test setup and the test's input. Output ONLY one JSON object:
{"slots":{"<slot_id>":{"value":<value>,"unit":"<optional>"}},"researcher":null|"none"|{"p25":n,"median":n,"p75":n,"confidence":"low|medium|high","averageOnly":false},"stage":"route|intake|position|market|numbers|strategy|scripts|brief","message":"<the user's message to send>","language":"en|sv"}
Rules: use only facts the setup states, never invent facts beyond what is needed. Slot ids: path (A|B), a_phase (pre_offer|offer_received), b_situation (annual_review|mid_year_raise|promotion_or_role_change|counter_to_external_offer), role_title, experience_years, industry, employer_type, location, work_mode, employment_terms, offer_base, offer_variable, offer_pension, offer_vacation, offer_benefits, offer_equity, offer_deadline, current_base, own_target, walk_away, batna, priorities, counterpart, channel, risk_tolerance, comfort_level, collective_agreement, other_offers, achievements, scope_change, last_raise, ask_type, review_date. Money is SEK, monthly gross. "researcher": "none" if the setup says there is no researcher data; a range object if the setup describes data (for "only an average" use {"median":n,"averageOnly":true,"confidence":"low"}; for thin data use a wide range with confidence "low"; invent plausible test figures only when the setup asks for data); otherwise null. "stage": the stage of the conversation the coach is in when it replies, which is the stage the test is about: use "route" for a fresh opening or a question that needs no state, "intake" when basic facts are still being collected, "position" for the offer or the evidence, "market" when the market range is shown or discussed, "numbers" when target, anchor and walk-away figures are worked out, "strategy", "scripts" or "brief" accordingly. Read the test name and its must items to decide, for example items about a market range mean "market". "message": if the input is a quoted user message use it exactly; if it is a pasted document, write that document as the user would paste it; if the input describes a coach stage with no user message (for example "(market stage)"), write a short neutral user message that moves the conversation on, such as "Please continue." or "Go on." Output no prose.`;

const STAGES: TargetStage[] = ["route", "intake", "position", "market", "numbers", "strategy", "scripts", "brief"];
export async function interpretSetup(model: ChatModel, c: EvalCase): Promise<Setup> {
  const quoted = c.message ?? null;
  const reply = await model.complete({ purpose: "extract", system: SETUP_SYSTEM, messages: [{ role: "user", content: `Test: ${c.id} ${c.name}\nSetup: ${c.setup || "(none: a fresh session)"}\nInput: ${c.input}${quoted ? `\nExact user message: ${quoted}` : ""}\nThe reply is graded on these must items: ${c.must.join("; ")}` }] });
  const j = parseJson(reply) ?? {};
  const slots = parseExtraction(JSON.stringify({ slots: j.slots ?? {}, modifiers: [] })).slots;
  const message = quoted ?? (typeof j.message === "string" && j.message.trim() ? j.message.trim() : "Please continue.");
  const researcher = j.researcher === "none" ? "none" : j.researcher && typeof j.researcher === "object" ? (j.researcher as MarketRange) : null;
  const stage = STAGES.includes(j.stage) ? (j.stage as TargetStage) : "route";
  return { slots, researcher, message, language: j.language === "sv" ? "sv" : "en", stage };
}

/** Neutral answers for steps before the stage a case tests. They only fill what the setup left open, and never touch the figures a case sets. */
const FILL: Record<string, unknown> = {
  path: "A", a_phase: "offer_received", b_situation: "annual_review", role_title: "Backend developer", experience_years: 4, industry: "Software", employer_type: "private company", location: "Stockholm", work_mode: "hybrid",
  employment_terms: "permanent, full-time", collective_agreement: "none", offer_base: 55000, offer_variable: "none", offer_pension: { agreement: "ITP1" }, offer_vacation: 25, offer_benefits: "none", offer_deadline: "2026-12-12",
  process_stage: "second interview", salary_question_type: "expectations form", current_base: 52000, review_date: "2026-12-10", achievements: ["Led a migration that cut costs", "Mentored two new colleagues"], scope_change: "larger responsibility",
  last_raise: "2025-01", ask_type: "raise", manager_stance: "open to it", budget_timing: "next budget round in January", own_target: 62000, walk_away: 55000, batna: 52000, priorities: ["base salary", "pension", "flexibility"],
  counterpart: "hiring manager and HR", risk_tolerance: "medium", stated_expectation: "none stated", process_signals: "positive", channel: "in person", weekly_hours: 40,
};
const DEFAULT_RANGE: MarketRange = { p25: 52000, median: 58000, p75: 64000, confidence: "medium", sources: ["Test source (stub)"], valid_as_of: "2026-11-22" };
/** Builds the session state for a case: the setup's own facts, then neutral answers and tool results up to the stage the case tests. */
export function prepareState(setup: Setup): SessionState {
  const s = newState(setup.language);
  for (const [id, v] of Object.entries(setup.slots)) setSlot(s, id, v.value, "user", { unit: v.unit });
  const target = STAGE_ORDER.indexOf(setup.stage);
  const wantsData = setup.stage === "market" && setup.researcher !== null;
  for (let i = 0; i < 80 && target > 0; i++) {
    const p = workPlan(s); const at = STAGE_ORDER.indexOf(p.stage);
    if (at > target) break;
    if (at === target && !(wantsData && p.ask.length)) break;
    if (p.runTool === "researcher") { const r = setup.researcher; if (r === "none") { s.outputs.market_range = { unavailable: true }; } else { const range = (r ?? DEFAULT_RANGE) as MarketRange; setSlot(s, "market_range", range, "researcher"); s.outputs.market_range = range; s.outputs.market_research = { stub: true, range }; } continue; }
    if (p.runTool === "numbers_engine") { const n = runNumbersTool(s); if (!("needs" in n)) s.outputs.numbers = n; else break; continue; }
    if (p.runTool === "offer_analyzer") { const o = runOfferTool(s, "2026-11-22"); if (!("needs" in o)) s.outputs.offer_analysis = o; else break; continue; }
    if (p.runTool === "evidence_builder") { s.outputs.evidence_summary = { achievements: slotValue(s, "achievements") }; continue; }
    if (p.runTool === "script_writer") { s.outputs.scripts = { parts: [], note: "test stub" }; continue; }
    const ids = p.missing.length ? p.missing : p.ask; if (!ids.length) break;
    for (const id of ids) setSlot(s, id, FILL[id] ?? "not specified", "user");
  }
  return s;
}

export const JUDGE_SYSTEM = `You grade one reply from a salary-negotiation coaching chatbot against a written test case. Be strict and literal. For every "must" item decide whether the reply does it; for every "must not" item decide whether the reply avoids it (pass = avoided). Judge only what the reply text shows. A short reason of one line per item.
Output ONLY one JSON object: {"must":[{"pass":true|false,"reason":"..."}],"must_not":[{"pass":true|false,"reason":"..."}]} with exactly one entry per item, in the order given.`;

export async function judgeReply(model: ChatModel, c: EvalCase, setup: Setup, reply: string): Promise<NonNullable<RunResult["judge"]>> {
  const user = [`Test: ${c.id} ${c.name}`, `Setup: ${c.setup || "(fresh session)"}`, `User message: ${setup.message}`, "", "Reply to grade:", reply, "", "MUST:", ...c.must.map((m, i) => `${i + 1}. ${m}`), "", "MUST NOT:", ...c.mustNot.map((m, i) => `${i + 1}. ${m}`)].join("\n");
  try {
    const ask = async () => parseJson(await model.complete({ purpose: "critic", system: JUDGE_SYSTEM, messages: [{ role: "user", content: user }] }));
    let j = await ask();
    if (!Array.isArray(j?.must) || j.must.length !== c.must.length || !Array.isArray(j?.must_not) || j.must_not.length !== c.mustNot.length) j = await ask(); // one retry when the answer does not line up with the items
    const take = (arr: unknown, items: string[]): Verdict[] | null => Array.isArray(arr) && arr.length === items.length ? items.map((item, i) => ({ item, pass: (arr[i] as any)?.pass === true, reason: String((arr[i] as any)?.reason ?? "").slice(0, 240) })) : null;
    const must = take(j?.must, c.must), mustNot = take(j?.must_not, c.mustNot);
    if (!must || !mustNot) return { ok: false, must: [], mustNot: [], error: "the judge's answer did not match the case" };
    return { ok: [...must, ...mustNot].every((v) => v.pass), must, mustNot };
  } catch (e) { return { ok: false, must: [], mustNot: [], error: "the judge did not answer" }; }
}

/** Code checks on every reply: the hard rules that code can test, and no fallback message. */
export function ruleChecks(r: Pick<TurnResult, "findings" | "usedFallback">): { ok: boolean; failures: string[] } {
  const failures = r.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.detail}`);
  if (r.usedFallback) failures.push("fallback: the reply failed the pre-send checks twice");
  return { ok: failures.length === 0, failures };
}

export interface CaseDeps { model: ChatModel; judge?: ChatModel; today?: string }
/** Runs one case once: build the state, send the message through the real turn loop, grade the reply. */
export async function runCase(c: EvalCase, run: number, deps: CaseDeps, setupCache?: Map<string, Setup>): Promise<RunResult> {
  const notes: string[] = [];
  try {
    let setup = setupCache?.get(c.id); if (!setup) { setup = await interpretSetup(deps.model, c); setupCache?.set(c.id, setup); }
    const s: SessionState = prepareState(setup);
    const researcher = async () => (setup.researcher && setup.researcher !== "none" ? { range: setup.researcher as MarketRange, research: { stub: true, range: setup.researcher } } : { range: null });
    const r = await runTurn({ model: deps.model, researcher, today: deps.today, allowDraft: true }, s, setup.message);
    const rule = ruleChecks(r);
    const judge = c.judge || !c.human ? await judgeReply(deps.judge ?? deps.model, c, setup, r.reply) : undefined;
    if (c.human) notes.push("needs a human reading");
    if (c.setup.toLowerCase().startsWith("after ")) notes.push("this setup follows another case; it ran from a fresh state with the setup text only");
    return { caseId: c.id, run, reply: r.reply, usedFallback: r.usedFallback, rule, judge, needsHuman: c.human, pass: rule.ok && (judge ? judge.ok : true), notes };
  } catch (e) {
    return { caseId: c.id, run, reply: "", usedFallback: false, rule: { ok: false, failures: ["the case could not run"] }, needsHuman: c.human, pass: false, notes, error: e instanceof Error ? e.message.slice(0, 200) : "error" };
  }
}

export interface Gate { pass: boolean; criticalFailures: string[]; majorFailures: string[]; minorFailures: string[]; pendingHuman: string[]; errors: string[] }
/** Release gate (Eval-Method): all critical runs pass; no major case fails on both of its runs; minor failures and human reviews are reported. */
export function evaluateGate(cases: EvalCase[], results: RunResult[]): Gate {
  const byCase = new Map<string, RunResult[]>(); for (const r of results) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r]);
  const g: Gate = { pass: true, criticalFailures: [], majorFailures: [], minorFailures: [], pendingHuman: [], errors: [] };
  for (const c of cases) {
    const rs = byCase.get(c.id) ?? [];
    if (!rs.length) continue;
    if (rs.some((r) => r.error)) g.errors.push(c.id);
    const fails = rs.filter((r) => !r.pass).length;
    if (c.severity === "critical" && fails > 0) g.criticalFailures.push(`${c.id} (${fails}/${rs.length})`);
    if (c.severity === "major" && rs.length > 1 && fails === rs.length) g.majorFailures.push(c.id);
    if (c.severity === "major" && rs.length === 1 && fails === 1) g.majorFailures.push(`${c.id} (single run, re-run)`);
    if (c.severity === "minor" && fails > 0) g.minorFailures.push(c.id);
    if (c.human && rs.some((r) => r.needsHuman)) g.pendingHuman.push(c.id);
  }
  g.pass = g.criticalFailures.length === 0 && g.majorFailures.length === 0 && g.errors.length === 0;
  return g;
}

/** Static release checks that need no model: Sweden notes that must be verified before use must not be stale. */
export function staleNotes(notes: { name: string; verify_before_use: boolean; valid_as_of: string | null }[], today: string, maxDays = 180): string[] {
  const limit = new Date(today).getTime() - maxDays * 86_400_000;
  return notes.filter((n) => n.verify_before_use && (!n.valid_as_of || new Date(n.valid_as_of).getTime() < limit)).map((n) => n.name);
}

/** Markdown report: one table, then every failure with the reply and the judge's reasons, then the human-review sheet. */
export function report(o: { date: string; model: string; promptVersion: string; cases: EvalCase[]; results: RunResult[]; gate: Gate; stale: string[] }): string {
  const L: string[] = [];
  L.push(`# Eval run ${o.date}`, "", `Model: ${o.model} · prompt version: ${o.promptVersion} · runs: ${o.results.length} · cases: ${new Set(o.results.map((r) => r.caseId)).size}`, "");
  L.push(`**Release gate: ${o.gate.pass && !o.stale.length ? "PASS" : "FAIL"}**`, "");
  L.push(`- Critical failures: ${o.gate.criticalFailures.length ? o.gate.criticalFailures.join(", ") : "none"}`, `- Major failures (failed every run): ${o.gate.majorFailures.length ? o.gate.majorFailures.join(", ") : "none"}`, `- Minor failures: ${o.gate.minorFailures.length ? o.gate.minorFailures.join(", ") : "none"}`, `- Cases that could not run: ${o.gate.errors.length ? o.gate.errors.join(", ") : "none"}`, `- Notes past the review window: ${o.stale.length ? o.stale.join(", ") : "none"}`, `- Waiting for a human reading: ${o.gate.pendingHuman.length ? o.gate.pendingHuman.join(", ") : "none"}`, "");
  L.push("| Case | Severity | Runs | Passed |", "|---|---|---|---|");
  for (const c of o.cases) { const rs = o.results.filter((r) => r.caseId === c.id); if (rs.length) L.push(`| ${c.id} ${c.name} | ${c.severity} | ${rs.length} | ${rs.filter((r) => r.pass).length} |`); }
  const failed = o.results.filter((r) => !r.pass);
  if (failed.length) { L.push("", "## Failures", ""); for (const r of failed) { const c = o.cases.find((x) => x.id === r.caseId)!; L.push(`### ${c.id} ${c.name} (run ${r.run}, ${c.severity})`, ""); if (r.error) L.push(`Error: ${r.error}`); for (const f of r.rule.failures) L.push(`- Rule: ${f}`); for (const v of [...(r.judge?.must ?? []), ...(r.judge?.mustNot ?? [])]) if (!v.pass) L.push(`- Judge: "${v.item}": ${v.reason}`); if (r.judge?.error) L.push(`- Judge: ${r.judge.error}`); L.push("", "Reply:", "", ...r.reply.split("\n").map((l) => "> " + l), ""); } }
  const human = o.cases.filter((c) => c.human && o.results.some((r) => r.caseId === c.id));
  if (human.length) { L.push("", "## For a human reading", ""); for (const c of human) { const r = o.results.find((x) => x.caseId === c.id)!; L.push(`### ${c.id} ${c.name}`, "", `Must: ${c.must.join("; ")}`, `Must not: ${c.mustNot.join("; ")}`, "", "Reply:", "", ...r.reply.split("\n").map((l) => "> " + l), ""); } }
  return L.join("\n");
}
