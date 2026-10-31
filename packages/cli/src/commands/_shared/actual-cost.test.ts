import { describe, expect, it } from "vitest";
import type { UsageRecord } from "@vibeframe/ai-providers";

import { commandForToolName, withMeteredCost } from "../../tools/adapters/mcp.js";
import { costOfUsage, roundUsd, upperBoundCost } from "./actual-cost.js";

const NOV_2026 = new Date("2026-11-15T00:00:00Z");

const chars = (count: number): UsageRecord => ({
  provider: "elevenlabs",
  kind: "speech",
  model: "eleven_v3",
  amount: { unit: "characters", count },
  at: 0,
});
const isolation: UsageRecord = {
  provider: "elevenlabs",
  kind: "audio-isolation",
  model: "audio-isolation",
  amount: { unit: "requests", count: 1 },
  at: 0,
};

describe("roundUsd", () => {
  it("rounds to a millionth of a dollar", () => {
    expect(roundUsd(0.0000224999)).toBe(0.000022);
    expect(roundUsd(0.0016000001)).toBe(0.0016);
    expect(roundUsd(1 / 3)).toBe(0.333333);
  });
});

describe("costOfUsage", () => {
  it("is zero and exact when nothing was metered", () => {
    expect(costOfUsage([], 0.3)).toEqual({ costUsd: 0, estimated: false, warnings: [] });
  });

  it("is consumption x list price when every call is priced", () => {
    expect(costOfUsage([chars(1000), chars(500)], 0.3, NOV_2026)).toEqual({ costUsd: 0.12, estimated: false, warnings: [] });
  });

  it("reports the upper bound, flagged, when a call has no list price", () => {
    const cost = costOfUsage([chars(100), isolation], 0.2, NOV_2026);
    expect(cost.costUsd).toBe(0.2);
    expect(cost.estimated).toBe(true);
    expect(cost.warnings).toEqual(["costUsd is an upper-bound estimate: the model catalog has no list price for elevenlabs audio-isolation."]);
  });

  it("keeps the priced part when it exceeds the upper bound", () => {
    expect(costOfUsage([chars(10_000), isolation], 0.2, NOV_2026).costUsd).toBe(0.8);
  });

  it("flags an inferred amount without replacing the computed cost", () => {
    const inferred: UsageRecord = {
      provider: "elevenlabs",
      kind: "transcription",
      model: "scribe_v2",
      amount: { unit: "seconds", count: 3600 },
      estimated: true,
      at: 0,
    };
    const cost = costOfUsage([inferred], 0.1, NOV_2026);
    expect(cost).toMatchObject({ costUsd: 0.22, estimated: true });
    expect(cost.warnings[0]).toContain("elevenlabs scribe_v2");
  });
});

describe("upperBoundCost", () => {
  it("charges the bound per call, flagged", () => {
    expect(upperBoundCost(5, 2, "kling")).toMatchObject({ costUsd: 10, estimated: true });
  });
  it("is free for zero calls", () => {
    expect(upperBoundCost(5, 0, "kling")).toEqual({ costUsd: 0, estimated: false, warnings: [] });
  });
});

describe("MCP metered cost", () => {
  it("maps a tool name to its CLI command", () => {
    expect(commandForToolName("generate_narration")).toBe("generate narration");
    expect(commandForToolName("audio_clone_voice")).toBe("audio clone-voice");
    expect(commandForToolName("render")).toBe("render");
  });

  it("adds costUsd and merges cost warnings into data.warnings", () => {
    const result = withMeteredCost("audio_isolate", { success: true, data: { outputPath: "a.mp3", warnings: ["w"] } }, [isolation]);
    expect(result.data).toMatchObject({ outputPath: "a.mp3", costUsd: 0.2, costEstimated: true });
    expect(result.data?.warnings).toEqual(["w", expect.stringContaining("no list price")]);
  });

  it("leaves results alone when nothing was metered or the tool reports its own cost", () => {
    const free = { success: true, data: { outputPath: "x" } };
    expect(withMeteredCost("detect_scenes", free, [])).toBe(free);
    const own = { success: true, data: { costUsd: 1.5 } };
    expect(withMeteredCost("generate_image", own, [chars(10)])).toBe(own);
  });
});
