import { retrieve, renderForPrompt, type Retrieved } from "@/retrieval";
import { preSend, FALLBACK, allowedValues, type Finding } from "@/checks";
import { stableSystemPrompt, stateLine } from "@/agents/prompt";
import { clone, setSlot, slotValue, type SessionState } from "./state";
import { detectModifiers, numbersGateOpen, sidebarStep, STAGE_GOAL, workPlan, SKIPPED, type Tool, type WorkPlan } from "./controller";
import type { Stage } from "@/retrieval/types";
import { extractSlots, applyExtraction, type Extraction } from "./extract";
import { fromSummary } from "./summary";
import { runNumbersTool, type MarketRange } from "./tools";
import { buildPackages, weightsFromSlot, draftConcessionPlan } from "@/engine";
import { runOfferTool } from "./offer";
import { runScriptTool } from "./scripts";
import { reviewBrief, FINDING_LABEL, type CriticReport } from "@/agents/critic";
import { PREP_BRIEF_TEMPLATE, PREP_BRIEF_ADDITIONS, SCRIPT_BLOCK_TEMPLATE as SCRIPT_FORMAT } from "@/agents/templates.generated";
import { SLOT_DEFS } from "./flow.generated";
import type { ChatModel } from "./model";
import { situationCatalogue, situationGuide, isSituation } from "@/retrieval/situation";
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
  /** True when the user has ended the session. */
  finished: boolean;
  /** What a Skip tap marked as unknown this turn. */
  skipped: string[];
  /** The situation notes given in full this turn (see Retrieval-Design). */
  guides: { note: string; title: string; text: string }[];
  /** Test diagnostics only: the draft and the errors when the reply was replaced by the fallback. Never sent to the browser. */
  rejected?: { draft: string; errors: string[] };
}

const MAX_NOTES_SEEN = 40;
const SITUATION_CATALOGUE = situationCatalogue();

function stateSummary(s: SessionState): string {
  const rows = Object.entries(s.slots).filter(([, v]) => !v.stale).map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}${v.unit ? " " + v.unit : ""} [${v.source}]${v.note ? " (" + v.note + ")" : ""}`);
  const stale = Object.entries(s.slots).filter(([, v]) => v.stale).map(([k]) => k);
  return [rows.length ? rows.join("\n") : "(nothing collected yet)", stale.length ? `Needs confirmation before use: ${stale.join(", ")}` : ""].filter(Boolean).join("\n");
}

/** One turn of the conversation (Coach-Orchestrator-Spec: The turn loop). The code owns state, gates and checks; the model owns the wording. */
export interface TurnOptions { /** The user tapped Skip: the current question or step is marked unknown and the flow moves on. */ skip?: boolean }

/** Marks what the current step asks for as skipped. Returns the ids or tool steps skipped. */
export function skipStep(s: SessionState, plan: WorkPlan): string[] {
  if (plan.ask.length) { for (const id of plan.ask) setSlot(s, id, SKIPPED, "user"); return [...plan.ask]; }
  const key = ({ researcher: "market_range", numbers_engine: "numbers", script_writer: "scripts", offer_analyzer: "offer_analysis", evidence_builder: "evidence_summary" } as Record<string, string>)[plan.runTool ?? ""];
  if (key) { s.outputs[key] = { skipped: true }; return [plan.runTool!]; }
  return [];
}
/** Retrieval stages are those in the notes' frontmatter; the interests stage reads the position notes. */
const retrievalStage = (st: Stage): Stage => (st === "interests" ? "position" : st);

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export async function runTurn(deps: TurnDeps, prev: SessionState, message: string, opts: TurnOptions = {}): Promise<TurnResult> {
  const s = clone(prev);
  s.turn += 1; s.userTexts.push(message);

  // a pasted session summary is read as user data; time-sensitive items are confirmed with the user
  let confirm: string[] = [];
  if (message.includes("SESSION SUMMARY v1")) { const r0 = fromSummary(message, s); confirm = r0.confirm; if (!r0.ok) s.userTexts.push("(the pasted summary could not be read)"); }
  // 1-2. update the state from the message; changed slots invalidate their dependants
  let plan = workPlan(s);
  let skipped: string[] = [];
  const ext: Extraction = opts.skip ? { slots: {}, modifiers: [], situations: [], done: false } : await extractSlots(deps.model, s, message, plan.missing, { catalogue: SITUATION_CATALOGUE, isSituation });
  if (opts.skip) skipped = skipStep(s, plan); else applyExtraction(s, ext);
  // ending the session: only a plain "I'm done", never a message that also gives facts ("I'm happy with 51 500 kr as my first offer")
  if (ext.done && (plan.stage === "brief" || !Object.keys(ext.slots).length)) s.finished = true;
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
    else if (r.needs.every((id) => slotValue(s, id) === SKIPPED)) s.outputs.numbers = { skipped: true, missing: r.needs }; // the user skipped a figure the engine needs
  } else if (tool === "package_builder") {
    const w = slotValue<unknown>(s, "issue_weights"); const basedOn = JSON.stringify(w);
    const r = buildPackages({ weights: weightsFromSlot(w), target: num(slotValue(s, "own_target")), walkAway: num(slotValue(s, "walk_away")), lang: s.language });
    if ("needs" in r) s.outputs.package_draft = { basedOn, failed: true, needs: r.needs, builtAt: s.turn }; // too few items to build a choice from
    else { s.outputs.package_draft = { basedOn, builtAt: s.turn, ...r }; setSlot(s, "packages", r.packages.map((p) => ({ id: p.id, items: p.items.map((i) => i.text) })), "assumed"); }
  } else if (tool === "offer_analyzer" && !deps.tools?.offer_analyzer) {
    const r = runOfferTool(s, deps.today);
    if ("needs" in r && r.needs.every((id) => slotValue(s, id) === SKIPPED)) s.outputs.offer_analysis = { skipped: true, missing: r.needs };
    if (!("needs" in r)) { s.outputs.offer_analysis = r; setSlot(s, "total_comp_offer", { cash_subtotal: r.cash_subtotal, parts: r.parts.length }, "computed"); if (r.offers_comparison) setSlot(s, "offer_comparison", { columns: r.offers_comparison.columns }, "computed"); }
  } else if (tool === "script_writer" && !deps.tools?.script_writer) {
    s.outputs.scripts = await runScriptTool(s, deps.model, deps.today, deps.allowDraft ?? true);
    s.outputs.scripts_built_at = s.turn; // the turn that writes the scripts shows them; the brief comes on the next turn
  } else if (tool) {
    const run = deps.tools?.[tool]; const key = tool === "script_writer" ? "scripts" : tool === "offer_analyzer" ? "offer_analysis" : "evidence_summary";
    s.outputs[key] = run ? await run(s).catch(() => ({ failed: true })) : { notBuilt: true };
    if (tool === "script_writer") s.outputs.scripts_built_at = s.turn;
  }
  plan = workPlan(s);
  s.stage = plan.stage;
  // the three concession steps from the user's own first offer, for the saved plan (the engine's plan is drawn for the default anchor)
  { const f = num(slotValue(s, "first_offer")), t = num(slotValue(s, "own_target")), w = num(slotValue(s, "walk_away"));
    if (f !== undefined && t !== undefined && w !== undefined && f > t && t >= w) s.outputs.concession_plan = { first: f, ...draftConcessionPlan(f, t, w) }; else delete s.outputs.concession_plan; }

  // 5. retrieve notes for the stage and active modifiers
  const query = [message, STAGE_GOAL[plan.stage], plan.ask.join(" ")].join(" ");
  const r = retrieve(query, { agent: "coach", path: slotValue<"A" | "B">(s, "path") ?? "A", stage: retrievalStage(plan.stage), modifiers: s.modifiers, allowDraft: deps.allowDraft ?? true, today: deps.today });
  const rs = { agent: "coach" as const, path: slotValue<"A" | "B">(s, "path") ?? "A", stage: retrievalStage(plan.stage), modifiers: s.modifiers, allowDraft: deps.allowDraft ?? true, today: deps.today };
  const guides = ext.situations.map((n) => situationGuide(n, rs)).filter((g): g is NonNullable<typeof g> => g !== null);
  for (const g of guides) if (!s.notesUsed.includes(g.note)) s.notesUsed.push(g.note);
  for (const i of r.items) if (!s.notesUsed.includes(i.note)) s.notesUsed.push(i.note);
  if (s.notesUsed.length > MAX_NOTES_SEEN) s.notesUsed = s.notesUsed.slice(-MAX_NOTES_SEEN);

  // 6. assemble the prompt and draft
  const asks = plan.ask.map((id) => `- ${id}${SLOT_DEFS[id]?.ask ? `: e.g. "${SLOT_DEFS[id]!.ask}"` : ""}`).join("\n");
  // the part that is the same on every turn in this language goes first, so the API can cache it
  const cachePrefix = [stableSystemPrompt(s.language), "", COACH_STYLE, "", OUTPUT_FORMAT, ""].join("\n");
  const system = [
    cachePrefix + stateLine({ lang: s.language, path: slotValue(s, "path"), stage: plan.stage, modifiers: s.modifiers }),
    "", `Stage goal: ${STAGE_GOAL[plan.stage]}`,
    guides.length
      ? `Situation guidance for the user's latest message (from the knowledge base; follow it before anything else: make the moves it describes, ask the questions it says to ask, offer what it says to offer; never name the note):\n${guides.map((g) => `### ${g.title}\n${g.text}`).join("\n\n")}\n\nRespond to that situation first; its questions come before the facts listed below.`
      : "First respond to what the user just raised. If the retrieved notes describe a move for that situation (questions to ask, an exercise to offer, a check to make, a point to explain), make that move first; its questions come before the facts listed below.",
    s.finished
      ? "The user has said they are done. Close the session now: two or three short lines on what they have prepared, a clear reminder to save the summary as a PDF with the highlighted Save button, and good luck. Ask no question and give no suggestions."
      : plan.ask.length ? `Next facts to collect (ask for these now if your reply has room; at most two questions in total, and anything left waits for a later turn):\n${asks}` : "Do not ask for new facts: present the results below and end with a next step.",
    skipped.length ? `\nThe user chose to skip this (${skipped.join(", ")}). Accept it in a few words without asking it again, treat it as unknown, and move straight on to the next step.` : "",
    confirm.length ? `\nThe user pasted a session summary. Briefly confirm these time-sensitive items before relying on them: ${confirm.join(", ")}.` : "",
    "", "What you know so far:", stateSummary(s),
    Object.keys(s.outputs).length ? `\nTool results (the only source for computed figures):\n${JSON.stringify(s.outputs)}` : "",
    s.outputs.offer_analysis ? "\nOffer analysis is ready (tool results, offer_analysis). Present it as a table of parts beside base pay and never as one total value: cash subtotal, then pension, vacation, benefits, equity and terms, each figure with its source tag right after it (never a tag column) and a note when it is an estimate. Say plainly which parts are unknown and what to ask the employer, name the red flags in plain words, and if offers_comparison exists, show that side-by-side table (one column per offer, the current job as a cash-only column) and note which has the highest guaranteed cash as a proposal only; if a comparison with the current job exists, propose the stronger alternative as the fallback option (BATNA) and ask the user to confirm before it is used." : "",
    s.outputs.package_draft && !(s.outputs.package_draft as { failed?: boolean }).failed && plan.stage === "strategy" ? "\nThe packages are built (tool results, package_draft). Show them side by side in a table: one column per package, one row per item, then a row \"What it costs them\" and a row \"What their choice tells you\". Use the items and figures exactly as built and never change them. Say they are worth about the same to the user (only if sameValue is true; if it is false, say plainly that they are not exactly equal in value to the user and ask which item to adjust), and that the packages are made to be really different on purpose, so the employer has a real choice and the choice shows what they value most. Then ask two things: do the items fit what this employer can actually give, and which item the user could never give up. Do not show the points or scores." : "",
    s.outputs.package_draft && (s.outputs.package_draft as { failed?: boolean }).failed && plan.stage === "strategy" ? "\nThe packages could not be built: fewer than two items have points. Ask for one more item that matters to the user and its points. Do not write packages yourself." : "",
    s.outputs.scripts && plan.stage === "scripts" ? "\nScripts are in the tool results (scripts). Present them for the user's channel and language, formatted like this script block, each with its goal, the text, the tone and what to say if they reply with the likely objection:\n" + SCRIPT_FORMAT + "\nIf provisional is true, list the assumptions. The user edits and sends them; never say anything was sent. If scripts.failed is true, say plainly that the wording could not be made safely and offer to try again. Use only the figures in the scripts." : "",
    plan.stage === "brief" ? "\nWrite the final prep brief now, in the user's language, using exactly this template. Fill every field from the facts and tool results; write unknown where a fact is missing; no placeholder may remain; keep the headings and their numbers; 700 to 1,100 words in total, concise and straight to the point, short sentences, no fluff, no filler, no repetition between sections; put the scripts from the tool results into section 5; end with the checklist, the assumptions, the line of concepts used and the preparation-support line.\n\n" + PREP_BRIEF_TEMPLATE + "\n\nPath additions: " + PREP_BRIEF_ADDITIONS : "",
    s.outputs.market_range && (s.outputs.market_range as { unavailable?: boolean }).unavailable ? "\nNo market data could be found. Say so plainly, once. The search runs only once: never offer to search again. Offer two ways forward: the user shares their own evidence (a job ad with a pay range, union statistics), or skips and goes on to the numbers." : "",
    s.outputs.market_range && (s.outputs.market_range as { skipped?: boolean }).skipped ? "\nThe user skipped the market step: do not show or ask for market data; work from the user's own figures." : "",
    r.items.length ? `\nNotes you may use:\n${renderForPrompt(r.items)}` : "\nNo relevant notes were found: if you answer without backing, label it as a guess (rule 6).",
  ].filter((x) => x !== "").join("\n");
  const messages = [...s.messages, { role: "user" as const, content: message }];
  let raw = await deps.model.complete({ purpose: "reply", system, cachePrefix, messages });
  let { body: draft, suggestions: offered } = splitTrailer(raw);

  // 7. pre-send checks: revise once, then send the safest version
  const sources = [...s.userTexts, ...r.items.map((i) => i.text), ...guides.map((g) => g.text), JSON.stringify(s.outputs), ...Object.values(s.slots).filter((v) => !v.stale).map((v) => JSON.stringify(v.value))];
  const ctx = { stage: plan.stage, sources, numbersGateOpen: numbersGateOpen(s), userNumbers: [...allowedValues([...s.userTexts, ...Object.values(s.slots).filter((v) => v.source === "user" && !v.stale).map((v) => JSON.stringify(v.value))])] };
  let check = preSend(draft, ctx); let usedFallback = false; let rejected: TurnResult["rejected"];
  if (!check.ok) {
    const fix = check.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.detail}`).join("; ");
    raw = await deps.model.complete({ purpose: "rewrite", system, cachePrefix, messages: [...messages, { role: "assistant", content: raw }, { role: "user", content: `Rewrite your last reply so it fixes this and changes nothing else: ${fix}. Output only the new reply, followed by the suggestions block.` }] });
    ({ body: draft, suggestions: offered } = splitTrailer(raw));
    check = preSend(draft, ctx);
    const errs = check.findings.filter((f) => f.severity === "error");
    if (!check.ok && plan.stage === "brief" && errs.every((f) => f.rule === "H2")) {
      // a finished brief is not thrown away because a figure in it has no source: it is kept and the figures are named openly (a live test lost a whole brief this way)
      s.failures.push(...errs.map((f) => f.rule));
      const figs = [...new Set(errs.flatMap((f) => (f.detail.split(": ")[1] ?? "").split(", ")).map((x) => x.trim()).filter(Boolean))].slice(0, 6).join(", ");
      draft += s.language === "sv" ? `\n\n**Öppna punkter i det här underlaget:** dessa siffror kunde inte kopplas till dina uppgifter eller beräkningarna: ${figs}. Kontrollera dem innan du förlitar dig på dem.` : `\n\n**Open points in this brief:** these figures could not be tied to your inputs or the calculations: ${figs}. Check them before you rely on them.`;
    } else if (!check.ok) { rejected = { draft, errors: errs.map((f) => `${f.rule}: ${f.detail}`) }; s.failures.push(...errs.map((f) => f.rule)); draft = FALLBACK[s.language]; offered = []; usedFallback = true; }
  }
  // the Critic reviews the final brief once, in its own context; must-fix and should-fix items are fixed once, then anything left is stated openly
  if (plan.stage === "brief" && !usedFallback && deps.critic !== false && !prev.outputs.brief) {
    const n = (id: string) => { const v = slotValue<unknown>(s, id); return typeof v === "number" ? v : undefined; };
    const ctxFor = (text: string) => ({ lang: s.language, brief: text, state: stateSummary(s), outputs: JSON.stringify(s.outputs), walkAway: n("walk_away"), target: n("own_target"), batna: n("batna"), sources });
    let report: CriticReport = await reviewBrief(deps.model, ctxFor(draft));
    const fixable = report.findings.filter((f) => f.severity !== "note");
    if (fixable.length) {
      const list = fixable.map((f) => `- ${f.id} (${f.where}): ${f.what}. ${f.suggested_fix}`).join("\n");
      const rawFix = await deps.model.complete({ purpose: "rewrite", system, cachePrefix, messages: [...messages, { role: "assistant", content: raw }, { role: "user", content: `A reviewer found these problems in your brief. Fix them and change nothing else, keeping the template. Output only the new brief, followed by the suggestions block.\n${list}` }] });
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
  return { reply: draft, state: s, plan, sidebar: sidebarStep(plan.stage), next, suggestions: s.finished ? [] : suggestions, finished: s.finished === true, skipped, isBrief: plan.stage === "brief" && !usedFallback && !prev.outputs.brief, rejected, guides, findings: check.findings, usedFallback, retrieved: r.items };
}
