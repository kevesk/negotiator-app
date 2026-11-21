import { describe, it, expect } from "vitest";
import { runResearch, validateResearch, matchesSource, domainAllowed, toMarketRange, researchInputFrom, researcherSystem, ALLOWED_DOMAINS, type ResearchInput } from "@/agents/researcher";
import { newState, setSlot, slotValue } from "@/orchestrator";

const TODAY = "2026-11-21";
const INPUT: ResearchInput = { role_title: "Credit analyst", experience_years: 4, industry: "Banking", employer_type: "private, large", location: "Linköping", work_mode: "hybrid" };
const URL1 = "https://www.sverigesingenjorer.se/lon/statistik"; const URL2 = "https://www.scb.se/lonesok";
const src = (o: object = {}) => ({ name: "Union survey", tier: 2, measure: "quartile", value: "P25 41 000; median 46 000; P75 52 000", year_or_date: "2026", retrieved_on: "x", url_or_reference: URL1, ...o });
const good = (o: object = {}) => ({ request: { role_description: "Credit analyst" }, unit: "SEK per month, gross, full-time equivalent", range: { p25: 41000, median: 46000, p75: 52000, average: null },
  confidence: { level: "medium", reasons: ["tier-2 source with quartiles; broad occupation group"] }, sources: [src()], caveats: [], valid_as_of: "1999-01-01", gaps_and_next_steps: [], ...o });
const urls = (...u: string[]) => new Set(u.map((x) => { const y = new URL(x); return (y.hostname.replace(/^www\./, "") + y.pathname).toLowerCase(); }));

describe("validation (code-enforced rules)", () => {
  it("accepts a sourced result and sets the date itself", () => {
    const v = validateResearch(good(), urls(URL1), TODAY); expect(v.ok).toBe(true);
    if (v.ok) { expect(v.value.valid_as_of).toBe(TODAY); expect((v.value.sources as any)[0].retrieved_on).toBe(TODAY); }
  });
  it("rejects a figure that matches no source", () => { const v = validateResearch(good({ range: { p25: 41000, median: 47500, p75: 52000, average: null } }), urls(URL1), TODAY); expect(v.ok).toBe(false); if (!v.ok) expect(v.errors.join()).toContain("median 47500"); });
  it("accepts a yearly source figure converted to monthly", () => { const s = src({ measure: "median", value: 552000 }); expect(matchesSource(46000, [s as any])).toBe(true); });
  it("rejects a source that was not retrieved in this search", () => { const v = validateResearch(good(), urls(URL2), TODAY); expect(v.ok).toBe(false); if (!v.ok) expect(v.errors.join()).toContain("not retrieved"); });
  it("rejects a source outside the catalogue", () => { const v = validateResearch(good({ sources: [src({ url_or_reference: "https://random-blog.example/pay" })] }), urls("https://random-blog.example/pay"), TODAY); expect(v.ok).toBe(false); });
  it("rejects a source with no web address", () => expect(validateResearch(good({ sources: [src({ url_or_reference: "SCB table 2025" })] }), urls(URL1), TODAY).ok).toBe(false));
  it("rejects P25 and P75 when only an average exists (D68)", () => { const v = validateResearch(good({ range: { p25: 38000, median: null, p75: 48000, average: 43000 }, sources: [src({ measure: "average", value: 43000 })] }), urls(URL1), TODAY); expect(v.ok).toBe(false); });
  it("average-only result is forced to low confidence with a range note", () => {
    const v = validateResearch(good({ range: { p25: null, median: null, p75: null, average: 43000 }, sources: [src({ measure: "average", value: 43000 })] }), urls(URL1), TODAY);
    expect(v.ok).toBe(true); if (v.ok) { expect(v.value.confidence.level).toBe("low"); expect(v.value.range.range_note).toContain("average only"); }
  });
  it("requires confidence reasons", () => expect(validateResearch(good({ confidence: { level: "high", reasons: [] } }), urls(URL1), TODAY).ok).toBe(false));
  it("'none found' with null ranges is valid and low", () => {
    const v = validateResearch(good({ range: { p25: null, median: null, p75: null, average: null }, sources: "none found", confidence: { level: "high", reasons: ["x"] } }), new Set(), TODAY);
    expect(v.ok).toBe(true); if (v.ok) { expect(v.value.confidence.level).toBe("low"); expect(toMarketRange(v.value)).toBeNull(); }
  });
  it("rejects figures with no sources", () => expect(validateResearch(good({ sources: "none found" }), new Set(), TODAY).ok).toBe(false));
  it("domains follow the catalogue, including subdomains", () => { expect(domainAllowed("https://www.scb.se/x")).toBe(true); expect(domainAllowed("https://statistikdatabasen.scb.se/x")).toBe(true); expect(domainAllowed("https://glassdoor.com/x")).toBe(false); expect(domainAllowed("https://scb.se.evil.com/x")).toBe(false); });
  it("converts a validated result into the market_range slot", () => { const v = validateResearch(good(), urls(URL1), TODAY); if (!v.ok) throw 0; expect(toMarketRange(v.value)).toMatchObject({ p25: 41000, median: 46000, p75: 52000, averageOnly: false, confidence: "medium" }); });
});

// scripted API: each entry is one response
const api = (responses: any[]) => { const calls: any[] = []; let i = 0; return { calls, messages: { async create(p: any) { calls.push(structuredClone(p)); return responses[Math.min(i++, responses.length - 1)]; } } }; };
const searchBlock = (...u: string[]) => ({ type: "web_search_tool_result", tool_use_id: "t", content: u.map((url) => ({ type: "web_search_result", url, title: "t" })) });
const text = (o: object) => ({ type: "text", text: "```json\n" + JSON.stringify(o) + "\n```" });
const deps = (client: any) => ({ client, model: "claude-sonnet-5-5", today: TODAY });

describe("research run", () => {
  it("searches within the catalogue only and returns a validated result", async () => {
    const c = api([{ stop_reason: "end_turn", content: [searchBlock(URL1), text(good())] }]);
    const r = await runResearch(INPUT, deps(c)); expect(r.ok).toBe(true);
    const tools = c.calls[0].tools; expect(tools.map((t: any) => t.name)).toEqual(["web_search", "web_fetch"]); for (const t of tools) expect(t.allowed_domains).toEqual(ALLOWED_DOMAINS);
    expect(c.calls[0].system).toContain("Never use remembered figures");
  });
  it("continues a paused server-tool turn", async () => {
    const c = api([{ stop_reason: "pause_turn", content: [searchBlock(URL1)] }, { stop_reason: "end_turn", content: [text(good())] }]);
    expect((await runResearch(INPUT, deps(c))).ok).toBe(true); expect(c.calls.length).toBe(2);
  });
  it("repairs once when validation fails, then succeeds", async () => {
    const c = api([{ stop_reason: "end_turn", content: [searchBlock(URL1), text(good({ range: { p25: 41000, median: 99999, p75: 52000, average: null } }))] }, { stop_reason: "end_turn", content: [text(good())] }]);
    expect((await runResearch(INPUT, deps(c))).ok).toBe(true); expect(JSON.stringify(c.calls[1].messages.at(-1))).toContain("median 99999");
  });
  it("returns a null result after a failed repair, never an unchecked figure", async () => {
    const bad = good({ range: { p25: 1, median: 2, p75: 3, average: null } });
    const c = api([{ stop_reason: "end_turn", content: [searchBlock(URL1), text(bad)] }]);
    const r = await runResearch(INPUT, deps(c)); expect(r.ok).toBe(false); expect(r.value).toBeUndefined();
  });
  it("handles non-JSON replies and API errors without throwing", async () => {
    expect((await runResearch(INPUT, deps(api([{ stop_reason: "end_turn", content: [{ type: "text", text: "I think it is about 50k" }] }])))).ok).toBe(false);
    expect((await runResearch(INPUT, deps({ messages: { create: async () => { throw new Error("boom"); } } }))).ok).toBe(false);
  });
});

describe("what the researcher sees", () => {
  it("never receives the user's own target, walk-away, current pay or alternative", () => {
    const s = newState("en");
    for (const [k, v] of Object.entries({ role_title: "Analyst", experience_years: 3, industry: "Banking", employer_type: "private", location: "Linköping", work_mode: "hybrid", own_target: 52000, walk_away: 47000, current_base: 41000, batna: "stay" })) setSlot(s, k, v, "user");
    const json = JSON.stringify(researchInputFrom((id) => slotValue(s, id)));
    expect(json).toContain("Analyst"); for (const x of ["52000", "47000", "41000", "stay", "own_target", "walk_away", "current_base"]) expect(json).not.toContain(x);
  });
  it("the prompt is built from the vault's method notes and says no advice", () => { const p = researcherSystem(); expect(p).toContain("never advice"); expect(p).toContain("Source Hierarchy"); expect(p).toContain("Confidence Scoring"); });
});
