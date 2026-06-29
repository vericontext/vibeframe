import { describe, expect, it } from "vitest";
import { applyRootSyncHtml, resolveSyncedBeatDuration } from "./root-sync.js";
import type { ExpectedRootSync } from "./root-sync.js";
import { __setFfmpegToolsForTests, ffmpegToolsAvailable } from "./ffmpeg-gate.js";

describe("applyRootSyncHtml — single managed source (no doubled narration)", () => {
  const block = [
    "      <!-- vibe-scene-build: clip refs (auto-generated; safe to re-run) -->",
    '      <div class="clip" data-composition-id="scene-a" data-composition-src="compositions/scene-a.html" data-start="0" data-duration="6" data-track-index="0"></div>',
    '      <audio id="narration-a" src="assets/narration-a.wav" data-start="0" data-duration="6" data-track-index="2"></audio>',
    "      <!-- /vibe-scene-build -->",
  ].join("\n");
  const expected: ExpectedRootSync = { block, totalDurationSec: 6, audioRefs: [] };

  const shell = (body: string) =>
    `<!doctype html>\n<html>\n  <body>\n` +
    `    <div id="root" data-composition-id="main" data-start="0" data-duration="6">\n` +
    `${body}\n` +
    `    </div>\n` +
    `    <script>\n      window.__timelines = {};\n    </script>\n  </body>\n</html>\n`;

  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it("does not double when the root already has stray narration/scene refs (the bug)", () => {
    const html = shell(
      [
        '      <video id="bg-video" src="assets/bg.mp4" data-start="0" data-duration="6" data-track-index="0"></video>',
        '      <div class="clip" data-composition-id="scene-a" data-composition-src="compositions/scene-a.html" data-start="0" data-duration="6" data-track-index="1"></div>',
        '      <audio id="narration-a" src="assets/narration-a.wav" data-start="0" data-duration="6" data-track-index="2"></audio>',
      ].join("\n")
    );
    const out = applyRootSyncHtml(html, expected);
    expect(count(out, /id="narration-a"/g)).toBe(1);
    expect(count(out, /data-composition-id="scene-a"/g)).toBe(1);
    expect(count(out, /vibe-scene-build: clip refs/g)).toBe(1);
    expect(out).toContain('id="bg-video"'); // custom (non-managed) element preserved
  });

  it("collapses an accidental second managed block", () => {
    const out = applyRootSyncHtml(shell(`${block}\n${block}`), expected);
    expect(count(out, /vibe-scene-build: clip refs/g)).toBe(1);
    expect(count(out, /id="narration-a"/g)).toBe(1);
  });

  it("is idempotent for a clean single block", () => {
    const once = applyRootSyncHtml(shell(block), expected);
    const twice = applyRootSyncHtml(once, expected);
    expect(twice).toBe(once);
    expect(count(once, /id="narration-a"/g)).toBe(1);
  });
});

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
