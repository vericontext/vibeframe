/**
 * Unit tests for scene-audio-mux. Pure construction only — `muxAudioIntoVideo`
 * is exercised by the C3 smoke test, not here, so CI doesn't depend on
 * ffmpeg installation.
 */

import { describe, expect, it } from "vitest";
import { buildAudioMuxFilter } from "./scene-audio-mux.js";
import type { SceneAudioElement } from "./scene-audio-scan.js";

function makeAudio(overrides: Partial<SceneAudioElement> = {}): SceneAudioElement {
  return {
    srcRel: "assets/narration-1.wav",
    srcAbs: "/proj/assets/narration-1.wav",
    absoluteStart: 0,
    durationHint: "auto",
    clipDurationCap: 5,
    volume: 1,
    trackIndex: 2,
    compositionSrc: "compositions/scene-1.html",
    ...overrides,
  };
}

describe("buildAudioMuxFilter", () => {
  it("returns null for an empty list", () => {
    expect(buildAudioMuxFilter([])).toBeNull();
  });

  it("single input: trim + delay + volume → labelled stream, no amix", () => {
    const filter = buildAudioMuxFilter([makeAudio()]);
    expect(filter).not.toBeNull();
    expect(filter!.inputCount).toBe(1);
    expect(filter!.outLabel).toBe("[a0]");
    // Per-stage construction
    expect(filter!.filterComplex).toBe(
      "[1:a]atrim=duration=5.000,asetpts=PTS-STARTPTS,adelay=0:all=1,volume=1[a0]",
    );
    // No amix
    expect(filter!.filterComplex).not.toContain("amix");
  });

  it("converts absoluteStart to milliseconds for adelay", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ absoluteStart: 1.234, clipDurationCap: 3 }),
    ]);
    expect(filter!.filterComplex).toContain("adelay=1234:all=1");
  });

  it("preserves volume in the filter", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ volume: 0.6 }),
    ]);
    expect(filter!.filterComplex).toContain("volume=0.6");
  });

  it("multi-input: builds per-stream stages plus an amix", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ absoluteStart: 0, clipDurationCap: 3 }),
      makeAudio({
        absoluteStart: 3,
        clipDurationCap: 4,
        volume: 0.8,
        srcRel: "assets/narration-2.wav",
        srcAbs: "/proj/assets/narration-2.wav",
      }),
    ]);
    expect(filter!.inputCount).toBe(2);
    expect(filter!.outLabel).toBe("[mixed]");
    expect(filter!.filterComplex).toContain(
      "[1:a]atrim=duration=3.000,asetpts=PTS-STARTPTS,adelay=0:all=1,volume=1[a0]",
    );
    expect(filter!.filterComplex).toContain(
      "[2:a]atrim=duration=4.000,asetpts=PTS-STARTPTS,adelay=3000:all=1,volume=0.8[a1]",
    );
    expect(filter!.filterComplex).toContain(
      "[a0][a1]amix=inputs=2:dropout_transition=0:normalize=0[mixed]",
    );
  });

  it("clamps negative clipDurationCap to 0", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ clipDurationCap: -1 }),
    ]);
    expect(filter!.filterComplex).toContain("atrim=duration=0.000");
  });

  it("clamps negative absoluteStart to 0 in adelay", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ absoluteStart: -0.05 }),
    ]);
    expect(filter!.filterComplex).toContain("adelay=0:all=1");
  });

  it("falls back to volume=1 when value is non-finite", () => {
    const filter = buildAudioMuxFilter([
      makeAudio({ volume: NaN }),
    ]);
    expect(filter!.filterComplex).toContain("volume=1");
  });

  it("emits a deterministic label sequence (a0, a1, a2, ...)", () => {
    const filter = buildAudioMuxFilter([
      makeAudio(),
      makeAudio({ absoluteStart: 1 }),
      makeAudio({ absoluteStart: 2 }),
    ]);
    expect(filter!.filterComplex).toContain("[a0]");
    expect(filter!.filterComplex).toContain("[a1]");
    expect(filter!.filterComplex).toContain("[a2]");
    expect(filter!.outLabel).toBe("[mixed]");
  });
});
