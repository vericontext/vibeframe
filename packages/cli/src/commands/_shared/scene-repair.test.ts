import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scaffoldSceneProject } from "./scene-project.js";
import { executeSceneRepair } from "./scene-repair.js";

async function makeBrokenProject(): Promise<{ dir: string; badPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-scene-repair-"));
  await scaffoldSceneProject({ dir, name: "repair", aspect: "16:9", duration: 6 });
  const badPath = resolve(dir, "compositions/scene-bad.html");
  await writeFile(
    badPath,
    `<template id="bad-template">
  <div data-composition-id="bad" data-start="0" data-duration="3" data-width="1920" data-height="1080">
    <div data-start="0" data-duration="2" data-track-index="1">no class</div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["bad"] = tl;
    </script>
  </div>
</template>`,
    "utf-8"
  );
  return { dir, badPath };
}

describe("executeSceneRepair", () => {
  it("dry-run reports wouldFix without mutating files", async () => {
    const { dir, badPath } = await makeBrokenProject();
    const before = await readFile(badPath, "utf-8");
    const result = await executeSceneRepair({ projectDir: dir, dryRun: true });
    const after = await readFile(badPath, "utf-8");

    expect(result.dryRun).toBe(true);
    expect(result.wouldFix.some((item) => item.file.endsWith("scene-bad.html"))).toBe(true);
    expect(result.fixed).toEqual([]);
    expect(result.remainingIssues.every((issue) => issue.fixOwner === "host-agent")).toBe(true);
    expect(after).toBe(before);
  });

  it("applies deterministic fixes and re-lints the repaired HTML", async () => {
    const { dir, badPath } = await makeBrokenProject();
    const result = await executeSceneRepair({ projectDir: dir });
    const after = await readFile(badPath, "utf-8");

    expect(result.fixed.some((item) => item.file.endsWith("scene-bad.html"))).toBe(true);
    expect(after).toContain('<div class="clip" data-start="0" data-duration="2"');
    expect(
      result.remainingIssues.some(
        (issue) => issue.code === "SCENE_LINT_timed_element_missing_clip_class"
      )
    ).toBe(false);
  });

  it("can repair only sub-compositions when root lint is intentionally deferred", async () => {
    const { dir, badPath } = await makeBrokenProject();
    await writeFile(resolve(dir, "index.html"), "<!doctype html><body></body>", "utf-8");

    const result = await executeSceneRepair({ projectDir: dir, includeRoot: false });
    const after = await readFile(badPath, "utf-8");

    expect(result.fixed.some((item) => item.file.endsWith("scene-bad.html"))).toBe(true);
    expect(after).toContain('<div class="clip" data-start="0" data-duration="2"');
    expect(result.files.some((file) => file.file === "index.html")).toBe(false);
  });

  it("repairs root clip refs, narration audio wiring, and duration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-scene-repair-root-"));
    await scaffoldSceneProject({ dir, name: "repair-root", aspect: "16:9", duration: 1 });
    await mkdir(resolve(dir, "compositions"), { recursive: true });
    await writeFile(
      resolve(dir, "compositions", "scene-hook.html"),
      "<template></template>",
      "utf-8"
    );
    await writeFile(
      resolve(dir, "compositions", "scene-close.html"),
      "<template></template>",
      "utf-8"
    );
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Root sync

## Beat hook - Hook

\`\`\`yaml
duration: 3
narration: "Hello."
\`\`\`

## Beat close - Close

\`\`\`yaml
duration: 2
\`\`\`
`,
      "utf-8"
    );
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        beats: [
          {
            id: "hook",
            sceneDurationSec: 4,
            narration: { path: "assets/narration-hook.wav", sceneDurationSec: 4 },
          },
          { id: "close", sceneDurationSec: 2 },
        ],
      }),
      "utf-8"
    );

    const result = await executeSceneRepair({ projectDir: dir });
    const root = await readFile(resolve(dir, "index.html"), "utf-8");

    expect(result.fixed).toContainEqual(
      expect.objectContaining({
        file: "index.html",
        codes: expect.arrayContaining([
          "root_clip_refs_synced",
          "root_duration_synced",
          "root_narration_audio_synced",
        ]),
      })
    );
    expect(root).toContain('data-composition-src="compositions/scene-hook.html"');
    expect(root).toContain('id="narration-hook" src="assets/narration-hook.wav"');
    expect(root).toContain('id="root"');
    expect(root).toContain('data-duration="6"');
  });
});
