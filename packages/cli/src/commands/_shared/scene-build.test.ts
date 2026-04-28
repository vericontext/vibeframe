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

import { executeSceneBuild } from "./scene-build.js";

// ── Module mocks (must be hoisted before the imported module loads) ─────

vi.mock("./tts-resolve.js", () => ({
  resolveTtsProvider: vi.fn(),
  TtsKeyMissingError: class TtsKeyMissingError extends Error {},
}));

vi.mock("@vibeframe/ai-providers", () => ({
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

import { resolveTtsProvider } from "./tts-resolve.js";
import { OpenAIImageProvider } from "@vibeframe/ai-providers";
import { executeComposeScenesWithSkills } from "./compose-scenes-skills.js";
import { executeSceneRender } from "./scene-render.js";

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
  writeFileSync(join(projectDir, "index.html"), "<!doctype html><body></body>");

  vi.mocked(resolveTtsProvider).mockResolvedValue({
    provider: "kokoro",
    audioExtension: "wav",
    call: vi.fn().mockResolvedValue({
      success: true,
      audioBuffer: Buffer.from([1, 2, 3, 4]),
    }),
  });

  vi.mocked(OpenAIImageProvider).mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    generateImage: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: Buffer.from([5, 6, 7, 8]).toString("base64") }],
    }),
  } as unknown as InstanceType<typeof OpenAIImageProvider>));

  vi.mocked(executeComposeScenesWithSkills).mockResolvedValue({
    success: true,
    outputPath: projectDir,
    data: { beats: 2, written: [], totalCostUsd: 0.05, totalTokensIn: 0, totalTokensOut: 0, cacheHits: 0 },
  });

  vi.mocked(executeSceneRender).mockResolvedValue({
    success: true,
    outputPath: join(projectDir, "renders", "out.mp4"),
    audioCount: 2,
    audioMuxApplied: true,
  });

  process.env.OPENAI_API_KEY = "test-key";
  // Force the batch dispatch path so existing tests keep exercising the
  // internal-LLM compose call regardless of whether an agent host is
  // present on the developer's machine. Phase H3 dispatch behaviour is
  // covered by `scene-build-mode.test.ts`.
  process.env.VIBE_BUILD_MODE = "batch";
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.VIBE_BUILD_MODE;
});

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

  it("--skip-render runs compose but skips render", async () => {
    const r = await executeSceneBuild({ projectDir, skipRender: true });
    expect(r.success).toBe(true);
    expect(r.outputPath).toBeUndefined();
    expect(executeSceneRender).not.toHaveBeenCalled();
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
    expect(r.error).toContain("STORYBOARD.md not found");
  });

  it("returns structured failure when storyboard has no beats", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), "# Empty\n");
    const r = await executeSceneBuild({ projectDir });
    expect(r.success).toBe(false);
    expect(r.error).toContain("no `## Beat …` headings");
  });

  it("compose failure surfaces with beat outcomes preserved", async () => {
    vi.mocked(executeComposeScenesWithSkills).mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const r = await executeSceneBuild({ projectDir });
    expect(r.success).toBe(false);
    expect(r.error).toContain("compose failed: rate limited");
    expect(r.beats).toHaveLength(2); // primitives still ran
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
      expect.objectContaining({ voice: "af_heart" }),
    );
  });
});
