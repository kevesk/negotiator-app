import { retrieve, renderForPrompt, type Retrieved } from "@/retrieval";
import { preSend, FALLBACK, allowedValues, type Finding } from "@/checks";
import { buildSystemPrompt } from "@/agents/prompt";
import { clone, setSlot, slotValue, type SessionState } from "./state";
import { detectModifiers, numbersGateOpen, sidebarStep, STAGE_GOAL, workPlan, type Tool, type WorkPlan } from "./controller";
import { extractSlots, applyExtraction } from "./extract";
import { fromSummary } from "./summary";
import { runNumbersTool, type MarketRange } from "./tools";
import { runOfferTool } from "./offer";
import { runScriptTool } from "./scripts";
import { reviewBrief, FINDING_LABEL, type CriticReport } from "@/agents/critic";
import { PREP_BRIEF_TEMPLATE, PREP_BRIEF_ADDITIONS, SCRIPT_BLOCK_TEMPLATE as SCRIPT_FORMAT } from "@/agents/templates.generated";
import { SLOT_DEFS } from "./flow.generated";
import type { ChatModel } from "./model";
import { COACH_STYLE, OUTPUT_FORMAT, splitTrailer, finalSuggestions, nextStepText } from "./guide";

export interface TurnDeps {
  model: ChatModel;
  /** Live market research. `range` is null when no figure was found; `research` is the full structured result for the coach. */
  researcher?: (s: SessionState) => Promise<{ range: MarketRange | null; research?: unknown } | null>;
  /** Other prompt-step tools (offer analyzer, evidence builder, script writer) as they are built. */
  tools?: Partial<Record<Tool, (s: SessionState) => Promise<unknown>>>;
  /** Review the final brief with the Critic (default on). */
  critic?: boolean;
  /** Development: draft notes allowed. Release: false. */
  allowDraft?: boolean;
  today?: string;
}
export interface TurnResult {
  reply: string; state: SessionState; plan: WorkPlan; sidebar: string;
  /** What the user should do next (code-owned) and exactly three tap-to-send answers. */
  next: string; suggestions: string[];
  /** True when this reply is the first final brief (the app then shows copy, PDF and the usefulness question). */
  isBrief: boolean;
  findings: Finding[]; usedFallback: boolean; retrieved: Retrieved[];
  /** Test diagnostics only: the draft and the errors when the reply was replaced by the fallback. Never sent to the browser. */
  rejected?: { draft: string; errors: string[] };
}

const MAX_NOTES_SEEN = 40;

function stateSummary(s: SessionState): string {
  const rows = Object.entries(s.slots).filter(([, v]) => !v.stale).map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}${v.unit ? " " + v.unit : ""} [${v.source}]${v.note ? " (" + v.note + ")" : ""}`);
  const stale = Object.entries(s.slots).filter(([, v]) => v.stale).map(([k]) => k);
  return [rows.length ? rows.join("\n") : "(nothing collected yet)", stale.length ? `Needs confirmation before use: ${stale.join(", ")}` : ""].filter(Boolean).join("\n");
}

/** One turn of the conversation (Coach-Orchestrator-Spec: The turn loop). The code owns state, gates and checks; the model owns the wording. */
export async function runTurn(deps: TurnDeps, prev: SessionState, message: string): Promise<TurnResult> {
  const s = clone(prev);
  s.turn += 1; s.userTexts.push(message);

  // a pasted session summary is read as user data; time-sensitive items are confirmed with the user
  let confirm: string[] = [];
  if (message.includes("SESSION SUMMARY v1")) { const r0 = fromSummary(message, s); confirm = r0.confirm; if (!r0.ok) s.userTexts.push("(the pasted summary could not be read)"); }
  // 1-2. update the state from the message; changed slots invalidate their dependants
  let plan = workPlan(s);
  const ext = await extractSlots(deps.model, s, message, plan.missing);
  applyExtraction(s, ext);
  s.modifiers = detectModifiers(s);
  plan = workPlan(s);

  // 3-4. run the stage's tool if its gate is met
  const tool = plan.runTool;
  if (tool === "researcher") {
    const res = deps.researcher ? await deps.researcher(s).catch(() => null) : null;
    if (res?.research) s.outputs.market_research = res.research; // facts, sources, caveats and gaps for the coach
    if (res?.range) { setSlot(s, "market_range", res.range, "researcher"); s.outputs.market_range = res.range; }
    else s.outputs.market_range = { unavailable: true }; // the coach asks the user for a range or their own data instead
  } else if (tool === "numbers_engine") {
    const r = runNumbersTool(s); if (!("needs" in r)) s.outputs.numbers = r;
  } else if (tool === "offer_analyzer" && !deps.tools?.offer_analyzer) {
    const r = runOfferTool(s, deps.today);
    if (!("needs" in r)) { s.outputs.offer_analysis = r; setSlot(s, "total_comp_offer", { cash_subtotal: r.cash_subtotal, parts: r.parts.length }, "computed"); if (r.offers_comparison) setSlot(s, "offer_comparison", { columns: r.offers_comparison.columns }, "computed"); }
  } else if (tool === "script_writer" && !deps.tools?.script_writer) {
    s.outputs.scripts = await runScriptTool(s, deps.model, deps.today, deps.allowDraft ?? true);
  } else if (tool) {
    const run = deps.tools?.[tool]; const key = tool === "script_writer" ? "scripts" : tool === "offer_analyzer" ? "offer_analysis" : "evidence_summary";
    s.outputs[key] = run ? await run(s).catch(() => ({ failed: true })) : { notBuilt: true };
  }
  plan = workPlan(s);
  s.stage = plan.stage;

  // 5. retrieve notes for the stage and active modifiers
  const query = [message, STAGE_GOAL[plan.stage], plan.ask.join(" ")].join(" ");
  const r = retrieve(query, { agent: "coach", path: slotValue<"A" | "B">(s, "path") ?? "A", stage: plan.stage, modifiers: s.modifiers, allowDraft: deps.allowDraft ?? true, today: deps.today });
  for (const i of r.items) if (!s.notesUsed.includes(i.note)) s.notesUsed.push(i.note);
  if (s.notesUsed.length > MAX_NOTES_SEEN) s.notesUsed = s.notesUsed.slice(-MAX_NOTES_SEEN);

  // 6. assemble the prompt and draft
  const asks = plan.ask.map((id) => `- ${id}${SLOT_DEFS[id]?.ask ? `: e.g. "${SLOT_DEFS[id]!.ask}"` : ""}`).join("\n");
  const system = [
    buildSystemPrompt({ lang: s.language, path: slotValue(s, "path"), stage: plan.stage, modifiers: s.modifiers }),
    "", COACH_STYLE, "", OUTPUT_FORMAT, "", `Stage goal: ${STAGE_GOAL[plan.stage]}`,
    plan.ask.length ? `Ask for these now, and nothing else (at most two questions):\n${asks}` : "Do not ask for anything new: present the results below and end with a next step.",
    confirm.length ? `\nThe user pasted a session summary. Briefly confirm these time-sensitive items before relying on them: ${confirm.join(", ")}.` : "",
    "", "What you know so far:", stateSummary(s),
    Object.keys(s.outputs).length ? `\nTool results (the only source for computed figures):\n${JSON.stringify(s.outputs)}` : "",
    s.outputs.offer_analysis ? "\nOffer analysis is ready (tool results, offer_analysis). Present it as a table of parts beside base pay and never as one total value: cash subtotal, then pension, vacation, benefits, equity and terms, each with its tag and whether it is an estimate. Say plainly which parts are unknown and what to ask the employer, name the red flags in plain words, and if offers_comparison exists, show that side-by-side table (one column per offer, the current job as a cash-only column) and note which has the highest guaranteed cash as a proposal only; if a comparison with the current job exists, propose the stronger alternative as the fallback option (BATNA) and ask the user to confirm before it is used." : "",
    s.outputs.scripts && plan.stage === "scripts" ? "\nScripts are in the tool results (scripts). Present them for the user's channel and language, formatted like this script block, each with its goal, the text, the tone and what to say if they reply with the likely objection:\n" + SCRIPT_FORMAT + "\nIf provisional is true, list the assumptions. The user edits and sends them; never say anything was sent. If scripts.failed is true, say plainly that the wording could not be made safely and offer to try again. Use only the figures in the scripts." : "",
    plan.stage === "brief" ? "\nWrite the final prep brief now, in the user's language, using exactly this template. Fill every field from the facts and tool results; write unknown where a fact is missing; no placeholder may remain; keep the headings and their numbers; 500 to 800 words in total, concise and straight to the point, short sentences, no fluff, no filler, no repetition between sections; put the scripts from the tool results into section 5; end with the checklist, the assumptions, the line of concepts used and the preparation-support line.\n\n" + PREP_BRIEF_TEMPLATE + "\n\nPath additions: " + PREP_BRIEF_ADDITIONS : "",
    s.outputs.market_range && (s.outputs.market_range as { unavailable?: boolean }).unavailable ? "\nNo market data could be found. Say so plainly and ask the user for their own evidence (job ads with pay ranges, union statistics, colleagues' experience)." : "",
    r.items.length ? `\nNotes you may use:\n${renderForPrompt(r.items)}` : "\nNo relevant notes were found: if you answer without backing, label it as a guess (rule 6).",
  ].filter((x) => x !== "").join("\n");
  const messages = [...s.messages, { role: "user" as const, content: message }];
  let raw = await deps.model.complete({ purpose: "reply", system, messages });
  let { body: draft, suggestions: offered } = splitTrailer(raw);

  // 7. pre-send checks: revise once, then send the safest version
  const sources = [...s.userTexts, ...r.items.map((i) => i.text), JSON.stringify(s.outputs), ...Object.values(s.slots).filter((v) => !v.stale).map((v) => JSON.stringify(v.value))];
  const ctx = { stage: plan.stage, sources, numbersGateOpen: numbersGateOpen(s), userNumbers: [...allowedValues(s.userTexts)] };
  let check = preSend(draft, ctx); let usedFallback = false; let rejected: TurnResult["rejected"];
  if (!check.ok) {
    const fix = check.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.detail}`).join("; ");
    raw = await deps.model.complete({ purpose: "rewrite", system, messages: [...messages, { role: "assistant", content: raw }, { role: "user", content: `Rewrite your last reply so it fixes this and changes nothing else: ${fix}. Output only the new reply, followed by the suggestions block.` }] });
    ({ body: draft, suggestions: offered } = splitTrailer(raw));
    check = preSend(draft, ctx);
    if (!check.ok) { rejected = { draft, errors: check.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.detail}`) }; s.failures.push(...check.findings.filter((f) => f.severity === "error").map((f) => f.rule)); draft = FALLBACK[s.language]; offered = []; usedFallback = true; }
  }
  // the Critic reviews the final brief once, in its own context; must-fix and should-fix items are fixed once, then anything left is stated openly
  if (plan.stage === "brief" && !usedFallback && deps.critic !== false && !prev.outputs.brief) {
    const n = (id: string) => { const v = slotValue<unknown>(s, id); return typeof v === "number" ? v : undefined; };
    const ctxFor = (text: string) => ({ lang: s.language, brief: text, state: stateSummary(s), outputs: JSON.stringify(s.outputs), walkAway: n("walk_away"), target: n("own_target"), batna: n("batna"), sources });
    let report: CriticReport = await reviewBrief(deps.model, ctxFor(draft));
    const fixable = report.findings.filter((f) => f.severity !== "note");
    if (fixable.length) {
      const list = fixable.map((f) => `- ${f.id} (${f.where}): ${f.what}. ${f.suggested_fix}`).join("\n");
      const rawFix = await deps.model.complete({ purpose: "rewrite", system, messages: [...messages, { role: "assistant", content: raw }, { role: "user", content: `A reviewer found these problems in your brief. Fix them and change nothing else, keeping the template. Output only the new brief, followed by the suggestions block.\n${list}` }] });
      const fixed = splitTrailer(rawFix);
      if (fixed.body && preSend(fixed.body, ctx).ok) { draft = fixed.body; offered = fixed.suggestions; report = await reviewBrief(deps.model, ctxFor(draft)); }
    }
    const open = report.findings.filter((f) => f.severity === "must_fix");
    if (open.length) {
      s.failures.push(...open.map((f) => `critic:${f.id}`));
      const labels = [...new Set(open.map((f) => FINDING_LABEL[s.language][f.id]))].join("; ");
      draft += s.language === "sv" ? `\n\n**Öppna punkter i det här underlaget:** granskningen hittade saker som inte är helt klara (${labels}). Kontrollera dem innan du förlitar dig på det.` : `\n\n**Open points in this brief:** the review found things that are not fully settled (${labels}). Check them before you rely on the brief.`;
    }
    s.outputs.critic_report = { verdict: report.verdict, checks_failed: report.checks_failed };
  }
  if (plan.stage === "brief" && !usedFallback) s.outputs.brief = true;

  // the suggestions go through the same checks as the reply; anything that fails is replaced by safe defaults
  const suggestions = finalSuggestions(offered, plan.stage, s.language, (t) => preSend(t, ctx).ok, s.userTexts.join(" "));
  const next = nextStepText(plan.stage, slotValue<"A" | "B">(s, "path"), s.language);

  // 8. record the exchange
  s.messages.push({ role: "user", content: message }, { role: "assistant", content: draft });
  return { reply: draft, state: s, plan, sidebar: sidebarStep(plan.stage), next, suggestions, isBrief: plan.stage === "brief" && !usedFallback && !prev.outputs.brief, rejected, findings: check.findings, usedFallback, retrieved: r.items };
}
