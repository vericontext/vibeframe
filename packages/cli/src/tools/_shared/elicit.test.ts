import { describe, expect, it } from "vitest";
import { applyElicitationAnswers, planBuildElicitation, type BuildChoiceArgs } from "./elicit.js";

const empty: BuildChoiceArgs = {};

describe("planBuildElicitation", () => {
  it("asks about narration, backdrops, and cost cap when nothing is specified", () => {
    const form = planBuildElicitation({});
    expect(form).not.toBeNull();
    const props = form!.requestedSchema.properties;
    expect(Object.keys(props).sort()).toEqual(["backdrop_images", "max_cost_usd", "narration"]);
    expect(form!.requestedSchema.required?.sort()).toEqual(["backdrop_images", "narration"]);
  });

  it("still asks about narration when ttsProvider is the 'auto' placeholder", () => {
    const form = planBuildElicitation({ ttsProvider: "auto", skipBackdrop: true, maxCostUsd: 5 });
    expect(form).not.toBeNull();
    expect(Object.keys(form!.requestedSchema.properties)).toEqual(["narration"]);
  });

  it("skips the narration question when narration is skipped entirely", () => {
    const form = planBuildElicitation({ skipNarration: true, skipBackdrop: true, maxCostUsd: 5 });
    expect(form).toBeNull();
  });

  it("returns null when every choice is explicit", () => {
    expect(
      planBuildElicitation({ ttsProvider: "kokoro", skipBackdrop: true, maxCostUsd: 10 })
    ).toBeNull();
    expect(
      planBuildElicitation({ ttsProvider: "elevenlabs", imageProvider: "openai", maxCostUsd: 10 })
    ).toBeNull();
  });

  it("returns null for stages that do not generate assets", () => {
    for (const stage of ["compose", "sync", "render"] as const) {
      expect(planBuildElicitation({ stage })).toBeNull();
    }
    expect(planBuildElicitation({ stage: "assets" })).not.toBeNull();
    expect(planBuildElicitation({ stage: "all" })).not.toBeNull();
  });
});

describe("applyElicitationAnswers", () => {
  it("maps narration, openai backdrops, and the cost cap onto build args", () => {
    const next = applyElicitationAnswers(empty, {
      narration: "elevenlabs",
      backdrop_images: "openai",
      max_cost_usd: 7,
    });
    expect(next.ttsProvider).toBe("elevenlabs");
    expect(next.skipBackdrop).toBe(false);
    expect(next.imageProvider).toBe("openai");
    expect(next.maxCostUsd).toBe(7);
  });

  it("maps 'skip' backdrops to skipBackdrop without touching imageProvider", () => {
    const next = applyElicitationAnswers(empty, { narration: "kokoro", backdrop_images: "skip" });
    expect(next.ttsProvider).toBe("kokoro");
    expect(next.skipBackdrop).toBe(true);
    expect(next.imageProvider).toBeUndefined();
  });

  it("ignores invalid or missing values", () => {
    const base: BuildChoiceArgs = { ttsProvider: "auto" };
    expect(applyElicitationAnswers(base, undefined)).toEqual(base);
    const next = applyElicitationAnswers(base, {
      narration: "robotic",
      backdrop_images: "dall-e",
      max_cost_usd: -3,
    });
    expect(next.ttsProvider).toBe("auto");
    expect(next.skipBackdrop).toBeUndefined();
    expect(next.maxCostUsd).toBeUndefined();
  });
});
