import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  executeSegmentsToScenes,
  sceneIdFromIndex,
  zeroPad,
} from "./segments-to-scenes.js";
import type { StoryboardSegment, NarrationEntry } from "../ai-script-pipeline.js";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function makeTmp(label = "vibe-s2s-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

/** Build a synthetic storyboard fixture without invoking Claude / OpenAI. */
function buildSegments(specs: Array<{ description: string; narration?: string; duration: number }>): StoryboardSegment[] {
  let startTime = 0;
  return specs.map((spec, i) => {
    const seg: StoryboardSegment = {
      index: i + 1,
      description: spec.description,
      visuals: spec.description,
      narration: spec.narration,
      duration: spec.duration,
      startTime,
    };
    startTime += spec.duration;
    return seg;
  });
}

/** Fake narration mp3 file (just bytes — duration parsing is bypassed in this path). */
async function writeFakeAsset(absPath: string, payload = "fake"): Promise<string> {
  await mkdir(resolve(absPath, ".."), { recursive: true });
  await writeFile(absPath, payload, "utf-8");
  return absPath;
}

// ── pure helpers ────────────────────────────────────────────────────────────

describe("zeroPad", () => {
  it.each([
    [1, 2, "01"],
    [12, 2, "12"],
    [3, 3, "003"],
    [100, 2, "100"],
  ])("zeroPad(%d, %d) → %j", (n, w, expected) => {
    expect(zeroPad(n, w)).toBe(expected);
  });
});

describe("sceneIdFromIndex", () => {
  it("produces canonical scene-NN ids", () => {
    expect(sceneIdFromIndex(1)).toBe("scene-01");
    expect(sceneIdFromIndex(7)).toBe("scene-07");
    expect(sceneIdFromIndex(42)).toBe("scene-42");
  });
});

// ── executeSegmentsToScenes — full happy path ───────────────────────────────

describe("executeSegmentsToScenes", () => {
  it("scaffolds a scene project, emits one composition per segment, and stitches the root", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([
      { description: "Welcome to VibeFrame.", narration: "VibeFrame turns scripts into video.", duration: 4 },
      { description: "Edit scenes as code.",  narration: "Each scene is an HTML file.",          duration: 3 },
    ]);

    // Pre-write the assets where the existing pipeline puts them: flat under
    // outputDir as narration-NN.mp3 / scene-NN.png. executeSegmentsToScenes
    // is responsible for relocating them into assets/.
    const narrationA = await writeFakeAsset(resolve(dir, "narration-1.mp3"));
    const narrationB = await writeFakeAsset(resolve(dir, "narration-2.mp3"));
    const imageA = await writeFakeAsset(resolve(dir, "scene-1.png"));
    const imageB = await writeFakeAsset(resolve(dir, "scene-2.png"));

    const narrationEntries: NarrationEntry[] = [
      { path: narrationA, duration: 4, segmentIndex: 0, failed: false },
      { path: narrationB, duration: 3, segmentIndex: 1, failed: false },
    ];

    const result = await executeSegmentsToScenes({
      segments,
      narrationEntries,
      imagePaths: [imageA, imageB],
      outputDir: dir,
      aspectRatio: "16:9",
      scenePreset: "explainer",
    });

    expect(result.success).toBe(true);
    expect(result.scenesEmitted).toBe(2);
    expect(result.scenePaths).toEqual([
      "compositions/scene-01.html",
      "compositions/scene-02.html",
    ]);
    expect(result.missingNarration).toEqual([]);
    expect(result.missingImage).toEqual([]);

    // Project layout
    expect(await pathExists(resolve(dir, "index.html"))).toBe(true);
    expect(await pathExists(resolve(dir, "vibe.project.yaml"))).toBe(true);
    expect(await pathExists(resolve(dir, "hyperframes.json"))).toBe(true);
    expect(await pathExists(resolve(dir, "compositions/scene-01.html"))).toBe(true);
    expect(await pathExists(resolve(dir, "compositions/scene-02.html"))).toBe(true);

    // Assets relocated
    expect(await pathExists(resolve(dir, "assets/narration-01.mp3"))).toBe(true);
    expect(await pathExists(resolve(dir, "assets/narration-02.mp3"))).toBe(true);
    expect(await pathExists(resolve(dir, "assets/scene-01.png"))).toBe(true);
    expect(await pathExists(resolve(dir, "assets/scene-02.png"))).toBe(true);
    // Originals moved out
    expect(await pathExists(narrationA)).toBe(false);
    expect(await pathExists(imageA)).toBe(false);

    // Scene HTML carries the relocated asset paths + narration text as subhead
    const scene1 = await readFile(resolve(dir, "compositions/scene-01.html"), "utf-8");
    expect(scene1).toContain('src="assets/narration-01.mp3"');
    expect(scene1).toContain('background-image: url("assets/scene-01.png")');
    expect(scene1).toContain("VibeFrame turns scripts into video.");

    // Root has both clip refs at start=0 and start=4 with grown duration.
    const root = await readFile(resolve(dir, "index.html"), "utf-8");
    expect(root).toContain('data-composition-src="compositions/scene-01.html"');
    expect(root).toContain('data-composition-src="compositions/scene-02.html"');
    expect(root).toMatch(/data-composition-id="scene-01"\s+data-composition-src="compositions\/scene-01\.html"\s+data-start="0"\s+data-duration="4"/);
    expect(root).toMatch(/data-composition-id="scene-02"\s+data-composition-src="compositions\/scene-02\.html"\s+data-start="4"\s+data-duration="3"/);
    expect(root).toContain('data-duration="7"'); // root grew to fit total 7s
  });

  it("reports missingNarration / missingImage for failed-asset segments without failing overall", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([
      { description: "Has assets.", duration: 2 },
      { description: "No assets.",  duration: 3 },
    ]);
    const narration1 = await writeFakeAsset(resolve(dir, "narration-1.mp3"));
    const image1 = await writeFakeAsset(resolve(dir, "scene-1.png"));

    const narrationEntries: NarrationEntry[] = [
      { path: narration1, duration: 2, segmentIndex: 0, failed: false },
      // Segment 2: failed narration entry
      { path: null, duration: 3, segmentIndex: 1, failed: true, error: "rate limit" },
    ];

    const result = await executeSegmentsToScenes({
      segments,
      narrationEntries,
      imagePaths: [image1, ""], // Segment 2 image gen failed → empty string
      outputDir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.scenesEmitted).toBe(2);
    expect(result.missingNarration).toEqual([2]);
    expect(result.missingImage).toEqual([2]);

    const scene2 = await readFile(resolve(dir, "compositions/scene-02.html"), "utf-8");
    expect(scene2).not.toContain("<audio");
    expect(scene2).not.toContain("background-image: url(");
  });

  it("aspect ratio drives scene + root canvas dims", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([{ description: "Vertical hook.", duration: 5 }]);
    const result = await executeSegmentsToScenes({
      segments,
      outputDir: dir,
      aspectRatio: "9:16",
    });
    expect(result.success).toBe(true);
    const scene = await readFile(resolve(dir, "compositions/scene-01.html"), "utf-8");
    expect(scene).toContain('data-width="1080"');
    expect(scene).toContain('data-height="1920"');
    const root = await readFile(resolve(dir, "index.html"), "utf-8");
    expect(root).toContain('data-width="1080"');
    expect(root).toContain('data-height="1920"');
  });

  it("the emitted project passes runProjectLint with zero errors (lint result attached)", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([
      { description: "Intro", narration: "Hello", duration: 3 },
      { description: "Outro", narration: "Bye",   duration: 2 },
    ]);

    const result = await executeSegmentsToScenes({
      segments,
      outputDir: dir,
    });

    expect(result.success).toBe(true);
    expect(result.lintResult).toBeDefined();
    expect(result.lintResult!.errorCount).toBe(0);
    expect(result.lintResult!.ok).toBe(true);
  });

  it("rejects an empty segment list", async () => {
    const dir = await makeTmp();
    const result = await executeSegmentsToScenes({ segments: [], outputDir: dir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No storyboard segments/);
  });

  it("respects scenePreset by emitting preset-specific markup", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([{ description: "Big drop.", duration: 4 }]);

    const result = await executeSegmentsToScenes({
      segments,
      outputDir: dir,
      scenePreset: "kinetic-type",
    });
    expect(result.success).toBe(true);
    const scene = await readFile(resolve(dir, "compositions/scene-01.html"), "utf-8");
    // kinetic-type emits one span per word — "Big drop" → 2 spans
    expect(scene).toContain('id="w-0"');
    expect(scene).toContain('id="w-1"');
  });

  it("is idempotent on re-run with assets already in place", async () => {
    const dir = await makeTmp();
    const segments = buildSegments([{ description: "Hi.", narration: "Hi.", duration: 3 }]);
    const narration = await writeFakeAsset(resolve(dir, "narration-1.mp3"));

    const first = await executeSegmentsToScenes({
      segments,
      narrationEntries: [{ path: narration, duration: 3, segmentIndex: 0, failed: false }],
      outputDir: dir,
    });
    expect(first.success).toBe(true);

    // Re-run: narration is already in assets/, original is gone — function
    // should silently no-op the move + re-emit the scene.
    const second = await executeSegmentsToScenes({
      segments,
      narrationEntries: [{ path: resolve(dir, "assets/narration-01.mp3"), duration: 3, segmentIndex: 0, failed: false }],
      outputDir: dir,
    });
    expect(second.success).toBe(true);
    expect(second.missingNarration).toEqual([]);
  });
});
