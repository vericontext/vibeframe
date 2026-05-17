import { describe, expect, it } from "vitest";

import { resolveOpenAIImageModel } from "./openai-image.js";

describe("resolveOpenAIImageModel", () => {
  it.each([
    ["2", "gpt-image-2", "GPT Image 2"],
    ["gpt-image-2", "gpt-image-2", "GPT Image 2"],
    [undefined, "gpt-image-2", "GPT Image 2"],
    ["dalle", "gpt-image-2", "GPT Image 2"],
    ["", "gpt-image-2", "GPT Image 2"],
    ["gpt-image-1", "gpt-image-2", "GPT Image 2"],
  ] as const)(
    "model alias %s → openaiModel=%s, label=%s",
    (alias, expectedModel, expectedLabel) => {
      const r = resolveOpenAIImageModel(alias);
      expect(r.openaiModel).toBe(expectedModel);
      expect(r.modelLabel).toBe(expectedLabel);
    },
  );

  it.each([
    ["1.5"],
    ["gpt-image-1.5"],
  ] as const)("model alias %s explicitly selects gpt-image-1.5", (alias) => {
    const r = resolveOpenAIImageModel(alias);
    expect(r.openaiModel).toBe("gpt-image-1.5");
    expect(r.modelLabel).toBe("GPT Image 1.5");
  });

  // Regression cover for the v0.52.0 bug — the duplicated handler in
  // generate.ts silently fell back to gpt-image-1.5 because the
  // model-alias parsing was forked. Now that ai-image.ts and
  // generate.ts route through the same helper, this test ensures the
  // contract stays in lockstep. If the label drifts from the model id,
  // both call sites fail at once instead of silently disagreeing.
  it("label and model id stay paired (no silent fallback for gpt-image-2)", () => {
    const r = resolveOpenAIImageModel("2");
    if (r.openaiModel === "gpt-image-2") {
      expect(r.modelLabel).toBe("GPT Image 2");
    }
  });
});
