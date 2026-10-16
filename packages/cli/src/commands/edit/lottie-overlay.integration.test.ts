/**
 * Renders a real Lottie overlay through Chrome and FFmpeg and checks pixels,
 * not just that a file appeared: a render that drops the source video or
 * never paints the animation still produces an MP4.
 *
 * Runs wherever Chrome and FFmpeg exist (CI runners have no FFmpeg).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome } from "../../pipeline/renderers/chrome.js";
import { commandExists } from "../../utils/exec-safe.js";
import { executeMotionOverlay } from "./motion-overlay.js";
import { probeVideoStream } from "./lottie-overlay.js";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "spin-square.json");
const canRender = !!findChrome() && commandExists("ffmpeg");

/** RGB of one pixel of the frame at `time`. */
function pixel(video: string, time: number, x: number, y: number): [number, number, number] {
  const out = execFileSync("ffmpeg", [
    "-v", "error", "-ss", String(time), "-i", video, "-frames:v", "1",
    "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [out[0], out[1], out[2]];
}

const isNavy = ([r, g, b]: number[]) => r < 30 && g < 30 && b > 100 && b < 160;
const isRed = ([r, g, b]: number[]) => r > 200 && g < 90 && b < 90;

describe.skipIf(!canRender)("edit motion-overlay --asset (Chrome + FFmpeg)", () => {
  let dir: string;
  let video: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lottie-overlay-it-"));
    video = join(dir, "navy.mp4");
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=navy:s=640x360:d=3:r=25",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-shortest", "-pix_fmt", "yuv420p", "-c:a", "aac", video,
    ]);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("composites the animation over the source at the source size, inside its time window", async () => {
    const output = join(dir, "out.mp4");
    const result = await executeMotionOverlay({
      videoPath: video,
      asset: FIXTURE,
      output,
      position: "center",
      scale: 0.5,
      start: 1,
      duration: 1,
    });
    expect(result).toMatchObject({ success: true, provider: "lottie" });

    const info = await probeVideoStream(output);
    expect(info).toMatchObject({ width: 640, height: 360, fps: 25 });
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", output])
      .toString().trim().split("\n");
    expect(streams).toContain("audio");

    // Before the window: untouched source. Inside: the red square at the centre.
    expect(isNavy(pixel(output, 0.5, 320, 180))).toBe(true);
    expect(isRed(pixel(output, 1.4, 320, 180))).toBe(true);
    // The source stays visible around the overlay and after the window.
    expect(isNavy(pixel(output, 1.4, 20, 20))).toBe(true);
    expect(isNavy(pixel(output, 2.5, 320, 180))).toBe(true);
  }, 120_000);

  it("rejects a file that is not a Lottie animation without a retry hint", async () => {
    const bogus = join(dir, "bogus.lottie");
    execFileSync("sh", ["-c", `printf 'dummy lottie' > "${bogus}"`]);
    const result = await executeMotionOverlay({ videoPath: video, asset: bogus, output: join(dir, "bad.mp4") });
    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toMatch(/not a Lottie animation/);
  });
});
