import { describe, it, expect, beforeEach } from "vitest";
import { parseScbCsv, toRange, dataUrl, sectorFor, scbMarketRange, resetScbCache, SCB_META_URL } from "@/agents/scb";
import type { ChatModel } from "@/orchestrator/model";

// The real answer from SCB's PxWebApi for TAB5932, group 3312 (Banktjänstemän), all sectors, 2025 (read 2026-11-22).
const CSV = `"Sektor","Yrke2012","Kon","Månadslön 2025","Medianlön 2025","10:e percentilen 2025","25:e percentilen 2025","75:e percentilen 2025","90:e percentilen 2025"
"0","3312","1+2",47400,43700,30000,35200,53100,66100`;
const META = { variables: [{ code: "Yrke2012", text: "Yrke (SSYK 2012)", values: ["0000", "2411", "3312", "3313"], valueTexts: ["samtliga yrken", "Revisorer m.fl.", "Banktjänstemän", "Redovisningsekonomer"] }] };
const bank = { code: "3312", name: "Banktjänstemän" };
const ALL = ["000007CD", "000007CE", "000007CF", "000007CG", "000007CH", "000007CI"];
/** Answers like SCB: only the measures named in the URL, in that order. */
const serve = (u: string, csv = CSV) => { const want = ALL.map((m, i) => [m, i] as const).filter(([m]) => u.includes(m)).map(([, i]) => 3 + i); const [h, r] = csv.split("\n"); const cut = (l: string, keep: number[]) => { const c = l.split(","); return [...c.slice(0, 3), ...keep.map((i) => c[i])].join(","); }; return r === undefined ? h! : `${cut(h!, want)}\n${cut(r, want)}`; };

describe("SCB figures", () => {
  it("reads the both-sexes row and the six measures in order", () => {
    expect(parseScbCsv(CSV, bank, "0")).toEqual({ code: "3312", name: "Banktjänstemän", year: "2025", sector: "0", average: 47400, median: 43700, p10: 30000, p25: 35200, p75: 53100, p90: 66100 });
  });
  it("turns them into a typical range with a plain source line", () => {
    expect(toRange(parseScbCsv(CSV, bank, "0")!)).toEqual({ p25: 35200, median: 43700, p75: 53100, averageOnly: false, confidence: "medium", sources: ["SCB, lönestrukturstatistik 2025, yrkesgrupp 3312 Banktjänstemän"], valid_as_of: "2025-12-31" });
  });
  it("missing cells give an average only, never invented quartiles", () => {
    const r = parseScbCsv(CSV.replace("35200,53100", "..,.."), bank, "0")!; expect(r.p25).toBeUndefined();
    expect(toRange(r)).toMatchObject({ averageOnly: true, confidence: "low", median: 43700 });
  });
  it("no row, no figures", () => expect(parseScbCsv(CSV.split("\n")[0]!, bank, "0")).toBeNull());
  it("asks SCB for one occupation code, both sexes, the latest year, and nothing from the user", () => {
    const u = dataUrl("3312", "4-5"); expect(u).toContain("valueCodes[Yrke2012]=3312"); expect(u).toContain("valueCodes[Kon]=1%2B2"); expect(u).toContain("valueCodes[Sektor]=4-5"); expect(u).toContain("top(1)");
  });
  it("public, private or all sectors from the employer type", () => {
    expect(sectorFor("Region Östergötland")).toBe("1-3"); expect(sectorFor("private bank")).toBe("4-5"); expect(sectorFor(undefined)).toBe("0");
  });
});

describe("SCB lookup end to end (scripted)", () => {
  beforeEach(() => resetScbCache());
  const res = (body: unknown, ok = true) => ({ ok, text: async () => String(body), json: async () => body });
  const picker = (code: string): ChatModel => ({ async complete(r) { expect(r.purpose).toBe("extract"); expect(r.system).toContain("3312 Banktjänstemän"); return `{"code":"${code}","alt":"","why":"mortgage advice is bank work"}`; } });
  it("a mortgage advisor gets the bank staff range", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: string) => { urls.push(u); return u === SCB_META_URL ? res(META) : res(serve(u)); };
    const r = await scbMarketRange({ role: "Mortgage advisor", industry: "Banking" }, { model: picker("3312"), fetch: fetchFn });
    expect(r!.range).toMatchObject({ p25: 35200, median: 43700, p75: 53100 }); expect(r!.research).toMatchObject({ source: "scb", group: "3312 Banktjänstemän" });
    expect(urls.every((u) => u.startsWith("https://api.scb.se/"))).toBe(true);
    expect(urls.filter((u) => u.includes("/data?")).length).toBe(2); // two small requests, not one with all six measures
  });
  it("an invented code or an SCB outage gives null, so the web researcher can run", async () => {
    expect(await scbMarketRange({ role: "x" }, { model: picker("9999"), fetch: async (u: string) => (u === SCB_META_URL ? res(META) : res(serve(u))) })).toBeNull();
    resetScbCache();
    expect(await scbMarketRange({ role: "x" }, { model: picker("3312"), fetch: async () => res("", false) })).toBeNull();
  });
  it("an empty private-sector cell falls back to all sectors", async () => {
    const fetchFn = async (u: string) => (u === SCB_META_URL ? res(META) : u.includes("Sektor]=4-5") ? res(CSV.split("\n")[0]) : res(serve(u)));
    const r = await scbMarketRange({ role: "Mortgage advisor", employerType: "private bank" }, { model: picker("3312"), fetch: fetchFn });
    expect(r!.research).toMatchObject({ sector: "0" });
  });
});
