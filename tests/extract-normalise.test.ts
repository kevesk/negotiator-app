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
