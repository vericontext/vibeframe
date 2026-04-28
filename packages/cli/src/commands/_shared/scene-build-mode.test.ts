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

vi.mock("./tts-resolve.js", () => ({
  resolveTtsProvider: vi.fn(),
  TtsKeyMissingError: class TtsKeyMissingError extends Error {},
}));

vi.mock("@vibeframe/ai-providers", () => ({
  OpenAIImageProvider: vi.fn(),
}));

vi.mock("./compose-scenes-skills.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compose-scenes-skills.js")>();
  return {
    ...actual,
    executeComposeScenesWithSkills: vi.fn(),
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
import { executeComposeScenesWithSkills } from "./compose-scenes-skills.js";
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

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "scene-build-mode-test-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "STORYBOARD.md"), STORYBOARD);
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  writeFileSync(join(projectDir, "index.html"), "<!doctype html><body></body>");

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

  vi.mocked(executeComposeScenesWithSkills).mockResolvedValue({
    success: true,
    outputPath: projectDir,
    data: { beats: 2, written: [], totalCostUsd: 0, totalTokensIn: 0, totalTokensOut: 0, cacheHits: 0 },
  });

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
  it("explicit batch / agent passes through", () => {
    expect(resolveSceneBuildMode({ mode: "batch" })).toBe("batch");
    expect(resolveSceneBuildMode({ mode: "agent" })).toBe("agent");
  });

  it("auto picks batch when no agent hosts are detected", () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([]);
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("batch");
    // mode omitted → auto
    expect(resolveSceneBuildMode({})).toBe("batch");
  });

  it("auto picks agent when at least one host is detected", () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([
      { id: "claude-code", label: "Claude Code", detected: true, signals: [], projectFiles: [] },
    ]);
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("agent");
  });

  it("VIBE_BUILD_MODE=batch overrides explicit agent (and vice-versa)", () => {
    process.env.VIBE_BUILD_MODE = "batch";
    expect(resolveSceneBuildMode({ mode: "agent" })).toBe("batch");

    process.env.VIBE_BUILD_MODE = "agent";
    expect(resolveSceneBuildMode({ mode: "batch" })).toBe("agent");
  });

  it("VIBE_BUILD_MODE with garbage value falls through to the requested mode", () => {
    process.env.VIBE_BUILD_MODE = "nonsense";
    vi.mocked(detectedAgentHosts).mockReturnValue([]);
    expect(resolveSceneBuildMode({ mode: "auto" })).toBe("batch");
    expect(resolveSceneBuildMode({ mode: "agent" })).toBe("agent");
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
    // Internal LLM compose path NOT invoked
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
    // Render NOT invoked yet — agent must author first
    expect(executeSceneRender).not.toHaveBeenCalled();
    // Instructions present and reference scene render at the end
    expect(r.composePrompts!.instructions.some((s) => s.includes("scene render"))).toBe(true);
  });

  it("proceeds to render when all compositions/scene-*.html already exist", async () => {
    writeFileSync(join(projectDir, "compositions/scene-hook.html"), "<template/>", "utf-8");
    writeFileSync(join(projectDir, "compositions/scene-outro.html"), "<template/>", "utf-8");

    const r = await executeSceneBuild({ projectDir, mode: "agent" });
    expect(r.success).toBe(true);
    expect(r.phase).toBe("done");
    expect(r.mode).toBe("agent");
    // Internal compose still skipped — agent already authored
    expect(executeComposeScenesWithSkills).not.toHaveBeenCalled();
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

  it("VIBE_BUILD_MODE=batch overrides auto-detected agent host", async () => {
    vi.mocked(detectedAgentHosts).mockReturnValue([
      { id: "claude-code", label: "Claude Code", detected: true, signals: [], projectFiles: [] },
    ]);
    process.env.VIBE_BUILD_MODE = "batch";
    const r = await executeSceneBuild({ projectDir });
    expect(r.mode).toBe("batch");
    // Internal compose called in batch mode
    expect(executeComposeScenesWithSkills).toHaveBeenCalledOnce();
  });
});
