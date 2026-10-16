/**
 * Renders a two-scene project whose second scene carries a Lottie overlay
 * and reads where the animation actually is in each frame. A broken overlay
 * still produces an MP4, and an autoplaying one still paints something, so
 * only the position at a known time proves the frames follow the render.
 *
 * Runs wherever Chrome and FFmpeg exist (CI runners have no FFmpeg).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome } from "../../pipeline/renderers/chrome.js";
import { commandExists } from "../../utils/exec-safe.js";
import { executeSceneAdd } from "../scene.js";
import { executeSceneRender } from "./scene-render.js";
import { scaffoldSceneProject } from "./scene-project.js";

const canRender = !!findChrome() && commandExists("ffmpeg");

/** 1920x1080 Lottie: a 120px red square slides from x=60 to x=1860 over 3s, at y=540. */
function slidingSquare(): object {
  const square = {
    ty: "gr",
    it: [
      { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [120, 120] }, r: { a: 0, k: 0 } },
      { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
      { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ],
  };
  const position = {
    a: 1,
    k: [
      { t: 0, s: [60, 540, 0], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } },
      { t: 90, s: [1860, 540, 0] },
    ],
  };
  return {
    v: "5.7.0", fr: 30, ip: 0, op: 90, w: 1920, h: 1080, nm: "slide", ddd: 0, assets: [],
    layers: [{
      ddd: 0, ind: 1, ty: 4, nm: "square", sr: 1, ao: 0, ip: 0, op: 90, st: 0,
      ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: position, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      shapes: [square],
    }],
  };
}

/** Centre x of the red pixels on row y=540 of the frame at `time`, or null. */
function squareX(video: string, time: number): number | null {
  const row = execFileSync("ffmpeg", [
    "-v", "error", "-ss", String(time), "-i", video, "-frames:v", "1",
    "-vf", "format=rgb24,crop=1920:1:0:540", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  const red: number[] = [];
  for (let x = 0; x < 1920; x++) {
    const [r, g, b] = [row[3 * x], row[3 * x + 1], row[3 * x + 2]];
    if (r > 150 && g < 60 && b < 60) red.push(x);
  }
  return red.length > 0 ? (red[0] + red[red.length - 1]) / 2 : null;
}

describe.skipIf(!canRender)("scene add --lottie (Chrome + FFmpeg)", () => {
  let dir: string;
  let lottie: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "scene-lottie-it-"));
    lottie = join(dir, "slide.json");
    writeFileSync(lottie, JSON.stringify(slidingSquare()));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("draws the frame for the scene-local render time", async () => {
    const project = join(dir, "project");
    await scaffoldSceneProject({ dir: project, name: "lottie", aspect: "16:9", duration: 5 });
    const common = { preset: "simple" as const, projectDir: project, skipAudio: true, skipImage: true, skipTranscribe: true };
    expect(await executeSceneAdd({ ...common, name: "intro", duration: 2 })).toMatchObject({ success: true, start: 0 });
    expect(
      await executeSceneAdd({ ...common, name: "slide", duration: 3, lottie: { src: lottie, position: "full", loop: false } })
    ).toMatchObject({ success: true, start: 2 });

    const render = await executeSceneRender({ projectDir: project, output: "out.mp4", quality: "draft" });
    expect(render.success, render.error).toBe(true);
    const video = join(project, "out.mp4");

    // Nothing before the Lottie scene starts.
    expect(squareX(video, 1)).toBeNull();
    // Scene-local 0.5s and 2s: x = 60 + 1800 * t / 3.
    expect(squareX(video, 2.5)).toBeCloseTo(360, -1);
    expect(squareX(video, 4)).toBeCloseTo(1260, -1);
  }, 180_000);
});
