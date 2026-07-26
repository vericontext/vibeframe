import { describe, expect, it } from "vitest";

import {
  buildFootageAssembleArgs,
  planFootageTimeline,
  FOOTAGE_DEFAULTS,
} from "./footage-assemble.js";

describe("planFootageTimeline", () => {
  it("chains segments with a crossfade overlap and reports xfade-ready offsets", () => {
    const plan = planFootageTimeline(
      [
        { id: "a", clipDurationSec: 5 },
        { id: "b", clipDurationSec: 5 },
        { id: "c", clipDurationSec: 4 },
      ],
      { transitionSec: 0.5 }
    );
    expect(plan.transitionSec).toBe(0.5);
    expect(plan.beats.map((b) => b.startSec)).toEqual([0, 4.5, 9]);
    // total = 5 + 5 + 4 - 2 * 0.5
    expect(plan.totalDurationSec).toBe(13);
    expect(plan.warnings).toEqual([]);
  });

  it("extends a segment by holding the last frame when narration outruns the clip", () => {
    const plan = planFootageTimeline(
      [
        { id: "a", clipDurationSec: 5, narrationDurationSec: 6 },
        { id: "b", clipDurationSec: 5 },
      ],
      { transitionSec: 0.5, narrationLeadSec: 0.35, narrationTailSec: 0.4 }
    );
    const a = plan.beats[0];
    // required = 0.35 lead + 6 narration + 0.4 tail = 6.75
    expect(a.segmentDurationSec).toBe(6.75);
    expect(a.extendedSec).toBe(1.75);
    expect(a.narrationStartSec).toBe(0.35);
    expect(plan.beats[1].startSec).toBe(6.25);
    expect(plan.warnings.some((w) => w.includes('"a"'))).toBe(true);
  });

  it("keeps the clip length as the floor when narration is shorter", () => {
    const plan = planFootageTimeline(
      [
        { id: "a", clipDurationSec: 5, narrationDurationSec: 2 },
        { id: "b", clipDurationSec: 5, narrationDurationSec: 2 },
      ],
      { transitionSec: 0.5, narrationLeadSec: 0.35 }
    );
    expect(plan.beats.map((b) => b.segmentDurationSec)).toEqual([5, 5]);
    expect(plan.beats.map((b) => b.extendedSec)).toEqual([0, 0]);
    // Beat b's narration starts after half the incoming crossfade + the lead.
    expect(plan.beats[1].narrationStartSec).toBe(4.5 + 0.25 + 0.35);
  });

  it("reserves the tail fade after the last beat's narration", () => {
    const plan = planFootageTimeline(
      [{ id: "only", clipDurationSec: 3, narrationDurationSec: 3 }],
      { transitionSec: 0.5, fadeSec: 1, narrationLeadSec: 0.35, narrationTailSec: 0.4 }
    );
    // tail = max(0.4, fade 1) => 0.35 + 3 + 1
    expect(plan.totalDurationSec).toBe(4.35);
  });

  it("clamps the transition to half the shortest clip with a warning", () => {
    const plan = planFootageTimeline(
      [
        { id: "a", clipDurationSec: 5 },
        { id: "b", clipDurationSec: 1 },
      ],
      { transitionSec: 2 }
    );
    expect(plan.transitionSec).toBe(0.45);
    expect(plan.warnings.some((w) => w.includes("clamped"))).toBe(true);
  });

  it("throws on an empty clip list", () => {
    expect(() => planFootageTimeline([])).toThrow(/No clips/);
  });
});

describe("buildFootageAssembleArgs", () => {
  const plan = planFootageTimeline(
    [
      { id: "a", clipDurationSec: 5, narrationDurationSec: 6 },
      { id: "b", clipDurationSec: 5 },
    ],
    { transitionSec: 0.5 }
  );

  it("builds the xfade chain at planned offsets with normalized inputs", () => {
    const args = buildFootageAssembleArgs({
      clipPaths: ["/p/a.mp4", "/p/b.mp4"],
      plan,
      narrationPaths: new Map(),
      outputPath: "/p/out.mp4",
    });
    expect(args[0]).toBe("-y");
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain(`[0:v]scale=1920:1080`);
    expect(fc).toContain("tpad=stop_mode=clone:stop_duration=1.75");
    expect(fc).toContain(`xfade=transition=fade:duration=0.5:offset=${plan.beats[1].startSec}`);
    expect(fc).toContain("fade=t=in:st=0");
    expect(args).toContain("-an");
    expect(args[args.length - 1]).toBe("/p/out.mp4");
    expect(args).toContain("+faststart");
  });

  it("delays each narration to its planned start and mixes over ducked music", () => {
    const args = buildFootageAssembleArgs({
      clipPaths: ["/p/a.mp4", "/p/b.mp4"],
      plan,
      narrationPaths: new Map([[0, "/p/nar-a.mp3"]]),
      musicPath: "/p/music.mp3",
      outputPath: "/p/out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    const expectedMs = Math.round((plan.beats[0].narrationStartSec ?? 0) * 1000);
    expect(fc).toContain(`[2:a]adelay=${expectedMs}:all=1[nd0]`);
    expect(fc).toContain("sidechaincompress=threshold=");
    expect(fc).toContain(`volume=${FOOTAGE_DEFAULTS.musicVolume}`);
    expect(args).toContain("-stream_loop");
    expect(args).toContain("[aout]");
    expect(args).not.toContain("-an");
  });

  it("mixes multiple narrations without music via amix", () => {
    const args = buildFootageAssembleArgs({
      clipPaths: ["/p/a.mp4", "/p/b.mp4"],
      plan: planFootageTimeline(
        [
          { id: "a", clipDurationSec: 5, narrationDurationSec: 2 },
          { id: "b", clipDurationSec: 5, narrationDurationSec: 2 },
        ],
        { transitionSec: 0.5 }
      ),
      narrationPaths: new Map([
        [0, "/p/nar-a.mp3"],
        [1, "/p/nar-b.mp3"],
      ]),
      outputPath: "/p/out.mp4",
    });
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("amix=inputs=2:normalize=0[nar]");
    expect(fc).not.toContain("sidechaincompress");
  });
});
