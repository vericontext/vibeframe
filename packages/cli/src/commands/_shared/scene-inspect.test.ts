import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { inspectProject } from "./scene-inspect.js";
import { projectConfigJson } from "./project-config.js";

async function makeTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vibe-scene-inspect-"));
}

describe("inspectProject", () => {
  it("reports missing compositions and writes review-report.json by default", async () => {
    const dir = await makeTmp();
    await writeFile(
      resolve(dir, "vibe.config.json"),
      projectConfigJson({ name: "promo" }),
      "utf-8"
    );
    await writeFile(resolve(dir, "DESIGN.md"), "# Design\n", "utf-8");
    await writeFile(
      resolve(dir, "index.html"),
      "<!doctype html><html><body></body></html>",
      "utf-8"
    );
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 3
narration: "Hello."
\`\`\`

Body.
`,
      "utf-8"
    );

    const result = await inspectProject({ projectDir: dir });
    expect(result.status).toBe("fail");
    expect(result.checks.storyboard.beatCount).toBe(1);
    expect(result.checks.compositions.missing).toEqual(["compositions/scene-hook.html"]);
    expect(result.issues.some((issue) => issue.code === "MISSING_COMPOSITION")).toBe(true);
    expect(result.reportPath).toBe(resolve(dir, "review-report.json"));
  });

  it("returns a structured failure when the project directory is missing", async () => {
    const result = await inspectProject({
      projectDir: resolve(await makeTmp(), "missing"),
      writeReport: false,
    });
    expect(result.status).toBe("fail");
    expect(result.issues[0].code).toBe("PROJECT_NOT_FOUND");
    expect(result.retryWith[0]).toContain("vibe init");
  });

  it("checks video, music, and job asset paths from build-report.json", async () => {
    const dir = await makeTmp();
    await writeFile(
      resolve(dir, "vibe.config.json"),
      projectConfigJson({ name: "promo" }),
      "utf-8"
    );
    await writeFile(resolve(dir, "DESIGN.md"), "# Design\n", "utf-8");
    await writeFile(
      resolve(dir, "index.html"),
      "<!doctype html><html><body></body></html>",
      "utf-8"
    );
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 3
video: "Camera push."
music: "Pulse."
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
            videoPath: "assets/video-hook.mp4",
            musicPath: "assets/music-hook.mp3",
          },
        ],
        jobs: [
          {
            id: "job_video",
            beatId: "hook",
            outputPath: "assets/video-hook.mp4",
            cachePath: ".vibeframe/cache/assets/video-hook.mp4",
          },
        ],
      }),
      "utf-8"
    );

    const result = await inspectProject({ projectDir: dir, writeReport: false });

    expect(result.checks.assets.checked).toBe(4);
    expect(result.checks.assets.missing).toContain("assets/video-hook.mp4");
    expect(result.checks.assets.missing).toContain("assets/music-hook.mp3");
    expect(result.checks.assets.missing).toContain(".vibeframe/cache/assets/video-hook.mp4");
    expect(result.issues.some((issue) => issue.message.includes("videoPath"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("job job_video cachePath"))).toBe(
      true
    );
  });

  it("limits composition and build-report checks to the selected beat", async () => {
    const dir = await makeTmp();
    await writeFile(
      resolve(dir, "vibe.config.json"),
      projectConfigJson({ name: "promo" }),
      "utf-8"
    );
    await writeFile(resolve(dir, "DESIGN.md"), "# Design\n", "utf-8");
    await writeFile(
      resolve(dir, "index.html"),
      "<!doctype html><html><body></body></html>",
      "utf-8"
    );
    await writeFile(
      resolve(dir, "STORYBOARD.md"),
      `# Promo

## Beat hook - Hook

\`\`\`yaml
duration: 3
narration: "Hello."
\`\`\`

## Beat close - Close

\`\`\`yaml
duration: 2
narration: "Goodbye."
\`\`\`
`,
      "utf-8"
    );
    await mkdir(resolve(dir, "compositions"), { recursive: true });
    await writeFile(resolve(dir, "compositions", "scene-hook.html"), "<template></template>", "utf-8");
    await writeFile(
      resolve(dir, "build-report.json"),
      JSON.stringify({
        schemaVersion: "1",
        kind: "build",
        beats: [
          {
            id: "hook",
            compositionPath: "compositions/scene-hook.html",
            narration: { path: "assets/narration-hook.wav", status: "generated" },
          },
          {
            id: "close",
            compositionPath: "compositions/scene-close.html",
            narration: { path: "assets/narration-close.wav", status: "generated" },
          },
        ],
      }),
      "utf-8"
    );

    const result = await inspectProject({ projectDir: dir, beatId: "hook", writeReport: false });

    expect(result.beat).toBe("hook");
    expect(result.checks.storyboard.beatCount).toBe(2);
    expect(result.checks.compositions.expected).toBe(1);
    expect(result.checks.compositions.missing).toEqual([]);
    expect(result.issues.some((issue) => issue.scene === "close")).toBe(false);
    expect(result.checks.assets.missing).toContain("assets/narration-hook.wav");
    expect(result.checks.assets.missing).not.toContain("assets/narration-close.wav");
  });
});
