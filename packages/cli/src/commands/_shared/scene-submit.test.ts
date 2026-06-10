import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeSceneSubmit } from "./scene-submit.js";

let projectDir: string;

const STORYBOARD = `---
title: submit-test
duration: 8
aspect: 16:9
---

# Storyboard

## Beat hook — Hook

\`\`\`yaml
narration: "Test narration."
duration: 4
\`\`\`

Hook beat.

## Beat close — Close

\`\`\`yaml
duration: 4
\`\`\`

Close beat.
`;

function validSceneHtml(beatId: string, durationSec = 4): string {
  const id = `scene-${beatId}`;
  return `<template id="${id}-template">
  <div data-composition-id="${id}" data-start="0" data-duration="${durationSec}" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="${id}"] { position: relative; width: 1920px; height: 1080px; background: #111; overflow: hidden; }
      [data-composition-id="${id}"] .clip { position: absolute; inset: 0; }
    </style>
    <div class="clip" data-start="0" data-duration="${durationSec}" data-track-index="0">
      <h1>Hello</h1>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(".clip h1", { opacity: 0.9 }, { opacity: 1, duration: ${durationSec}, ease: "none" }, 0);
      window.__timelines["${id}"] = tl;
    </script>
  </div>
</template>`;
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "vibe-scene-submit-"));
  await writeFile(join(projectDir, "STORYBOARD.md"), STORYBOARD, "utf-8");
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("executeSceneSubmit", () => {
  it("writes a valid scene and reports clean lint", async () => {
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: validSceneHtml("hook"),
    });
    expect(result.success).toBe(true);
    expect(result.written).toBe(true);
    expect(result.lint.errorCount).toBe(0);
    expect(result.scenePath).toBe("compositions/scene-hook.html");
    const onDisk = await readFile(join(projectDir, "compositions", "scene-hook.html"), "utf-8");
    expect(onDisk).toContain('data-composition-id="scene-hook"');
  });

  it("accepts a ```html fenced submission", async () => {
    const fenced = "```html\n" + validSceneHtml("hook") + "\n```";
    const result = await executeSceneSubmit({ projectDir, beatId: "hook", html: fenced });
    expect(result.success).toBe(true);
    expect(result.written).toBe(true);
    const onDisk = await readFile(join(projectDir, "compositions", "scene-hook.html"), "utf-8");
    expect(onDisk.startsWith("<template")).toBe(true);
    expect(onDisk).not.toContain("```");
  });

  it("rejects lint-error HTML without writing", async () => {
    // No window.__timelines registration → lint error from the producer.
    const broken = `<template id="scene-hook-template">
  <div data-composition-id="scene-hook" data-start="0" data-duration="4" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="4" data-track-index="0"><h1>x</h1></div>
  </div>
</template>`;
    const result = await executeSceneSubmit({ projectDir, beatId: "hook", html: broken });
    expect(result.success).toBe(false);
    expect(result.written).toBe(false);
    expect(result.lint.errorCount).toBeGreaterThan(0);
    expect(result.lint.findings.length).toBeGreaterThan(0);
    expect(existsSync(join(projectDir, "compositions", "scene-hook.html"))).toBe(false);
  });

  it("rejects unknown beats with the available ids", async () => {
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "nope",
      html: validSceneHtml("nope"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Beat "nope" not found');
    expect(result.error).toContain("hook, close");
  });

  it("rejects non-HTML content with a clear error", async () => {
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: "Sure! Here is the scene you asked for.",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("does not look like HTML");
  });

  it("validateOnly lints without writing", async () => {
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: validSceneHtml("hook"),
      validateOnly: true,
    });
    expect(result.success).toBe(true);
    expect(result.written).toBe(false);
    expect(existsSync(join(projectDir, "compositions", "scene-hook.html"))).toBe(false);
  });

  it("overwrites an existing scene on resubmission", async () => {
    await mkdir(join(projectDir, "compositions"), { recursive: true });
    await writeFile(join(projectDir, "compositions", "scene-hook.html"), "<template>old</template>", "utf-8");
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: validSceneHtml("hook"),
    });
    expect(result.success).toBe(true);
    const onDisk = await readFile(join(projectDir, "compositions", "scene-hook.html"), "utf-8");
    expect(onDisk).toContain("__timelines");
  });

  it("warns when data-duration disagrees with the narration-synced duration", async () => {
    // build-report carries sceneDurationSec=9.5 while the scene declares 4s.
    await writeFile(
      join(projectDir, "build-report.json"),
      JSON.stringify({ beats: [{ id: "hook", sceneDurationSec: 9.5 }] }),
      "utf-8"
    );
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: validSceneHtml("hook", 4),
    });
    expect(result.success).toBe(true);
    expect(result.warnings.join(" ")).toContain("narration-synced beat duration is 9.5");
  });

  it("rejects internal phase clips with the shared lint contract", async () => {
    const phased = `<template id="scene-hook-template">
  <div data-composition-id="scene-hook" data-start="0" data-duration="4" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="2" data-track-index="0"><h1>A</h1></div>
    <div class="clip" data-start="2" data-duration="2" data-track-index="0"><h1>B</h1></div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("h1", { opacity: 0.9 }, { opacity: 1, duration: 4, ease: "none" }, 0);
      window.__timelines["scene-hook"] = tl;
    </script>
  </div>
</template>`;
    const result = await executeSceneSubmit({ projectDir, beatId: "hook", html: phased });
    expect(result.success).toBe(false);
    expect(result.written).toBe(false);
    expect(result.lint.findings.map((f) => f.code)).toContain("internal_phase_clip_unsupported");
  });

  it("fails cleanly when STORYBOARD.md is missing", async () => {
    await rm(join(projectDir, "STORYBOARD.md"));
    const result = await executeSceneSubmit({
      projectDir,
      beatId: "hook",
      html: validSceneHtml("hook"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("STORYBOARD.md not found");
  });
});
