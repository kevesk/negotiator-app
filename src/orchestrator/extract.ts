import { FLOW, SLOT_DEFS } from "./flow.generated";
import { setSlot, type SessionState } from "./state";
import type { ChatModel } from "./model";

const MODIFIERS = Object.keys(FLOW.modifiers);
/** Slots the user may supply; derived values come from tools. A range typed in by the user is allowed (thin slice). */
const ALLOWED = new Set([...Object.keys(SLOT_DEFS).filter((id) => id !== "language"), "market_range"]);

export interface Extraction { slots: Record<string, { value: unknown; unit?: string }>; modifiers: string[]; situations: string[]; done: boolean }

const NEEDED = "Slots still needed (prefer these): ";
export function extractionPrompt(missing: string[], catalogue?: string): string {
  return [
    "Read the user's latest message and extract facts into slots. Output ONLY one JSON object, no prose:",
    '{"slots": {"<slot_id>": {"value": <value>, "unit": "<optional unit>"}}, "modifiers": ["<modifier>"], "situations": ["<note name>"], "done": false}',
    'done: true only when the user clearly says they are finished, satisfied or want to end the session (for example "thanks, that is all", "I am happy with this", "tack, det räcker"); otherwise false.',
    "Rules: use only ids from the allowed list; include a slot only if the user clearly stated it; never guess; money is SEK, monthly gross unless the user says otherwise (keep their unit in `unit`); dates are ISO; booleans for yes/no.",
    "Offer slots use these shapes. offer_base: a number (monthly gross; set unit to year or hour if they said so) or {\"amount\":n,\"period\":\"month|year|hour\",\"paid_months\":12|13}. offer_variable: {\"guaranteed_yearly\":n,\"min_yearly\":n,\"max_yearly\":n,\"description\":\"how it works\"} or \"none\". offer_pension: {\"agreement\":\"ITP1|ITP2|SAF-LO|KAP-KL|AKAP-KR|PA16\"} or {\"rate_pct\":n} or {\"monthly\":n}, or \"none\" or \"unknown\". offer_vacation: a number of days. offer_benefits: a list of short strings or \"none\". offer_equity: short text, or \"none\". offer_notice_probation: {\"probation_months\":n,\"notice_months\":n,\"non_compete\":\"text\"}. other_offers: a list of {\"employer\":\"name\",\"status\":\"offer|process\",\"package\":{same fields as the offer slots, without the offer_ prefix: base, variable, pension, vacation, benefits, equity, notice_probation}}; include a package only for a real offer with numbers. Never fill a field the user did not state.",
    'Fixed values: path is "A" (a new job, an offer or an interview process) or "B" (the job they have now); a_phase is pre_offer or offer_received; b_situation is annual_review, mid_year_raise, promotion_or_role_change or counter_to_external_offer; negotiate_scope is "salary only" or "package"; own_target, walk_away, current_base and first_offer are one number each (monthly base pay in SEK); put other parts of a target, such as remote days, in their own slots or in priorities.',
    "Extract every fact the user stated in this message, also facts that are not in the needed list (for example a target, a walk-away or an alternative given early). Keep values short.",
    `Allowed ids: ${[...ALLOWED].join(", ")}.`,
    `Allowed modifiers: ${MODIFIERS.join(", ")}.`,
    ...(catalogue ? [
      "situations: the one or two notes below that describe the situation or question the user's latest message raises (a deadline, a second offer, \"no budget\", a promotion, a Swedish rule, how much each issue matters...). Pick by meaning, not by shared words. Use [] for a plain answer to a question you asked, or when nothing fits. Names exactly as listed:",
      catalogue,
    ] : []),
    `${NEEDED}${missing.join(", ") || "none"}.`, // last: the only line that changes between turns, so the rest is cached
  ].filter(Boolean).join("\n");
}
/** Maps free wording of the fixed-value slots onto the values the flow uses; anything unclear is dropped rather than guessed. */
const MONEY = new Set(["own_target", "walk_away", "current_base", "first_offer"]);
/** A monthly amount from a number, "50 000 kr", "50k" or an object such as {base_salary: 50000, remote_days: 2}. */
export function moneyValue(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : undefined;
  if (typeof v === "string") { const m = v.replace(/\u00a0/g, " ").match(/(\d[\d ,.]*)\s*(k(?![a-zåäö])|tkr|tusen)?/i); if (!m) return undefined; const raw = m[1]!.trim(); const n = /^\d+[,.]\d{1,2}$/.test(raw) ? Number(raw.replace(",", ".")) : Number(raw.replace(/[ ,]/g, "").replace(/\.(?=\d{3}\b)/g, "")); return Number.isFinite(n) && n > 0 ? (m[2] ? n * 1000 : n) : undefined; }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const key = Object.keys(o).find((k) => /base|salary|monthly|amount|pay|lön|grund|value|month/i.test(k) && moneyValue(o[k]) !== undefined);
    if (key) return moneyValue(o[key]);
    const nums = Object.values(o).map(moneyValue).filter((x): x is number => x !== undefined && x >= 1000);
    return nums.length === 1 ? nums[0] : undefined;
  }
  return undefined;
}
export function normaliseSlot(id: string, v: unknown): unknown {
  if (MONEY.has(id)) return moneyValue(v);
  const t = typeof v === "string" ? v.trim().toLowerCase() : v;
  if (typeof t !== "string") return v;
  if (id === "path") return /^a$|offer|new job|interview|erbjudande|nytt jobb|intervju|rekryter/.test(t) ? "A" : /^b$|current|raise|review|now|existing|nuvarande|löneöversyn|lönesamtal|höjning|befintlig/.test(t) ? "B" : undefined;
  if (id === "negotiate_scope") return /package|paket|whole|helhet/.test(t) ? "package" : /salary|lön|pay|only|bara/.test(t) ? "salary only" : v;
  if (id === "a_phase") return /received|got|have an offer|fått|mottag|offer_received/.test(t) ? "offer_received" : /pre|interview|before|innan|intervju|pre_offer/.test(t) ? "pre_offer" : v;
  if (id === "b_situation") return /counter|external|other offer|annat erbjudande|motbud/.test(t) ? "counter_to_external_offer" : /promot|role change|befordr|ny roll/.test(t) ? "promotion_or_role_change" : /mid|mitt/.test(t) ? "mid_year_raise" : /annual|review|yearly|årlig|lönerevision|löneöversyn|lönesamtal/.test(t) ? "annual_review" : v;
  return v;
}
/** Parses a model's extraction reply defensively: anything unusable is dropped, never guessed. */
export function parseExtraction(text: string, isSituation: (name: string) => boolean = () => false): Extraction {
  const out: Extraction = { slots: {}, modifiers: [], situations: [], done: false };
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b <= a) return out;
  let j: any; try { j = JSON.parse(text.slice(a, b + 1)); } catch { return out; }
  if (j && typeof j.slots === "object" && j.slots) for (const [id, v] of Object.entries<any>(j.slots)) {
    if (!ALLOWED.has(id) || v === null || typeof v !== "object" || !("value" in v) || v.value === null || v.value === undefined || v.value === "") continue;
    const value = normaliseSlot(id, v.value); if (value === undefined) continue;
    out.slots[id] = { value, unit: typeof v.unit === "string" ? v.unit : undefined };
  }
  if (Array.isArray(j?.modifiers)) out.modifiers = j.modifiers.filter((m: unknown) => typeof m === "string" && MODIFIERS.includes(m));
  out.done = j?.done === true;
  if (Array.isArray(j?.situations)) out.situations = [...new Set((j.situations as unknown[]).filter((m): m is string => typeof m === "string" && isSituation(m)))].slice(0, 2);
  return out;
}
/** Applies an extraction to the state as `[user]` data. Returns the ids that changed. */
export function applyExtraction(s: SessionState, e: Extraction): string[] {
  const changed: string[] = [];
  for (const [id, v] of Object.entries(e.slots)) if (setSlot(s, id, v.value, "user", { unit: v.unit })) changed.push(id);
  for (const m of e.modifiers) if (!s.modifiers.includes(m)) s.modifiers.push(m);
  return changed;
}
export async function extractSlots(model: ChatModel, s: SessionState, message: string, missing: string[], situations?: { catalogue: string; isSituation: (name: string) => boolean }): Promise<Extraction> {
  const system = extractionPrompt(missing, situations?.catalogue);
  const reply = await model.complete({ purpose: "extract", system, cachePrefix: system.slice(0, system.lastIndexOf(NEEDED)), messages: [...s.messages.slice(-4), { role: "user", content: message }] });
  return parseExtraction(reply, situations?.isSituation);
}
