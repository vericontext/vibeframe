import { describe, expect, it, beforeAll } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildRenderConfig,
  defaultOutputPath,
  executeSceneRender,
  prepareBeatRenderRoot,
  qualityToCrf,
} from "./scene-render.js";
import { scaffoldSceneProject } from "./scene-project.js";
import { emitSceneHtml, insertClipIntoRoot } from "./scene-html-emit.js";
import { preflightChrome } from "../../pipeline/renderers/chrome.js";

async function makeTmp(label = "vibe-scene-render-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

function validCompositionHtml(id: string, duration: number): string {
  return `<template id="scene-${id}-template">
  <div data-composition-id="scene-${id}" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="${duration}" data-track-index="0">${id}</div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["scene-${id}"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
}

// ── qualityToCrf ────────────────────────────────────────────────────────────

describe("qualityToCrf", () => {
  it.each([
    ["draft", 28],
    ["standard", 23],
    ["high", 18],
  ] as const)("%s → %d", (q, expected) => {
    expect(qualityToCrf(q)).toBe(expected);
  });

  it("defaults to standard when no preset is given", () => {
    expect(qualityToCrf()).toBe(23);
  });
});

// ── buildRenderConfig ───────────────────────────────────────────────────────

describe("buildRenderConfig", () => {
  it("supplies producer-compatible defaults", () => {
    const cfg = buildRenderConfig({});
    expect(cfg).toEqual({
      fps: 30,
      quality: "standard",
      format: "mp4",
      entryFile: "index.html",
      crf: 23,
      workers: 1,
    });
  });

  it("propagates overrides and recomputes crf from quality", () => {
    const cfg = buildRenderConfig({ fps: 60, quality: "high", format: "webm", workers: 4, entryFile: "alt.html" });
    expect(cfg).toEqual({
      fps: 60,
      quality: "high",
      format: "webm",
      entryFile: "alt.html",
      crf: 18,
      workers: 4,
    });
  });
});

// ── defaultOutputPath ───────────────────────────────────────────────────────

describe("defaultOutputPath", () => {
  it("places output under <projectDir>/renders with project name + iso stamp", () => {
    const out = defaultOutputPath({
      projectDir: "/tmp/proj",
      projectName: "promo",
      format: "mp4",
      now: new Date("2026-04-25T12:34:56Z"),
    });
    expect(out).toBe("/tmp/proj/renders/promo-2026-04-25-12-34-56.mp4");
  });

  it("falls back to projectDir basename when no name is given", () => {
    const out = defaultOutputPath({
      projectDir: "/tmp/my-video",
      format: "webm",
      now: new Date("2026-04-25T00:00:00Z"),
    });
    expect(out).toBe("/tmp/my-video/renders/my-video-2026-04-25-00-00-00.webm");
  });

  it("defaults to mp4 when no format is given", () => {
    const out = defaultOutputPath({
      projectDir: "/tmp/p",
      projectName: "n",
      now: new Date("2026-04-25T00:00:00Z"),
    });
    expect(out.endsWith(".mp4")).toBe(true);
  });

  it("includes the beat id in default output paths for beat renders", () => {
    const out = defaultOutputPath({
      projectDir: "/tmp/proj",
      projectName: "promo",
      format: "mp4",
      beatId: "hook",
      now: new Date("2026-04-25T12:34:56Z"),
    });
    expect(out).toBe("/tmp/proj/renders/promo-hook-2026-04-25-12-34-56.mp4");
  });
});

// ── prepareBeatRenderRoot ──────────────────────────────────────────────────

describe("prepareBeatRenderRoot", () => {
  it("writes a temporary single-beat root without modifying index.html", async () => {
    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 8 });
    const originalRoot = await readFile(resolve(dir, "index.html"), "utf-8");
    await writeFile(resolve(dir, "compositions", "scene-hook.html"), validCompositionHtml("hook", 3), "utf-8");
    await writeFile(resolve(dir, "assets", "narration-hook.wav"), Buffer.from([1]));
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        beats: [
          {
            id: "hook",
            compositionPath: "compositions/scene-hook.html",
            sceneDurationSec: 3,
            narration: {
              path: "assets/narration-hook.wav",
              status: "generated",
              sceneDurationSec: 3,
            },
          },
        ],
      }),
      "utf-8"
    );

    const result = await prepareBeatRenderRoot({ projectDir: dir, beatId: "hook", aspect: "16:9" });

    expect(result.success).toBe(true);
    expect(result.root).toBe(".vibeframe/tmp/render-beat-hook.html");
    const tempRoot = await readFile(resolve(dir, result.root), "utf-8");
    expect(tempRoot).toContain('data-composition-src="compositions/scene-hook.html"');
    expect(tempRoot).toContain('src="assets/narration-hook.wav"');
    expect(tempRoot).toContain('data-duration="3"');
    expect(await readFile(resolve(dir, "index.html"), "utf-8")).toBe(originalRoot);
  });

  it("fails with BEAT_RENDER_NOT_READY when a selected beat asset is missing", async () => {
    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 3 });
    await writeFile(resolve(dir, "compositions", "scene-hook.html"), validCompositionHtml("hook", 3), "utf-8");
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        beats: [
          {
            id: "hook",
            compositionPath: "compositions/scene-hook.html",
            narrationPath: "assets/narration-hook.wav",
            narrationStatus: "generated",
          },
        ],
      }),
      "utf-8"
    );

    const result = await prepareBeatRenderRoot({ projectDir: dir, beatId: "hook", aspect: "16:9" });

    expect(result.success).toBe(false);
    expect(result.code).toBe("BEAT_RENDER_NOT_READY");
    expect(result.retryWith).toContain(`vibe build ${dir} --beat hook --stage assets --json`);
  });
});

// ── executeSceneRender — pre-Chrome failure paths ───────────────────────────
//
// These tests exercise the validation surface (project dir, root file, Chrome
// preflight) WITHOUT requiring Chrome to be installed.

describe("executeSceneRender — validation", () => {
  it("returns a structured error when the project directory doesn't exist", async () => {
    const r = await executeSceneRender({ projectDir: "/tmp/__vibe_does_not_exist__" });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Project directory not found/);
  });

  it("returns a structured error when index.html is missing", async () => {
    const dir = await makeTmp();
    const r = await executeSceneRender({ projectDir: dir });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Root composition not found/);
  });

  it("rejects unsupported composition engines before invoking Chrome", async () => {
    const dir = await makeTmp();
    await writeFile(resolve(dir, "index.html"), "<!doctype html><html><body></body></html>", "utf-8");
    await writeFile(
      resolve(dir, "vibe.project.yaml"),
      "name: fixture\ncomposition:\n  engine: remotion\n  entry: index.html\n",
      "utf-8",
    );
    const r = await executeSceneRender({ projectDir: dir });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unsupported composition engine: remotion/);
  });

  it("(without Chrome) returns the Chrome preflight reason", async () => {
    const pre = await preflightChrome();
    if (pre.ok) return; // Chrome present — Chrome-gated integration test covers the success path.

    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 4 });
    const r = await executeSceneRender({ projectDir: dir });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Chrome not found/);
  });
});

// ── executeSceneRender — Chrome-gated integration ───────────────────────────

describe("executeSceneRender — Chrome-gated render", () => {
  let chromeAvailable = false;

  beforeAll(async () => {
    chromeAvailable = (await preflightChrome()).ok;
    if (!chromeAvailable) {
      console.warn("[scene-render] Chrome not found — skipping render integration test");
    }
  });

  it("renders a 1-scene project to MP4 (requires Chrome, skipped in CI)", async () => {
    if (!chromeAvailable || process.env.CI) return;

    // Build a minimal scene project: root + one announcement scene.
    const dir = await makeTmp("vibe-scene-render-int-");
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "16:9", duration: 2 });

    let root = await readFile(resolve(dir, "index.html"), "utf-8");
    const intro = emitSceneHtml({
      id: "intro", preset: "announcement", width: 1920, height: 1080,
      duration: 1.5, headline: "Render OK",
    });
    await writeFile(resolve(dir, "compositions/scene-intro.html"), intro, "utf-8");
    root = insertClipIntoRoot(root, { id: "intro", start: 0, duration: 1.5 });
    await writeFile(resolve(dir, "index.html"), root, "utf-8");

    const out = resolve(dir, "renders", "out.mp4");
    const result = await executeSceneRender({
      projectDir: dir,
      output: "renders/out.mp4",
      fps: 30,
      quality: "draft",
      format: "mp4",
    });

    expect(result.success).toBe(true);
    expect(existsSync(out)).toBe(true);
    expect(result.fps).toBe(30);
    expect(result.quality).toBe("draft");
    expect(result.format).toBe("mp4");
    expect((result.framesRendered ?? 0)).toBeGreaterThan(0);
  }, 90_000);
});
