import { retrieve, renderForPrompt, type Retrieved } from "@/retrieval";
import { preSend, FALLBACK, allowedValues, type Finding } from "@/checks";
import { buildSystemPrompt } from "@/agents/prompt";
import { clone, setSlot, slotValue, type SessionState } from "./state";
import { detectModifiers, numbersGateOpen, sidebarStep, STAGE_GOAL, workPlan, type Tool, type WorkPlan } from "./controller";
import { extractSlots, applyExtraction } from "./extract";
import { fromSummary } from "./summary";
import { runNumbersTool, type MarketRange } from "./tools";
import { SLOT_DEFS } from "./flow.generated";
import type { ChatModel } from "./model";

export interface TurnDeps {
  model: ChatModel;
  /** Live market research (milestone 6). Returns null when nothing could be found. */
  researcher?: (s: SessionState) => Promise<MarketRange | null>;
  /** Other prompt-step tools (offer analyzer, evidence builder, script writer) as they are built. */
  tools?: Partial<Record<Tool, (s: SessionState) => Promise<unknown>>>;
  /** Development: draft notes allowed. Release: false. */
  allowDraft?: boolean;
  today?: string;
}
export interface TurnResult {
  reply: string; state: SessionState; plan: WorkPlan; sidebar: string;
  findings: Finding[]; usedFallback: boolean; retrieved: Retrieved[];
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
    const range = deps.researcher ? await deps.researcher(s).catch(() => null) : null;
    if (range) { setSlot(s, "market_range", range, "researcher"); s.outputs.market_range = range; }
    else s.outputs.market_range = { unavailable: true }; // the coach asks the user for a range or their own data instead
  } else if (tool === "numbers_engine") {
    const r = runNumbersTool(s); if (!("needs" in r)) s.outputs.numbers = r;
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
    "", `Stage goal: ${STAGE_GOAL[plan.stage]}`,
    plan.ask.length ? `Ask for these now, and nothing else (at most two questions):\n${asks}` : "Do not ask for anything new: present the results below and end with a next step.",
    confirm.length ? `\nThe user pasted a session summary. Briefly confirm these time-sensitive items before relying on them: ${confirm.join(", ")}.` : "",
    "", "What you know so far:", stateSummary(s),
    Object.keys(s.outputs).length ? `\nTool results (the only source for computed figures):\n${JSON.stringify(s.outputs)}` : "",
    s.outputs.market_range && (s.outputs.market_range as { unavailable?: boolean }).unavailable ? "\nNo market data could be found. Say so plainly and ask the user for their own evidence (job ads with pay ranges, union statistics, colleagues' experience)." : "",
    r.items.length ? `\nNotes you may use:\n${renderForPrompt(r.items)}` : "\nNo relevant notes were found: if you answer without backing, label it as a guess (rule 6).",
  ].filter((x) => x !== "").join("\n");
  const messages = [...s.messages, { role: "user" as const, content: message }];
  let draft = await deps.model.complete({ purpose: "reply", system, messages });

  // 7. pre-send checks: revise once, then send the safest version
  const sources = [...s.userTexts, ...r.items.map((i) => i.text), JSON.stringify(s.outputs), ...Object.values(s.slots).filter((v) => !v.stale).map((v) => JSON.stringify(v.value))];
  const ctx = { stage: plan.stage, sources, numbersGateOpen: numbersGateOpen(s), userNumbers: [...allowedValues(s.userTexts)] };
  let check = preSend(draft, ctx); let usedFallback = false;
  if (!check.ok) {
    const fix = check.findings.filter((f) => f.severity === "error").map((f) => `${f.rule}: ${f.detail}`).join("; ");
    draft = await deps.model.complete({ purpose: "rewrite", system, messages: [...messages, { role: "assistant", content: draft }, { role: "user", content: `Rewrite your last reply so it fixes this and changes nothing else: ${fix}. Output only the new reply.` }] });
    check = preSend(draft, ctx);
    if (!check.ok) { s.failures.push(...check.findings.filter((f) => f.severity === "error").map((f) => f.rule)); draft = FALLBACK[s.language]; usedFallback = true; }
  }
  if (plan.stage === "brief" && !usedFallback) s.outputs.brief = true;

  // 8. record the exchange
  s.messages.push({ role: "user", content: message }, { role: "assistant", content: draft });
  return { reply: draft, state: s, plan, sidebar: sidebarStep(plan.stage), findings: check.findings, usedFallback, retrieved: r.items };
}
