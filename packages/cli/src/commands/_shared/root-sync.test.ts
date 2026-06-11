import { describe, expect, it } from "vitest";
import { resolveSyncedBeatDuration } from "./root-sync.js";
import { __setFfmpegToolsForTests, ffmpegToolsAvailable } from "./ffmpeg-gate.js";

describe("resolveSyncedBeatDuration", () => {
  const probe = (sec: number) => async () => sec;
  const failingProbe = async (): Promise<number> => {
    throw new Error("ffprobe unavailable");
  };

  it("stretches to the probed narration length over a stale reported duration", async () => {
    // The bug this guards: build-report.json recorded sceneDurationSec=10
    // while ffprobe was unavailable, but the narration file is 21.36s —
    // trusting the report truncated audio at every clip boundary.
    const duration = await resolveSyncedBeatDuration({
      projectDir: "/proj",
      beatDuration: 10,
      narrationPath: "assets/narration-capability.mp3",
      sceneDurationSec: 10,
      probeAudioDuration: probe(21.36),
    });
    expect(duration).toBe(21.86); // probe + 0.5s pad wins
  });

  it("keeps the reported duration when it exceeds the probe (compose padding)", async () => {
    const duration = await resolveSyncedBeatDuration({
      projectDir: "/proj",
      beatDuration: 5,
      narrationPath: "assets/narration-hook.mp3",
      sceneDurationSec: 12,
      probeAudioDuration: probe(9),
    });
    expect(duration).toBe(12);
  });

  it("falls back to max(reported, storyboard) when probing fails", async () => {
    const duration = await resolveSyncedBeatDuration({
      projectDir: "/proj",
      beatDuration: 8,
      narrationPath: "assets/narration-x.mp3",
      sceneDurationSec: 6,
      probeAudioDuration: failingProbe,
    });
    expect(duration).toBe(8);
  });

  it("uses the storyboard duration when there is no narration", async () => {
    await expect(
      resolveSyncedBeatDuration({ projectDir: "/proj", beatDuration: 7 })
    ).resolves.toBe(7);
    await expect(
      resolveSyncedBeatDuration({ projectDir: "/proj", beatDuration: 7, sceneDurationSec: 9 })
    ).resolves.toBe(9);
  });
});

describe("ffmpegToolsAvailable", () => {
  it("honors the test override in both directions", () => {
    try {
      __setFfmpegToolsForTests(true);
      expect(ffmpegToolsAvailable()).toBe(true);
      __setFfmpegToolsForTests(false);
      expect(ffmpegToolsAvailable()).toBe(false);
    } finally {
      __setFfmpegToolsForTests(null);
    }
  });
});
