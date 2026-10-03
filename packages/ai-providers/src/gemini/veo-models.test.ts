import { describe, expect, it } from "vitest";

import { resolveVeoModel, VEO_MODEL_ALIASES } from "./GeminiProvider.js";

describe("Veo model aliases", () => {
  it("maps --veo-model aliases to Veo 3.1 model IDs", () => {
    expect(resolveVeoModel("3.1")).toBe("veo-3.1-generate-preview");
    expect(resolveVeoModel("3.1-fast")).toBe("veo-3.1-fast-generate-preview");
    expect(Object.keys(VEO_MODEL_ALIASES)).toEqual(["3.1", "3.1-fast"]);
  });

  it("rejects the shut-down Veo 3.0 alias with a hint", () => {
    expect(() => resolveVeoModel("3.0")).toThrow(/shut down by Google on 2025-11-12/);
  });

  it("rejects unknown aliases instead of silently substituting a model", () => {
    expect(() => resolveVeoModel("4")).toThrow('Unknown Veo model "4". Valid: 3.1, 3.1-fast.');
    expect(() => resolveVeoModel("toString")).toThrow(/Unknown Veo model/);
  });
});
