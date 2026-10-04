import { describe, expect, it } from "vitest";

import { estimateImageCostUsd } from "./image-cost.js";

describe("estimateImageCostUsd", () => {
  it("prices each provider and model per image instead of reporting zero", () => {
    expect(estimateImageCostUsd("openai", undefined, 1).costUsd).toBe(0.211);
    expect(estimateImageCostUsd("openai", "1.5", 2).costUsd).toBe(0.266);
    expect(estimateImageCostUsd("gemini", "lite", 1).costUsd).toBe(0.034);
    expect(estimateImageCostUsd("gemini", undefined, 3).costUsd).toBe(0.201);
    expect(estimateImageCostUsd("grok", "pro", 1).costUsd).toBe(0.08);
    expect(estimateImageCostUsd("grok", undefined, 1).costUsd).toBe(0.02);
  });

  it("labels the figure as an estimate", () => {
    expect(estimateImageCostUsd("grok", undefined, 1).warnings[0]).toMatch(/upper-bound estimate/);
  });

  it("falls back to the tier upper bound for providers without list prices", () => {
    const result = estimateImageCostUsd("runway", undefined, 1);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/tier upper bound/);
  });
});
