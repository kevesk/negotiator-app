import { describe, it, expect, afterEach } from "vitest";
import { accessRequired, accessOk, RateLimiter, visitorKey, guardChat, minutes } from "@/server/access";
import { GET as accessGet, POST as accessPost } from "@/app/api/access/route";
import { POST as chatPost } from "@/app/api/chat/route";

const H = (o: Record<string, string> = {}) => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...o });
const saved = process.env.ACCESS_CODE;
afterEach(() => { if (saved === undefined) delete process.env.ACCESS_CODE; else process.env.ACCESS_CODE = saved; });

describe("access code", () => {
  it("without a code set, the app is open", () => { expect(accessRequired("")).toBe(false); expect(accessOk(null, "")).toBe(true); expect(accessOk(null, undefined)).toBe(true); });
  it("with a code set, only that code passes (spaces around it are ignored)", () => {
    expect(accessRequired("tiger-42")).toBe(true);
    expect(accessOk("tiger-42", "tiger-42")).toBe(true); expect(accessOk("  tiger-42 ", "tiger-42")).toBe(true);
    expect(accessOk("tiger-43", "tiger-42")).toBe(false); expect(accessOk("", "tiger-42")).toBe(false); expect(accessOk(null, "tiger-42")).toBe(false);
  });
});

describe("message caps", () => {
  it("allows up to the limit in the window, then says when to come back", () => {
    const l = new RateLimiter(3, 60_000); const t0 = 1_000_000;
    expect([0, 1, 2].map((i) => l.hit("a", t0 + i).ok)).toEqual([true, true, true]);
    const r = l.hit("a", t0 + 10); expect(r.ok).toBe(false); expect(r.retryAfterMs).toBe(60_000 - 10);
    expect(l.hit("b", t0 + 10).ok).toBe(true); // another visitor is not affected
    expect(l.hit("a", t0 + 60_001).ok).toBe(true); // the oldest message left the window
  });
  it("keeps memory bounded", () => { const l = new RateLimiter(1, 60_000, 10); for (let i = 0; i < 50; i++) l.hit(`k${i}`, i); expect((l as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(10); });
  it("the visitor key is a hash, never the address", () => {
    const k = visitorKey(H()); expect(k).toMatch(/^[0-9a-f]{32}$/); expect(k).not.toContain("203"); expect(visitorKey(H())).toBe(k);
    expect(visitorKey(H({ "x-forwarded-for": "198.51.100.1" }))).not.toBe(k);
  });
  it("rounds the wait up to whole minutes", () => { expect(minutes(1)).toBe(1); expect(minutes(61_000)).toBe(2); });
});

describe("the guard in front of the chat", () => {
  const lims = () => ({ visitor: new RateLimiter(2), total: new RateLimiter(3) });
  it("asks for the code first, and a wrong code does not use up the cap", () => {
    process.env.ACCESS_CODE = "tiger-42"; const l = lims();
    expect(guardChat(H(), 0, l)).toEqual({ status: 401, body: { error: "access_required" } });
    expect(guardChat(H({ "x-access-code": "nope" }), 0, l)?.status).toBe(401);
    expect(guardChat(H({ "x-access-code": "tiger-42" }), 0, l)).toBeNull();
  });
  it("stops a visitor at the cap, then everyone at the total cap", () => {
    delete process.env.ACCESS_CODE; const l = lims();
    expect(guardChat(H(), 0, l)).toBeNull(); expect(guardChat(H(), 1, l)).toBeNull();
    expect(guardChat(H(), 2, l)).toMatchObject({ status: 429, body: { error: "rate_limited", retryAfterMinutes: 60 } });
    expect(guardChat(H({ "x-forwarded-for": "198.51.100.1" }), 3, l)).toBeNull(); // total is now 3
    expect(guardChat(H({ "x-forwarded-for": "198.51.100.2" }), 4, l)).toMatchObject({ status: 429, body: { error: "busy" } });
  });
});

describe("routes", () => {
  it("GET /api/access says whether a code is needed", async () => {
    delete process.env.ACCESS_CODE; expect(await (await accessGet()).json()).toEqual({ required: false });
    process.env.ACCESS_CODE = "tiger-42"; expect(await (await accessGet()).json()).toEqual({ required: true });
  });
  it("POST /api/access checks the code", async () => {
    process.env.ACCESS_CODE = "tiger-42";
    const post = (code: string, ip: string) => accessPost(new Request("http://x/api/access", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ code }) }));
    expect((await post("tiger-42", "192.0.2.1")).status).toBe(200); expect((await post("wrong", "192.0.2.1")).status).toBe(401);
  });
  it("POST /api/access caps guessing", async () => {
    process.env.ACCESS_CODE = "tiger-42";
    const post = () => accessPost(new Request("http://x/api/access", { method: "POST", headers: { "x-forwarded-for": "192.0.2.99" }, body: JSON.stringify({ code: "guess" }) }));
    const codes: number[] = []; for (let i = 0; i < 11; i++) codes.push((await post()).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true); expect(codes[10]).toBe(429);
  });
  it("the chat route refuses without the code, before any model is built", async () => {
    process.env.ACCESS_CODE = "tiger-42";
    const r = await chatPost(new Request("http://x/api/chat", { method: "POST", headers: { "x-forwarded-for": "192.0.2.50" }, body: JSON.stringify({ message: "hi", language: "en" }) }));
    expect(r.status).toBe(401); expect(await r.json()).toEqual({ error: "access_required" });
  });
});
