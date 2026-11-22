import { describe, it, expect } from "vitest";
import { parseExtraction, normaliseSlot, extractionPrompt } from "@/orchestrator/extract";
import { newState, setSlot, workPlan } from "@/orchestrator";

describe("fixed-value slots are normalised", () => {
  it("the path the live test stored as current_job_raise becomes B, and the flow leaves the first step", () => {
    const e = parseExtraction('{"slots":{"path":{"value":"current_job_raise"},"role_title":{"value":"mortgage advisor"}}}');
    expect(e.slots.path!.value).toBe("B");
    const s = newState("en"); for (const [k, v] of Object.entries({ path: e.slots.path!.value, role_title: "x", experience_years: 5, location: "Linköping", current_base: 45000 })) setSlot(s, k, v, "user");
    expect(workPlan(s).stage).not.toBe("route");
  });
  it("maps common wordings and drops an unclear path", () => {
    expect(normaliseSlot("path", "job offer")).toBe("A"); expect(normaliseSlot("path", "nuvarande jobb")).toBe("B"); expect(normaliseSlot("path", "A")).toBe("A");
    expect(normaliseSlot("path", "something else")).toBeUndefined();
    expect(normaliseSlot("negotiate_scope", "A whole package")).toBe("package"); expect(normaliseSlot("negotiate_scope", "salary only")).toBe("salary only");
    expect(normaliseSlot("b_situation", "annual salary conversation")).toBe("annual_review"); expect(normaliseSlot("a_phase", "I received an offer")).toBe("offer_received");
    expect(normaliseSlot("own_target", 50000)).toBe(50000);
  });
  it("the prompt names the fixed values and asks for every stated fact", () => {
    const p = extractionPrompt(["path"]); expect(p).toContain('path is "A"'); expect(p).toContain("Extract every fact");
  });
});

describe("money slots are one number", () => {
  it("the target from the live test becomes 50 000 and the numbers engine can run", async () => {
    const e = parseExtraction('{"slots":{"own_target":{"value":{"base_salary":50000,"remote_days_per_week":2}},"walk_away":{"value":"47 000 kr"},"first_offer":{"value":"51,5k"}}}');
    expect(e.slots.own_target!.value).toBe(50000); expect(e.slots.walk_away!.value).toBe(47000); expect(e.slots.first_offer!.value).toBe(51500);
    const { runNumbersTool } = await import("@/orchestrator/tools");
    const s = newState("en"); setSlot(s, "own_target", e.slots.own_target!.value, "user"); setSlot(s, "walk_away", 47000, "user");
    expect("needs" in runNumbersTool(s)).toBe(false);
  });
  it("drops what cannot be read as one amount", () => {
    expect(parseExtraction('{"slots":{"own_target":{"value":{"a":50000,"b":60000}}}}').slots.own_target).toBeUndefined();
    expect(parseExtraction('{"slots":{"own_target":{"value":"a good raise"}}}').slots.own_target).toBeUndefined();
  });
});
