import { describe, expect, it } from "vitest";

import { resolveOpenAIImageModel } from "./openai-image.js";

describe("resolveOpenAIImageModel", () => {
  it.each([
    [undefined, "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["2.5", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["sunburst", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["flare", "gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
    ["gpt-image-2.5-flare", "gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
    ["2", "gpt-image-2", "GPT Image 2"],
    ["gpt-image-2", "gpt-image-2", "GPT Image 2"],
    ["1.5", "gpt-image-1.5", "GPT Image 1.5"],
    ["gpt-image-1.5", "gpt-image-1.5", "GPT Image 1.5"],
    ["dalle", "gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
  ] as const)("model alias %s → openaiModel=%s, label=%s", (alias, expectedModel, expectedLabel) => {
    // Regression cover for the v0.52.0 bug: the label must always describe
    // the model id that is actually sent.
    const r = resolveOpenAIImageModel(alias);
    expect(r.openaiModel).toBe(expectedModel);
    expect(r.modelLabel).toBe(expectedLabel);
  });
});
