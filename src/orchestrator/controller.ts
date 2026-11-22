import { FLOW, SLOT_DEFS } from "./flow.generated";
import { isSet, pathOf, slotValue, type SessionState } from "./state";
import type { Stage } from "@/retrieval";

type Json = Record<string, any>;
const STAGES = FLOW.stages as unknown as Json[];
export const STAGE_ORDER: Stage[] = ["route", "intake", "position", "interests", "market", "numbers", "strategy", "scripts", "brief"];
export const SIDEBAR: Record<string, string> = Object.fromEntries(STAGES.filter((s) => s.sidebar).map((s) => [s.id, s.sidebar]));
SIDEBAR.debrief = "After the meeting";
export const QUESTIONS_PER_TURN: number = (FLOW.limits as Json).questions_per_turn;
export const sidebarStep = (stage: Stage): string => SIDEBAR[stage] ?? "Brief";

/** Outputs each stage produces by running a tool; the stage is done only when they exist (a skip or "no data found" also counts). */
const STAGE_OUTPUT: Partial<Record<Stage, string>> = { market: "market_range", numbers: "numbers", scripts: "scripts", brief: "brief" };
/** The value a skipped question holds (Slot-Definitions, "Skipping"). It counts as answered. */
export const SKIPPED = "unknown";

const def = (id: string) => STAGES.find((s) => s.id === id)!;
/** Required slots for a stage in the current state (path and phase aware). Order is the order the flow lists them. */
export function requiredFor(stage: Stage, s: SessionState): string[] {
  const st = def(stage); const path = pathOf(s); const out: string[] = [];
  const add = (l?: string[]) => l?.forEach((x) => !out.includes(x) && out.push(x));
  add(st.requires); add(st.requires_all);
  // conditional requirements, e.g. "negotiate_scope=package": [package_issues]
  for (const [cond, ids] of Object.entries((st.requires_if ?? {}) as Record<string, string[]>)) {
    const [slot, want] = cond.split("="); if (String(slotValue(s, slot!) ?? "").toLowerCase() === want) add(ids);
  }
  const byPath = st.requires_by_path?.[path ?? ""];
  if (stage === "intake" && byPath) {
    add(byPath.always);
    const phase = path === "A" ? slotValue<string>(s, "a_phase") : undefined;
    if (phase) add(byPath[phase]);
  } else if (stage === "position" && byPath) {
    const phase = path === "A" ? slotValue<string>(s, "a_phase") : undefined;
    add(byPath.requires); if (phase) add(byPath[phase]?.requires);
  } else if (Array.isArray(byPath)) add(byPath);
  return out;
}
export interface Gate { met: boolean; missing: string[] }
export function gate(stage: Stage, s: SessionState): Gate {
  if (stage !== "route" && !pathOf(s)) return { met: false, missing: ["path"] };
  const missing = requiredFor(stage, s).filter((id) => !isSet(s, id));
  return { met: missing.length === 0, missing };
}
const tierOf = (id: string, s: SessionState): number => { const t = SLOT_DEFS[id]?.tier; return typeof t === "number" ? t : t?.[pathOf(s) ?? "A"] ?? 2; };

export type Tool = "researcher" | "numbers_engine" | "script_writer" | "offer_analyzer" | "evidence_builder";
export interface WorkPlan {
  stage: Stage;
  /** At most two slots to ask for now, in tier order (rule 5). */
  ask: string[];
  /** All missing required slots for this stage. */
  missing: string[];
  /** A tool to run now: the stage's gate is met and its output does not exist yet. */
  runTool?: Tool;
}
/** The first stage that is not finished decides what happens next. */
export function workPlan(s: SessionState): WorkPlan {
  for (const stage of STAGE_ORDER) {
    const g = gate(stage, s);
    let missing = g.missing;
    // the user's own view (BATNA, target, walk-away) comes before any market figure
    if (g.met && def(stage).asks_first && !(STAGE_OUTPUT[stage]! in s.outputs)) missing = (def(stage).asks_first as string[]).filter((id) => !isSet(s, id));
    if (missing.length) {
      const ranked = [...missing].sort((a, b) => tierOf(a, s) - tierOf(b, s));
      return { stage, ask: ranked.slice(0, QUESTIONS_PER_TURN), missing };
    }
    const out = STAGE_OUTPUT[stage];
    if (stage === "position") {
      const tool = def("position").requires_by_path?.[pathOf(s) ?? ""]?.tool as Tool | undefined;
      const outKey = pathOf(s) === "A" ? "offer_analysis" : "evidence_summary";
      const needsTool = pathOf(s) === "B" || slotValue(s, "a_phase") === "offer_received";
      if (tool && needsTool && !s.outputs[outKey]) return { stage, ask: [], missing: [], runTool: tool };
      continue;
    }
    if (out && !(out in s.outputs) && !(out === "market_range" && isSet(s, "market_range"))) {
      return { stage, ask: [], missing: [], runTool: ({ market: "researcher", numbers: "numbers_engine", scripts: "script_writer" } as Record<string, Tool>)[stage] };
    }
    // after the tool: what the user decides from its result (e.g. the first offer from the engine's options)
    const after = ((def(stage).after_tool ?? []) as string[]).filter((id) => !isSet(s, id) && !(s.outputs[out ?? ""] as { skipped?: boolean } | undefined)?.skipped);
    if (after.length) return { stage, ask: after.slice(0, QUESTIONS_PER_TURN), missing: after };
  }
  return { stage: "brief", ask: [], missing: [] };
}

/** Rule 7: target, anchor and walk-away figures may be produced only once the numbers gate is met. */
export const numbersGateOpen = (s: SessionState): boolean => gate("numbers", s).met;

/** Modifiers whose trigger can be read from slots (Flow-Overview YAML). The others are set by the extractor. */
export function detectModifiers(s: SessionState): string[] {
  const out = new Set(s.modifiers);
  const others = slotValue<unknown[]>(s, "other_offers");
  if (Array.isArray(others) && others.length > 0) out.add("competing_offer");
  if (slotValue(s, "b_situation") === "counter_to_external_offer") out.add("counteroffer_from_employer");
  const ask = slotValue<string | string[]>(s, "ask_type");
  if ((Array.isArray(ask) ? ask.join(" ") : ask ?? "").match(/promotion|title|befordran|titel/i)) out.add("promotion_or_title");
  const years = slotValue<number>(s, "experience_years");
  if (typeof years === "number" && years <= 2) out.add("first_job_or_graduate");
  if (String(slotValue(s, "employer_type") ?? "").match(/public|offentlig|kommun|region|stat/i)) out.add("fixed_scale");
  if (slotValue(s, "collective_agreement") === true && String(slotValue(s, "pay_pool_norm") ?? "").match(/low|fixed|låg|fast/i)) out.add("fixed_scale");
  return [...out];
}

export const STAGE_GOAL: Record<string, string> = {
  route: "Decide path A (new job) or B (current job). Confirm in one line if the first message makes it obvious.",
  intake: "Capture the situation and the basic facts. Conversational: one short acknowledgement of what you learned, then the next question.",
  position: "A: understand the offer or the salary question. B: build the evidence case from the user's real achievements; never invent items.",
  market: "Estimate a market range with confidence, sources and date. Ask for the user's own target, walk-away and alternative first.",
  numbers: "Present the numbers engine's results: table, reasoning in two or three lines, confidence. The user sets the final numbers.",
  strategy: "Levers, trade-offs, sequencing, counterpart view and concessions. Offer two or three options with a recommendation.",
  scripts: "Opening, ask, responses to objections and close, in the user's channel and language, using only approved numbers.",
  brief: "Produce the final prep brief with a next step and the session summary.",
  debrief: "After the meeting: what happened and what to do next.",
};
