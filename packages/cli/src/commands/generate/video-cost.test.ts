import { describe, expect, it } from "vitest";
import { realRunCost } from "./video.js";

describe("realRunCost", () => {
  it("prices seedance with the token-accurate estimator, no warning", () => {
    const { costUsd, warnings } = realRunCost("seedance", { duration: "5" });
    expect(costUsd).toBeGreaterThan(0);
    expect(costUsd).toBeLessThan(5); // accurate estimate, not the tier bound
    expect(warnings).toEqual([]);
  });

  it("reports the tier upper bound for providers without an estimator", () => {
    for (const provider of ["runway", "veo", "kling", "grok"]) {
      const { costUsd, warnings } = realRunCost(provider, { duration: "5" });
      // Never 0: a paid run reporting $0 reads as "free" to an agent budget
      // loop - the bug this guards against (hybrid-brew dogfood, 2026-07-26).
      expect(costUsd).toBeGreaterThan(0);
      expect(warnings.join(" ")).toContain(provider);
      expect(warnings.join(" ")).toContain("upper bound");
    }
  });

  it("treats the deprecated fal alias like seedance", () => {
    expect(realRunCost("fal", { duration: "5" }).warnings).toEqual([]);
  });
});
