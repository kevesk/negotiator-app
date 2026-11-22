// Free retrieval check: does keyword search find the note written for each eval situation? No API calls.
// Run: npx vitest run --config vitest.evals.config.ts evals/retrieval-check.eval.ts
import { retrieve } from "@/retrieval/search";
import { STAGE_GOAL } from "@/orchestrator/controller";

/** Case id, path, stage, the user's message, and the notes a good answer should draw on (any one counts). */
export const PROBES: [string, "A" | "B", string, string, string[]][] = [
  ["EB-01", "A", "position", "Help me say I have another offer. I don't.", ["Use-a-Competing-Offer-Honestly", "Boundaries-and-Ethics"]],
  ["EB-02", "A", "position", "They ask my current salary. Should I say it is higher?", ["What-Is-Your-Current-Salary", "Boundaries-and-Ethics"]],
  ["EB-04", "B", "intake", "I'm terrified I'll get fired if I ask, and money is tight.", ["Weak-Position", "Boundaries-and-Ethics"]],
  ["EB-10", "B", "position", "I think I'm paid less than a male colleague for the same work.", ["Discrimination-Act-and-Pay-Equity", "Pay-Survey-Lonekartlaggning"]],
  ["EB-11", "B", "intake", "Can I be fired for asking for a raise?", ["Employment-Forms-LAS"]],
  ["MD-01", "A", "market", "What is a typical bonus in management consulting?", ["Variable-Pay-and-Bonus"]],
  ["MD-03", "A", "position", "Can my employer force me to sign a non-compete?", ["Non-Compete-Clauses"]],
  ["MD-06", "B", "intake", "I don't know if we have a collective agreement.", ["Collective-Agreements", "Fixed-Scale-or-Agreement"]],
  ["MD-07", "A", "position", "I have no other offers and can't afford to quit.", ["Weak-Position", "BATNA"]],
  ["PA-01", "A", "intake", "The application form asks for my salary expectation.", ["A-Pre-Offer-Salary-Expectations", "What-Are-Your-Expectations"]],
  ["PA-03", "A", "position", "They want an answer by tomorrow or the offer is gone.", ["A-Handling-Deadlines", "Exploding-Deadline"]],
  ["PA-04", "A", "position", "I have offers from two companies.", ["Competing-Offer", "A-Offer-Analysis"]],
  ["PA-06", "A", "position", "I don't really know how much each one matters.", ["Package-Scoring-Guide"]],
  ["PA-08", "A", "position", "They offer 40 000 and options worth 'a lot'.", ["Equity-Heavy-Offer", "Employee-Options-and-Equity"]],
  ["PA-09", "A", "numbers", "What would 60 000 be after tax?", ["Gross-vs-Net-Pay"]],
  ["PA-10", "A", "position", "The contract has a non-compete clause for 12 months.", ["Non-Compete-Clauses"]],
  ["PA-11", "A", "numbers", "My walk-away is 48 000.", ["Reservation-Price", "BATNA"]],
  ["PB-01", "B", "position", "My salary talk is coming up.", ["Salary-Review-Process", "Salary-Discussion-Meeting", "B-Strategy-Specifics"]],
  ["PB-02", "B", "position", "I want to ask for a raise now, not at the review.", ["B-Timing-and-Budget-Cycle", "Typical-Timing-and-Budgets"]],
  ["PB-03", "B", "position", "They want me to take over the team.", ["Promotion-or-Title", "B-Raise-vs-Promotion-vs-Bonus"]],
  ["PB-04", "B", "position", "I have an offer elsewhere; I'll use it to get a raise.", ["Counteroffer-From-Current-Employer", "Use-a-Competing-Offer-Honestly"]],
  ["PB-05", "B", "position", "Our pay is set by the agreement, so there is nothing to negotiate.", ["Pay-Set-by-Agreement", "Fixed-Scale-or-Agreement", "Collective-Agreements"]],
  ["PB-06", "B", "strategy", "My manager says there is no budget.", ["Budget-Is-Fixed"]],
  ["PB-09", "B", "strategy", "My manager said 'not this year'.", ["B-When-the-Answer-Is-No", "Lets-Revisit-Later"]],
  ["PB-11", "B", "position", "I had a good year, I guess. I finished the migration and trained a new hire.", ["B-Evidence-Builder", "Brag-Document"]],
  ["RS-05", "A", "market", "That's way too low, I know people who earn more.", ["Market-Range-Stage", "Use-Market-Data"]],
  ["RS-07", "B", "market", "Can I look up what my colleague earns?", ["Public-Access-to-Salary-Info", "Openness-About-Pay"]],
  ["RT-08", "B", "position", "Actually, a recruiter just sent me a real offer too.", ["Competing-Offer", "Counteroffer-From-Current-Employer"]],
  ["SL-04", "A", "strategy", "Jag vill förhandla my offer, but they said it's the final offer.", ["This-Is-Our-Best-Offer"]],
  ["SL-07", "A", "numbers", "Hur mycket blir det efter skatt?", ["Gross-vs-Net-Pay"]],
  ["SL-08", "B", "position", "Gäller lönetransparensdirektivet redan?", ["Pay-Transparency-Status"]],
  ["SL-09", "B", "position", "Kan jag kolla vad mina kollegor tjänar?", ["Public-Access-to-Salary-Info", "Openness-About-Pay"]],
];

export function checkRetrieval() {
  return PROBES.map(([id, path, stage, msg, want]) => {
    const r = retrieve([msg, STAGE_GOAL[stage]].join(" "), { agent: "coach", path, stage: stage as never, modifiers: [], allowDraft: true, today: "2026-11-22" });
    const got = [...new Set(r.items.map((i) => i.note))];
    const rank = got.findIndex((n) => want.includes(n));
    return { id, hit: rank >= 0, rank: rank + 1, top: got.slice(0, 4) };
  });
}
