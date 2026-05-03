/**
 * Smoke tests for the v0.60 `vibe scene build` orchestrator. Real TTS / image
 * / compose / render calls are mocked at the module-import boundary so the
 * test verifies *fanout + idempotence + flag plumbing* without spending API
 * budget or starting Chrome.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeSceneBuild, type BuildReport } from "./scene-build.js";
import { buildEmptyRootHtml } from "./scene-project.js";

// ── Module mocks (must be hoisted before the imported module loads) ─────

vi.mock("./tts-resolve.js", () => ({
  resolveTtsProvider: vi.fn(),
  TtsKeyMissingError: class TtsKeyMissingError extends Error {},
}));

vi.mock("@vibeframe/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vibeframe/ai-providers")>()),
  GeminiProvider: vi.fn(),
  GrokProvider: vi.fn(),
  OpenAIImageProvider: vi.fn(),
}));

vi.mock("./compose-scenes-skills.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compose-scenes-skills.js")>();
  // Keep the real `buildUserPrompt` (and other pure helpers) so
  // `getComposePrompts` works, but stub the LLM-dependent
  // `executeComposeScenesWithSkills`.
  return {
    ...actual,
    executeComposeScenesWithSkills: vi.fn(),
  };
});

vi.mock("./scene-render.js", () => ({
  executeSceneRender: vi.fn(),
}));

vi.mock("../ai-video.js", () => ({
  executeVideoGenerate: vi.fn(),
}));

vi.mock("../generate/music.js", () => ({
  executeMusic: vi.fn(),
}));

import { resolveTtsProvider } from "./tts-resolve.js";
import { GeminiProvider, GrokProvider, OpenAIImageProvider } from "@vibeframe/ai-providers";
import { executeComposeScenesWithSkills } from "./compose-scenes-skills.js";
import { executeSceneRender } from "./scene-render.js";
import { executeVideoGenerate } from "../ai-video.js";
import { executeMusic } from "../generate/music.js";

const STORYBOARD_WITH_CUES = `---
project: scene-build-test
providers:
  tts: kokoro
  image: openai
voice: af_heart
---

## Beat hook — Hook

\`\`\`yaml
narration: "Type a YAML."
backdrop: "Abstract dark tech background"
duration: 3
\`\`\`

### Concept

Cold open.

## Beat close — Close

\`\`\`yaml
narration: "VibeFrame."
\`\`\`

### Concept

End frame.
`;

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "scene-build-test-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "STORYBOARD.md"), STORYBOARD_WITH_CUES);
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  writeFileSync(
    join(projectDir, "index.html"),
    buildEmptyRootHtml({ aspect: "16:9", duration: 6 })
  );

  vi.mocked(resolveTtsProvider).mockResolvedValue({
    provider: "kokoro",
    audioExtension: "wav",
    call: vi.fn().mockResolvedValue({
      success: true,
      audioBuffer: Buffer.from([1, 2, 3, 4]),
    }),
  });

  vi.mocked(OpenAIImageProvider).mockImplementation(
    () =>
      ({
        initialize: vi.fn().mockResolvedValue(undefined),
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: Buffer.from([5, 6, 7, 8]).toString("base64") }],
        }),
      }) as unknown as InstanceType<typeof OpenAIImageProvider>
  );
  vi.mocked(GeminiProvider).mockImplementation(
    () =>
      ({
        initialize: vi.fn().mockResolvedValue(undefined),
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: Buffer.from([9, 10, 11, 12]).toString("base64") }],
        }),
      }) as unknown as InstanceType<typeof GeminiProvider>
  );
  vi.mocked(GrokProvider).mockImplementation(
    () =>
      ({
        initialize: vi.fn().mockResolvedValue(undefined),
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: Buffer.from([13, 14, 15, 16]).toString("base64") }],
        }),
      }) as unknown as InstanceType<typeof GrokProvider>
  );

  vi.mocked(executeComposeScenesWithSkills).mockImplementation(async () => {
    writeFileSync(
      join(projectDir, "compositions", "scene-hook.html"),
      validCompositionHtml("hook", 3),
      "utf-8"
    );
    writeFileSync(
      join(projectDir, "compositions", "scene-close.html"),
      validCompositionHtml("close", 3),
      "utf-8"
    );
    return {
      success: true,
      outputPath: projectDir,
      data: {
        beats: 2,
        written: [
          {
            beatId: "hook",
            path: join(projectDir, "compositions", "scene-hook.html"),
            cached: false,
            cacheKey: "compose-hook-key",
            lintAttempts: 1,
            costUsd: 0.03,
          },
          {
            beatId: "close",
            path: join(projectDir, "compositions", "scene-close.html"),
            cached: true,
            cacheKey: "compose-close-key",
            lintAttempts: 1,
          },
        ],
        totalCostUsd: 0.05,
        totalTokensIn: 0,
        totalTokensOut: 0,
        cacheHits: 0,
      },
    };
  });

  vi.mocked(executeSceneRender).mockResolvedValue({
    success: true,
    outputPath: join(projectDir, "renders", "out.mp4"),
    audioCount: 2,
    audioMuxApplied: true,
  });

  process.env.OPENAI_API_KEY = "test-key";
  process.env.GOOGLE_API_KEY = "test-google-key";
  process.env.XAI_API_KEY = "test-xai-key";
  // Force the batch dispatch path so existing tests keep exercising the
  // internal-LLM compose call regardless of whether an agent host is
  // present on the developer's machine. Phase H3 dispatch behaviour is
  // covered by `scene-build-mode.test.ts`.
  process.env.VIBE_BUILD_MODE = "batch";
});

function validCompositionHtml(id: string, duration: number): string {
  return `<template id="scene-${id}-template">
  <div data-composition-id="scene-${id}" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="${duration}" data-track-index="0">${id}</div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["scene-${id}"] = tl;
    </script>
  </div>
</template>`;
}

function repairableCompositionHtml(id: string, duration: number): string {
  return validCompositionHtml(id, duration).replace('class="clip" ', "");
}

function nonRepairableCompositionHtml(id: string, duration: number): string {
  return `<template id="scene-${id}-template">
  <div data-composition-id="scene-${id}" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
    <div class="clip" data-start="0" data-duration="${duration}" data-track-index="0">${id}</div>
  </div>
</template>`;
}

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.VIBE_BUILD_MODE;
});

function readBuildReport(): BuildReport {
  return JSON.parse(readFileSync(join(projectDir, "build-report.json"), "utf-8"));
}

function expectBuildReportContract(
  report: BuildReport,
  expected: Record<string, unknown> = {}
): void {
  expect(report).toMatchObject({
    schemaVersion: "1",
    kind: "build",
    project: projectDir,
    phase: expect.any(String),
    status: expect.any(String),
    currentStage: expect.any(String),
    selectedStage: expect.any(String),
    success: expect.any(Boolean),
    estimatedCostUsd: expect.any(Number),
    costUsd: expect.any(Number),
    beats: expect.any(Array),
    beatSummary: expect.any(Object),
    jobs: expect.any(Array),
    sceneRepair: expect.objectContaining({ ran: expect.any(Boolean) }),
    stageReports: {
      assets: expect.objectContaining({ status: expect.any(String) }),
      compose: expect.objectContaining({ status: expect.any(String) }),
      sync: expect.objectContaining({ status: expect.any(String) }),
      render: expect.objectContaining({ status: expect.any(String) }),
    },
    warnings: expect.any(Array),
    retryWith: expect.any(Array),
    totalLatencyMs: expect.any(Number),
    ...expected,
  });

  for (const beat of report.beats) {
    expect(beat).toMatchObject({
      id: expect.any(String),
      startSec: expect.any(Number),
      endSec: expect.any(Number),
      sceneDurationSec: expect.any(Number),
      narration: expect.objectContaining({ status: expect.any(String) }),
      backdrop: expect.objectContaining({ status: expect.any(String) }),
      video: expect.objectContaining({ status: expect.any(String) }),
      music: expect.objectContaining({ status: expect.any(String) }),
      composition: expect.objectContaining({ status: expect.any(String) }),
    });
  }
}

describe("executeSceneBuild", () => {
  it("dispatches narration + backdrop per beat with cues, then composes + renders", async () => {
    const r = await executeSceneBuild({ projectDir });

    expect(r.success).toBe(true);
    expect(r.beats).toHaveLength(2);
    // Hook has both narration + backdrop cues
    expect(r.beats[0].narrationStatus).toBe("generated");
    expect(r.beats[0].narrationPath).toBe("assets/narration-hook.wav");
    expect(r.beats[0].backdropStatus).toBe("generated");
    expect(r.beats[0].backdropPath).toBe("assets/backdrop-hook.png");
    // Close only has narration
    expect(r.beats[1].narrationStatus).toBe("generated");
    expect(r.beats[1].backdropStatus).toBe("no-cue");

    expect(r.outputPath).toBeDefined();
    expect(executeComposeScenesWithSkills).toHaveBeenCalledOnce();
    expect(executeSceneRender).toHaveBeenCalledOnce();

    const rootHtml = readFileSync(join(projectDir, "index.html"), "utf-8");
    expect(rootHtml).toContain('id="narration-hook"');
    expect(rootHtml).toContain('data-duration="3"');

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "done",
      status: "done",
      currentStage: "done",
      selectedStage: "all",
      success: true,
    });
    expect(report.providerResolution).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "narration", resolved: "kokoro" }),
        expect.objectContaining({ kind: "backdrop", resolved: "openai" }),
      ])
    );
    expect(report.beats[0].narration).toMatchObject({
      text: "Type a YAML.",
      voice: "af_heart",
      provider: "kokoro",
      path: "assets/narration-hook.wav",
      status: "generated",
      sceneDurationSec: 3,
    });
    expect(report.beats[0]).toMatchObject({
      startSec: 0,
      endSec: 3,
      sceneDurationSec: 3,
    });
    expect(report.beats[1]).toMatchObject({
      startSec: 3,
      endSec: 6,
      sceneDurationSec: 3,
    });
    expect(report.beats[0].narration.cachePath).toContain(".vibeframe/cache/assets/narration-");
    expect(report.beats[0].backdrop).toMatchObject({
      prompt: "Abstract dark tech background",
      provider: "openai",
      path: "assets/backdrop-hook.png",
      status: "generated",
    });
    expect(report.beats[0].composition).toMatchObject({
      path: "compositions/scene-hook.html",
      exists: true,
      status: "generated",
      cacheKey: "compose-hook-key",
    });
    expect(report.stageReports).toMatchObject({
      assets: expect.objectContaining({ status: "done", costUsd: expect.any(Number) }),
      compose: expect.objectContaining({ status: "done", costUsd: expect.any(Number) }),
      sync: expect.objectContaining({ status: "done", costUsd: expect.any(Number) }),
      render: expect.objectContaining({ status: "done", costUsd: expect.any(Number) }),
    });
  });

  it("loads OPENAI_API_KEY from the current project's .env for backdrop dispatch", async () => {
    delete process.env.OPENAI_API_KEY;
    writeFileSync(join(projectDir, ".env"), "OPENAI_API_KEY=test-key-from-dotenv\n");

    const r = await executeSceneBuild({ projectDir });

    expect(r.success).toBe(true);
    expect(r.beats[0].backdropStatus).toBe("generated");
    expect(OpenAIImageProvider).toHaveBeenCalled();
  });

  it.each([
    ["gemini", GeminiProvider, [9, 10, 11, 12]],
    ["grok", GrokProvider, [13, 14, 15, 16]],
  ] as const)("dispatches backdrop generation with %s", async (imageProvider, Provider, bytes) => {
    const r = await executeSceneBuild({ projectDir, stage: "assets", imageProvider });

    expect(r.success).toBe(true);
    expect(r.beats[0].backdropStatus).toBe("generated");
    expect(Provider).toHaveBeenCalled();
    expect(OpenAIImageProvider).not.toHaveBeenCalled();
    expect(Array.from(readFileSync(join(projectDir, "assets", "backdrop-hook.png")))).toEqual(
      bytes
    );

    const metadata = JSON.parse(
      readFileSync(join(projectDir, ".vibeframe", "assets", "backdrop-hook.json"), "utf-8")
    );
    expect(metadata).toMatchObject({
      provider: imageProvider,
      options: {
        quality: "hd",
        size: "1536x1024",
        ratio: "3:2",
      },
    });
  });

  it("is idempotent: skips dispatch when asset already exists", async () => {
    // Pre-create the narration asset for hook
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "narration-hook.wav"), Buffer.from([1]));
    writeFileSync(join(projectDir, "assets", "backdrop-hook.png"), Buffer.from([2]));

    const r = await executeSceneBuild({ projectDir });

    expect(r.beats[0].narrationStatus).toBe("cached");
    expect(r.beats[0].backdropStatus).toBe("cached");
    expect(r.beats[1].narrationStatus).toBe("generated");
  });

  it("respects --force to re-dispatch even when assets exist", async () => {
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "narration-hook.wav"), Buffer.from([99]));

    await executeSceneBuild({ projectDir, force: true });

    // Force re-dispatch overwrites with mock buffer ([1,2,3,4])
    const written = readFileSync(join(projectDir, "assets", "narration-hook.wav"));
    expect(Array.from(written)).toEqual([1, 2, 3, 4]);
  });

  it("--skip-narration / --skip-backdrop short-circuit primitive dispatch", async () => {
    const r = await executeSceneBuild({
      projectDir,
      skipNarration: true,
      skipBackdrop: true,
    });

    expect(r.beats[0].narrationStatus).toBe("skipped");
    expect(r.beats[0].backdropStatus).toBe("skipped");
    expect(resolveTtsProvider).not.toHaveBeenCalled();
    expect(OpenAIImageProvider).not.toHaveBeenCalled();
  });

  it("uses referenced narration and backdrop assets without provider calls", async () => {
    mkdirSync(join(projectDir, "assets"), { recursive: true });
    writeFileSync(join(projectDir, "assets", "voice.wav"), Buffer.from([1, 2, 3]));
    writeFileSync(join(projectDir, "assets", "frame.png"), Buffer.from([4, 5, 6]));
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      `# Referenced assets

## Beat hook — Hook

\`\`\`yaml
duration: 3
narration: "assets/voice.wav"
asset: "assets/frame.png"
\`\`\`
`
    );

    const r = await executeSceneBuild({ projectDir, stage: "assets" });

    expect(r.success).toBe(true);
    expect(r.beats[0].narrationStatus).toBe("referenced");
    expect(r.beats[0].narrationPath).toBe("assets/voice.wav");
    expect(r.beats[0].narrationSourcePath).toBe("assets/voice.wav");
    expect(r.beats[0].backdropStatus).toBe("referenced");
    expect(r.beats[0].backdropPath).toBe("assets/frame.png");
    expect(r.beats[0].backdropSourcePath).toBe("assets/frame.png");
    expect(resolveTtsProvider).not.toHaveBeenCalled();
    expect(OpenAIImageProvider).not.toHaveBeenCalled();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "assets-only",
      status: "ready",
      selectedStage: "assets",
      success: true,
    });
    expect(report.providerResolution).toEqual([]);
    expect(report.beats[0].narration).toMatchObject({
      provider: "local",
      path: "assets/voice.wav",
      sourcePath: "assets/voice.wav",
      status: "referenced",
    });
    expect(report.beats[0].backdrop).toMatchObject({
      provider: "local",
      path: "assets/frame.png",
      sourcePath: "assets/frame.png",
      status: "referenced",
    });
    expect(report.beats[0].composition).toMatchObject({
      path: "compositions/scene-hook.html",
      exists: false,
      status: "skipped",
    });
  });

  it("fails invalid asset references before provider dispatch or compose", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      `# Invalid reference

## Beat hook — Hook

\`\`\`yaml
backdrop: "../outside.png"
\`\`\`
`
    );

    const r = await executeSceneBuild({ projectDir });

    expect(r.success).toBe(false);
    expect(r.phase).toBe("failed");
    expect(r.code).toBe("ASSET_REFERENCE_INVALID");
    expect(r.recoverable).toBe(true);
    expect(r.currentStage).toBe("assets");
    expect(r.retryWith).toContain(`vibe storyboard validate ${projectDir} --json`);
    expect(r.retryWith).toContain(`vibe build ${projectDir} --beat hook --stage assets --json`);
    expect(r.beats[0].backdropStatus).toBe("failed");
    expect(r.beats[0].backdropError).toBe(
      'Asset reference "../outside.png" must stay inside the project directory.'
    );
    expect(OpenAIImageProvider).not.toHaveBeenCalled();
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      success: false,
      phase: "failed",
      code: "ASSET_REFERENCE_INVALID",
      status: "failed",
      currentStage: "assets",
      selectedStage: "all",
    });
    expect(report).toMatchObject({
      success: false,
      phase: "failed",
      code: "ASSET_REFERENCE_INVALID",
      status: "failed",
      currentStage: "assets",
    });
    expect(report.beats[0].backdrop).toMatchObject({
      provider: "local",
      sourcePath: "../outside.png",
      status: "failed",
      error: 'Asset reference "../outside.png" must stay inside the project directory.',
    });
  });

  it("--skip-render runs compose but skips render", async () => {
    const r = await executeSceneBuild({ projectDir, skipRender: true });
    expect(r.success).toBe(true);
    expect(r.outputPath).toBeUndefined();
    expect(executeSceneRender).not.toHaveBeenCalled();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "sync-only",
      status: "ready",
      currentStage: "render",
      selectedStage: "sync",
      success: true,
    });
    expect(report.stageReports!.render.status).toBe("skipped");
  });

  it("writes a stable beat-only assets build-report contract", async () => {
    const r = await executeSceneBuild({
      projectDir,
      beatId: "hook",
      stage: "assets",
      skipBackdrop: true,
      skipVideo: true,
      skipMusic: true,
    });

    expect(r.success).toBe(true);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].beatId).toBe("hook");

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "assets-only",
      status: "ready",
      selectedStage: "assets",
      success: true,
    });
    expect(report.beats).toHaveLength(1);
    expect(report.beats[0]).toMatchObject({
      id: "hook",
      startSec: 0,
      endSec: 3,
      sceneDurationSec: 3,
      narration: expect.objectContaining({ status: "generated" }),
      backdrop: expect.objectContaining({ status: "skipped" }),
      video: expect.objectContaining({ status: "skipped" }),
      music: expect.objectContaining({ status: "skipped" }),
      composition: expect.objectContaining({ status: "skipped" }),
    });
    expect(report.stageReports).toMatchObject({
      assets: expect.objectContaining({ status: "done" }),
      compose: expect.objectContaining({ status: "skipped" }),
      sync: expect.objectContaining({ status: "skipped" }),
      render: expect.objectContaining({ status: "skipped" }),
    });
  });

  it("repairs mechanical composition issues before rendering", async () => {
    process.env.VIBE_BUILD_MODE = "agent";
    writeFileSync(
      join(projectDir, "compositions", "scene-hook.html"),
      repairableCompositionHtml("hook", 3),
      "utf-8"
    );
    writeFileSync(
      join(projectDir, "compositions", "scene-close.html"),
      validCompositionHtml("close", 3),
      "utf-8"
    );

    const r = await executeSceneBuild({ projectDir, mode: "agent" });

    expect(r.success).toBe(true);
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    expect(executeSceneRender).toHaveBeenCalledOnce();
    expect(r.sceneRepair?.ran).toBe(true);
    expect(r.sceneRepair?.fixed.some((item) => item.file.endsWith("scene-hook.html"))).toBe(true);

    const repaired = readFileSync(join(projectDir, "compositions", "scene-hook.html"), "utf-8");
    expect(repaired).toContain('<div class="clip" data-start="0" data-duration="3"');

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "done",
      status: "done",
      currentStage: "done",
      selectedStage: "all",
      success: true,
    });
    expect(report.sceneRepair.ran).toBe(true);
    expect(
      report.sceneRepair.fixed.some((item: { file: string }) =>
        item.file.endsWith("scene-hook.html")
      )
    ).toBe(true);
  });

  it("fails before render when scene repair leaves non-fixable lint errors", async () => {
    process.env.VIBE_BUILD_MODE = "agent";
    writeFileSync(
      join(projectDir, "compositions", "scene-hook.html"),
      nonRepairableCompositionHtml("hook", 3),
      "utf-8"
    );
    writeFileSync(
      join(projectDir, "compositions", "scene-close.html"),
      validCompositionHtml("close", 3),
      "utf-8"
    );

    const r = await executeSceneBuild({ projectDir, mode: "agent" });

    expect(r.success).toBe(false);
    expect(r.code).toBe("SCENE_REPAIR_FAILED");
    expect(r.sceneRepair?.status).toBe("fail");
    expect(r.sceneRepair?.retryWith).toContain(`vibe scene repair ${projectDir} --json`);
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    expect(executeSceneRender).not.toHaveBeenCalled();
  });

  it("does not run scene repair for assets-only builds", async () => {
    const r = await executeSceneBuild({ projectDir, stage: "assets" });
    expect(r.success).toBe(true);
    expect(r.phase).toBe("assets-only");
    expect(r.sceneRepair?.ran).toBe(false);
  });

  it("frontmatter providers.tts is used as the default when no CLI flag", async () => {
    await executeSceneBuild({ projectDir });
    expect(resolveTtsProvider).toHaveBeenCalledWith("kokoro");
  });

  it("CLI ttsProvider flag overrides frontmatter", async () => {
    await executeSceneBuild({ projectDir, ttsProvider: "elevenlabs" });
    expect(resolveTtsProvider).toHaveBeenCalledWith("elevenlabs");
  });

  it("returns structured failure when STORYBOARD.md missing", async () => {
    rmSync(join(projectDir, "STORYBOARD.md"));
    const r = await executeSceneBuild({ projectDir });
    expect(r.success).toBe(false);
    expect(r.code).toBe("STORYBOARD_VALIDATION_FAILED");
    expect(r.validation?.issues).toEqual([
      expect.objectContaining({ code: "STORYBOARD_NOT_FOUND" }),
    ]);
  });

  it("returns structured failure when storyboard has no beats", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), "# Empty\n");
    const r = await executeSceneBuild({ projectDir });
    expect(r.success).toBe(false);
    expect(r.code).toBe("STORYBOARD_VALIDATION_FAILED");
    expect(r.validation?.issues).toEqual([expect.objectContaining({ code: "NO_BEATS" })]);
  });

  it("fails validation before provider dispatch", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      `# Invalid cues

## Beat hook — Hook

\`\`\`yaml
duration: -3
narration: "This should not dispatch."
backdrop: "This should not dispatch."
\`\`\`
`
    );

    const r = await executeSceneBuild({ projectDir, maxCostUsd: 0 });

    expect(r.success).toBe(false);
    expect(r.phase).toBe("failed");
    expect(r.code).toBe("STORYBOARD_VALIDATION_FAILED");
    expect(r.validation?.ok).toBe(false);
    expect(r.validation?.issues).toEqual([
      expect.objectContaining({ code: "INVALID_DURATION", beatId: "hook" }),
    ]);
    expect(r.retryWith).toEqual([
      `vibe storyboard validate ${projectDir} --json`,
      `vibe storyboard revise ${projectDir} --from "<request>" --dry-run --json`,
    ]);
    expect(resolveTtsProvider).not.toHaveBeenCalled();
    expect(OpenAIImageProvider).not.toHaveBeenCalled();
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    expect(executeSceneRender).not.toHaveBeenCalled();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      success: false,
      phase: "failed",
      code: "STORYBOARD_VALIDATION_FAILED",
      status: "failed",
      currentStage: "assets",
    });
    expect(report.code).toBe("STORYBOARD_VALIDATION_FAILED");
    expect(report.validation!.ok).toBe(false);
    expect(report.retryWith).toEqual(r.retryWith);
  });

  it("compose failure surfaces with beat outcomes preserved", async () => {
    vi.mocked(executeComposeScenesWithSkills).mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const r = await executeSceneBuild({ projectDir });
    expect(r.success).toBe(false);
    expect(r.code).toBe("COMPOSE_FAILED");
    expect(r.currentStage).toBe("compose");
    expect(r.recoverable).toBe(true);
    expect(r.error).toContain("compose failed: rate limited");
    expect(r.retryWith).toContain(`vibe build ${projectDir} --stage compose --json`);
    expect(r.stageReports?.compose.retryWith).toContain(
      `vibe build ${projectDir} --stage compose --json`
    );
    expect(r.beats).toHaveLength(2); // primitives still ran

    const report = readBuildReport();
    expectBuildReportContract(report, {
      success: false,
      phase: "failed",
      code: "COMPOSE_FAILED",
      status: "failed",
      currentStage: "compose",
    });
    expect(report).toMatchObject({
      success: false,
      code: "COMPOSE_FAILED",
      currentStage: "compose",
    });
  });

  it("render failure surfaces a stable code and retry contract", async () => {
    vi.mocked(executeSceneRender).mockResolvedValueOnce({
      success: false,
      kind: "render",
      code: "CHROME_UNAVAILABLE",
      error: "Chrome not found",
      retryWith: ["vibe doctor --json"],
    });

    const r = await executeSceneBuild({ projectDir });

    expect(r.success).toBe(false);
    expect(r.code).toBe("CHROME_UNAVAILABLE");
    expect(r.currentStage).toBe("render");
    expect(r.recoverable).toBe(true);
    expect(r.retryWith).toEqual(
      expect.arrayContaining([
        "vibe doctor --json",
        `vibe inspect project ${projectDir} --json`,
        `vibe build ${projectDir} --stage sync --json`,
        `vibe build ${projectDir} --stage render --json`,
        `vibe render ${projectDir} --json`,
      ])
    );
    expect(r.stageReports?.render.retryWith).toContain(`vibe render ${projectDir} --json`);

    const report = readBuildReport();
    expectBuildReportContract(report, {
      success: false,
      phase: "failed",
      code: "CHROME_UNAVAILABLE",
      status: "failed",
      currentStage: "render",
    });
    expect(report).toMatchObject({
      success: false,
      code: "CHROME_UNAVAILABLE",
      currentStage: "render",
    });
  });

  it("writes a stable render-only build-report contract", async () => {
    const r = await executeSceneBuild({ projectDir, stage: "render" });

    expect(r.success).toBe(true);
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    expect(executeSceneRender).toHaveBeenCalledOnce();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "render-only",
      status: "ready",
      currentStage: "done",
      selectedStage: "render",
      success: true,
    });
    expect(report.outputPath).toBe(join(projectDir, "renders", "out.mp4"));
    expect(report.stageReports).toMatchObject({
      assets: expect.objectContaining({ status: "skipped" }),
      compose: expect.objectContaining({ status: "skipped" }),
      sync: expect.objectContaining({ status: "skipped" }),
      render: expect.objectContaining({ status: "done" }),
    });
  });

  it("propagates frontmatter voice as default when --voice not set", async () => {
    const ttsCall = vi.fn().mockResolvedValue({ success: true, audioBuffer: Buffer.from([1]) });
    vi.mocked(resolveTtsProvider).mockResolvedValue({
      provider: "kokoro",
      audioExtension: "wav",
      call: ttsCall,
    });

    await executeSceneBuild({ projectDir });

    expect(ttsCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ voice: "af_heart" })
    );
  });

  it("pauses build with job records when video and music cues start async work", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      `# Async assets

## Beat hook — Hook

\`\`\`yaml
duration: 4
video: "Slow camera push across the product."
music: "Minimal confident pulse."
\`\`\`
`
    );
    vi.mocked(executeVideoGenerate).mockResolvedValueOnce({
      success: true,
      taskId: "video_task_1",
      status: "processing",
      provider: "runway",
    });
    vi.mocked(executeMusic).mockResolvedValueOnce({
      success: true,
      taskId: "music_task_1",
      status: "processing",
      provider: "replicate",
      duration: 4,
    });

    const r = await executeSceneBuild({
      projectDir,
      videoProvider: "runway",
      musicProvider: "replicate",
    });

    expect(r.success).toBe(true);
    expect(r.phase).toBe("pending-jobs");
    expect(r.jobs).toHaveLength(2);
    expect(r.beats[0].videoStatus).toBe("pending");
    expect(r.beats[0].musicStatus).toBe("pending");
    expect(r.beats[0].videoJobId).toBeDefined();
    expect(r.beats[0].musicJobId).toBeDefined();
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    expect(executeSceneRender).not.toHaveBeenCalled();

    const report = readBuildReport();
    expectBuildReportContract(report, {
      phase: "pending-jobs",
      status: "running",
      currentStage: "assets",
      selectedStage: "all",
      success: true,
    });
    expect(report.kind).toBe("build");
    expect(report.phase).toBe("pending-jobs");
    expect(report.status).toBe("running");
    expect(report.currentStage).toBe("assets");
    expect(report.beatSummary).toMatchObject({
      total: 1,
      assetsReady: 0,
      compositionsReady: 0,
      needsAuthor: ["hook"],
    });
    expect(report.jobs).toHaveLength(2);
    expect(report.retryWith).toContain(`vibe status project ${projectDir} --refresh --json`);
  });
});
