import { describe, expect, it } from "vitest";

import { resolveGrokImageModel } from "./GrokProvider.js";

describe("resolveGrokImageModel", () => {
  it("maps quality aliases to grok-imagine-image-2.0 at medium quality", () => {
    for (const alias of ["pro", "2.0", "quality", "grok-imagine-image-2.0"]) {
      expect(resolveGrokImageModel(alias)).toEqual({ model: "grok-imagine-image-2.0", quality: "medium" });
    }
  });

  it("uses the base model otherwise, including Gemini-only aliases", () => {
    for (const alias of [undefined, "flash", "standard"]) {
      expect(resolveGrokImageModel(alias)).toEqual({ model: "grok-imagine-image" });
    }
  });
});
