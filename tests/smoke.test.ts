import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "@/engine";
describe("smoke", () => { it("loads the engine", () => { expect(ENGINE_VERSION).toBe("0.1.0"); }); });
