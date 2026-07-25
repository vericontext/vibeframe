/**
 * Phase H3 — `vibe scene build` mode dispatch tests.
 *
 * Covers two layers:
 *   1. `resolveSceneBuildMode()` — pure function, no I/O. Verifies the
 *      env-var override + agent-host auto-detect order.
 *   2. End-to-end agent mode in `executeSceneBuild()` — runs primitives,
 *      then either returns a `needs-author` plan (compositions missing)
 *      or proceeds to lint+render (compositions already present).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executeSceneBuild, resolveSceneBuildMode } from "./scene-build.js";
import { __setFfmpegToolsForTests } from "./ffmpeg-gate.js";
import { buildEmptyRootHtml } from "./scene-project.js";

vi.mock("./tts-resolve.js", () => ({
  resolveTtsProvider: vi.fn(),
  TtsKeyMissingError: class TtsKeyMissingError extends Error {},
}));

vi.mock("@vibeframe/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibeframe/ai-providers")>();
  return {
    ...actual,
    OpenAIImageProvider: vi.fn(),
  };
});

vi.mock("./scene-render.js", () => ({
  executeSceneRender: vi.fn(),
}));

vi.mock("../../utils/agent-host-detect.js", () => ({
  detectedAgentHosts: vi.fn(),
}));

import { resolveTtsProvider } from "./tts-resolve.js";
import { OpenAIImageProvider } from "@vibeframe/ai-providers";
import { executeSceneRender } from "./scene-render.js";
import { detectedAgentHosts } from "../../utils/agent-host-detect.js";

const STORYBOARD = `## Beat hook — Hook

\`\`\`yaml
narration: "Type a YAML."
duration: 3
\`\`\`

### Concept
Cold open.

## Beat outro — Outro

\`\`\`yaml
narration: "VibeFrame."
duration: 3
\`\`\`

### Concept
End frame.
`;

let projectDir: string;
const originalBuildMode = process.env.VIBE_BUILD_MODE;

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

beforeEach(() => {
  // CI runners have no ffmpeg; these tests exercise mode dispatch, not probing.
  __setFfmpegToolsForTests(true);
  projectDir = mkdtempSync(join(tmpdir(), "scene-build-mode-test-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "STORYBOARD.md"), STORYBOARD);
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  writeFileSync(join(projectDir, "index.html"), buildEmptyRootHtml({ aspect: "16:9", duration: 6 }));

  vi.mocked(resolveTtsProvider).mockResolvedValue({
    provider: "kokoro",
    audioExtension: "wav",
    call: vi.fn().mockResolvedValue({ success: true, audioBuffer: Buffer.from([1]) }),
  });

  vi.mocked(OpenAIImageProvider).mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    generateImage: vi.fn().mockResolvedValue({
      success: true,
      images: [{ base64: Buffer.from([5]).toString("base64") }],
    }),
  } as unknown as InstanceType<typeof OpenAIImageProvider>));

  vi.mocked(executeSceneRender).mockResolvedValue({
    success: true,
    outputPath: join(projectDir, "renders", "out.mp4"),
    audioCount: 0,
    audioMuxApplied: true,
  });

  vi.mocked(detectedAgentHosts).mockReturnValue([]);

  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.VIBE_BUILD_MODE;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  vi.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  if (originalBuildMode === undefined) delete process.env.VIBE_BUILD_MODE;
  else process.env.VIBE_BUILD_MODE = originalBuildMode;
});

describe("resolveSceneBuildMode", () => {
  // The CLI-internal LLM composer is gone, so `agent` is the only
  // model-authored path. Nothing selects `batch` any more except
  // `--composer template`, which scene-build handles before asking here.
  it("always resolves to agent", () => {
    expect(resolveSceneBuildMode({ mode: "agent" })).toBe("agent");
    expect(resolveSceneBuildMode({ mode: "batch" })).toBe("agent");
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("agent");
    expect(resolveSceneBuildMode({})).toBe("agent");
  });

  it("ignores VIBE_BUILD_MODE, including a batch request", () => {
    process.env.VIBE_BUILD_MODE = "batch";
    expect(resolveSceneBuildMode({ mode: "agent" })).toBe("agent");
    expect(resolveSceneBuildMode({})).toBe("agent");

    process.env.VIBE_BUILD_MODE = "nonsense";
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("agent");
  });

  it("does not depend on host detection", () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([]);
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("agent");
  });
});

describe("executeSceneBuild — agent mode dispatch", () => {
  it("returns a needs-author plan when compositions/scene-*.html are missing", async () => {
    const r = await executeSceneBuild({ projectDir, mode: "agent" });
    expect(r.success).toBe(true);
    expect(r.phase).toBe("needs-author");
    expect(r.mode).toBe("agent");
    expect(r.composePrompts).toBeDefined();
    // Both beats reported with exists:false
    expect(r.composePrompts!.beats).toHaveLength(2);
    expect(r.composePrompts!.beats.every((b) => !b.exists)).toBe(true);
    // Render NOT invoked yet — agent must author first
    expect(executeSceneRender).not.toHaveBeenCalled();
    // Instructions present and reference the top-level render command at the end
    expect(r.composePrompts!.instructions.some((s) => s.includes("vibe render"))).toBe(true);
  });

  it("proceeds to render when all compositions/scene-*.html already exist", async () => {
    writeFileSync(join(projectDir, "compositions/scene-hook.html"), validCompositionHtml("hook", 3), "utf-8");
    writeFileSync(join(projectDir, "compositions/scene-outro.html"), validCompositionHtml("outro", 3), "utf-8");

    const r = await executeSceneBuild({ projectDir, mode: "agent" });
    expect(r.success).toBe(true);
    expect(r.phase).toBe("done");
    expect(r.mode).toBe("agent");
    // Render fired
    expect(executeSceneRender).toHaveBeenCalledOnce();
    expect(r.outputPath).toBe(join(projectDir, "renders", "out.mp4"));
  });

  it("auto resolves to agent when host is detected and compositions are missing", async () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([
      { id: "claude-code", label: "Claude Code", detected: true, signals: [], projectFiles: [] },
    ]);
    const r = await executeSceneBuild({ projectDir }); // no mode flag
    expect(r.mode).toBe("agent");
    expect(r.phase).toBe("needs-author");
  });

  it("VIBE_BUILD_MODE=batch no longer buys a model-authored build", async () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([
      { id: "claude-code", label: "Claude Code", detected: true, signals: [], projectFiles: [] },
    ]);
    process.env.VIBE_BUILD_MODE = "batch";
    const r = await executeSceneBuild({ projectDir });
    expect(r.mode).toBe("agent");
    expect(r.phase).toBe("needs-author");
  });
});
