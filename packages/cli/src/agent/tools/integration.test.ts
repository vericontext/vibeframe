/**
 * Integration Tests: CLI ↔ Agent Tool Synchronization
 *
 * These tests verify that:
 * 1. All Agent tools are properly registered
 * 2. Agent tools correctly wrap CLI functions
 * 3. Parameter schemas match between CLI and Agent
 * 4. Tool handlers produce expected output formats
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "./index.js";
import { manifest } from "../../tools/manifest/index.js";
import { registerManifestIntoAgent } from "../../tools/adapters/agent.js";
// Mock the imported CLI functions to avoid actual API calls
vi.mock("../../commands/ai-script-pipeline.js", () => ({
  executeRegenerateScene: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../commands/ai-highlights.js", () => ({
  executeHighlights: vi.fn().mockResolvedValue({
    success: true,
    highlights: [
      {
        index: 1,
        startTime: 10,
        endTime: 25,
        duration: 15,
        category: "emotional",
        confidence: 0.95,
        reason: "Test highlight",
        transcript: "Test transcript",
      },
    ],
    totalDuration: 120,
    totalHighlightDuration: 15,
  }),
  executeAutoShorts: vi.fn().mockResolvedValue({
    success: true,
    shorts: [
      {
        index: 1,
        startTime: 30,
        endTime: 60,
        duration: 30,
        confidence: 0.9,
        reason: "Viral moment",
        outputPath: "/test/short-1.mp4",
      },
    ],
  }),
}));

vi.mock("../../commands/ai-animated-caption.js", () => ({
  executeAnimatedCaption: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/captioned.mp4",
    wordCount: 42,
    groupCount: 10,
    style: "highlight",
    tier: "remotion",
  }),
}));

vi.mock("../../commands/ai-analyze.js", () => ({
  executeGeminiVideo: vi.fn().mockResolvedValue({
    success: true,
    response: "This is a test video summary.",
    model: "gemini-3-flash-preview",
    totalTokens: 1000,
  }),
  executeAnalyze: vi.fn().mockResolvedValue({
    success: true,
    response: "Test analysis",
  }),
}));

vi.mock("../../commands/ai-edit.js", () => ({
  executeSilenceCut: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-cut.mp4",
    totalDuration: 120,
    silentPeriods: [
      { start: 10, end: 15, duration: 5 },
      { start: 60, end: 63, duration: 3 },
    ],
    silentDuration: 8,
  }),
  executeJumpCut: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-jumpcut.mp4",
    totalDuration: 120,
    fillerCount: 5,
    fillerDuration: 3.2,
    fillers: [
      { word: "um", start: 5.1, end: 5.6 },
      { word: "like", start: 12.3, end: 12.8 },
    ],
  }),
  executeCaption: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-captioned.mp4",
    srtPath: "/test/video-captioned.srt",
    segmentCount: 12,
  }),
  executeNoiseReduce: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/audio-denoised.mp4",
    inputDuration: 60,
  }),
  executeFade: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-faded.mp4",
    totalDuration: 120,
    fadeInApplied: true,
    fadeOutApplied: true,
  }),
  executeTranslateSrt: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/subtitles-ko.srt",
    segmentCount: 20,
    sourceLanguage: "en",
    targetLanguage: "ko",
  }),
  executeTextOverlay: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-overlay.mp4",
  }),
  DEFAULT_FILLER_WORDS: ["um", "uh", "like", "you know"],
  detectFillerRanges: vi.fn(),
}));

vi.mock("../../commands/ai-review.js", () => ({
  executeReview: vi.fn().mockResolvedValue({
    success: true,
    issues: [],
  }),
}));

vi.mock("../../commands/ai-image.js", () => ({
  executeThumbnailBestFrame: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/video-thumbnail.png",
    timestamp: 15.5,
    reason: "Best composed frame",
  }),
  executeGeminiEdit: vi.fn().mockResolvedValue({
    success: true,
    outputPath: "/test/edited.png",
  }),
}));

describe("CLI ↔ Agent Tool Synchronization", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
  });

  describe("Tool Registration", () => {
    it("should register the full manifest", () => {
      // Manifest is the single source of truth post-v0.67 PR2.
      const tools = registry.getAll();
      expect(tools.length).toBe(84);
    });

    it("should register all project tools (5)", () => {
      const projectTools = [
        "project_create",
        "project_info",
        "project_set",
        "project_open",
        "project_save",
      ];
      for (const name of projectTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all timeline tools (11)", () => {
      const timelineTools = [
        "timeline_add_source",
        "timeline_add_clip",
        "timeline_add_track",
        "timeline_add_effect",
        "timeline_trim_clip",
        "timeline_split_clip",
        "timeline_move_clip",
        "timeline_clear",
        "timeline_delete_clip",
        "timeline_duplicate_clip",
        "timeline_list",
      ];
      for (const name of timelineTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all filesystem tools (4)", () => {
      const fsTools = ["fs_list", "fs_read", "fs_write", "fs_exists"];
      for (const name of fsTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all media tools (8)", () => {
      const mediaTools = [
        "media_info",
        "detect_scenes",
        "detect_silence",
        "detect_beats",
        "audio_transcribe",
        "media_compress",
        "media_convert",
        "media_concat",
      ];
      for (const name of mediaTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all batch tools (3)", () => {
      const batchTools = [
        "batch_import",
        "batch_concat",
        "batch_apply_effect",
      ];
      for (const name of batchTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all AI tools (23)", () => {
      const aiTools = [
        // Generation tools (8)
        "generate_image",
        "generate_video",
        "generate_speech",
        "generate_sound_effect",
        "generate_music",
        "generate_storyboard",
        "generate_motion",
        "generate_thumbnail",
        // Edit tools (8)
        "edit_text_overlay",
        "edit_silence_cut",
        "edit_jump_cut",
        "edit_caption",
        "edit_noise_reduce",
        "edit_fade",
        "edit_translate_srt",
        "edit_image",
        // Analyze tools (3)
        "inspect_review",
        "inspect_video",
        "inspect_media",
        // Pipeline tools (3)
        "remix_highlights",
        "remix_auto_shorts",
        "remix_regenerate_scene",
      ];
      for (const name of aiTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });

    it("should register all export tools (3)", () => {
      const exportTools = ["export_video", "export_audio", "export_subtitles"];
      for (const name of exportTools) {
        expect(registry.get(name)).toBeDefined();
      }
    });
  });

  describe("Tool Definition Schema Validation", () => {
    it("all tools should have valid definitions", () => {
      const tools = registry.getAll();
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties).toBeDefined();
      }
    });

    it("all tools should have required parameters listed", () => {
      const tools = registry.getAll();
      for (const tool of tools) {
        if (tool.parameters.required && tool.parameters.required.length > 0) {
          for (const requiredParam of tool.parameters.required) {
            expect(tool.parameters.properties[requiredParam]).toBeDefined();
          }
        }
      }
    });

    it("all parameter properties should have type and description", () => {
      const tools = registry.getAll();
      for (const tool of tools) {
        for (const paramDef of Object.values(
          tool.parameters.properties
        )) {
          const param = paramDef as { type?: string; description?: string };
          expect(param.type).toBeTruthy();
          expect(param.description).toBeTruthy();
        }
      }
    });
  });

  describe("AI Pipeline Tools - Parameter Mapping", () => {
    describe("remix_highlights", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("remix_highlights");
        expect(tool).toBeDefined();

        const params = tool!.parameters.properties;
        // Required
        expect(params.media).toBeDefined();
        // Optional (matching CLI options)
        expect(params.output).toBeDefined();
        expect(params.project).toBeDefined();
        expect(params.duration).toBeDefined();
        expect(params.count).toBeDefined();
        expect(params.threshold).toBeDefined();
        expect(params.criteria).toBeDefined();
        expect(params.language).toBeDefined();
        expect(params.useGemini).toBeDefined();
        expect(params.lowRes).toBeDefined();
      });

      it("should have correct enum values for criteria", () => {
        const tool = registry.get("remix_highlights");
        const criteria = tool!.parameters.properties.criteria as {
          enum?: string[];
        };
        expect(criteria.enum).toContain("emotional");
        expect(criteria.enum).toContain("informative");
        expect(criteria.enum).toContain("funny");
        expect(criteria.enum).toContain("all");
      });
    });

    describe("remix_auto_shorts", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("remix_auto_shorts");
        expect(tool).toBeDefined();

        const params = tool!.parameters.properties;
        // Required
        expect(params.video).toBeDefined();
        // Optional (matching CLI options)
        expect(params.outputDir).toBeDefined();
        expect(params.duration).toBeDefined();
        expect(params.count).toBeDefined();
        expect(params.aspect).toBeDefined();
        expect(params.addCaptions).toBeDefined();
        expect(params.captionStyle).toBeDefined();
        expect(params.analyzeOnly).toBeDefined();
        expect(params.language).toBeDefined();
        expect(params.useGemini).toBeDefined();
        expect(params.lowRes).toBeDefined();
      });

      it("should have correct enum values for aspect", () => {
        const tool = registry.get("remix_auto_shorts");
        const aspect = tool!.parameters.properties.aspect as { enum?: string[] };
        expect(aspect.enum).toContain("9:16");
        expect(aspect.enum).toContain("1:1");
      });

      it("should have correct enum values for captionStyle", () => {
        const tool = registry.get("remix_auto_shorts");
        const captionStyle = tool!.parameters.properties.captionStyle as {
          enum?: string[];
        };
        expect(captionStyle.enum).toContain("minimal");
        expect(captionStyle.enum).toContain("bold");
        expect(captionStyle.enum).toContain("animated");
      });
    });

    describe("inspect_video", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("inspect_video");
        expect(tool).toBeDefined();

        const params = tool!.parameters.properties;
        // Required
        expect(params.source).toBeDefined();
        expect(params.prompt).toBeDefined();
        // Optional (matching CLI options)
        expect(params.model).toBeDefined();
        expect(params.fps).toBeDefined();
        expect(params.start).toBeDefined();
        expect(params.end).toBeDefined();
        expect(params.lowRes).toBeDefined();
      });

      it("should have correct enum values for model", () => {
        const tool = registry.get("inspect_video");
        const model = tool!.parameters.properties.model as { enum?: string[] };
        expect(model.enum).toContain("flash");
        expect(model.enum).toContain("flash-2.5");
        expect(model.enum).toContain("pro");
      });
    });
  });

  describe("Tool Handler Execution (Mocked)", () => {
    const mockContext = {
      workingDirectory: "/test/workdir",
      projectPath: "/test/project.vibe.json",
    };

    describe("remix_highlights handler", () => {
      it("should call executeHighlights with correct parameters", async () => {
        const { executeHighlights } = await import("../../commands/ai-highlights.js");
        const handler = registry.getHandler("remix_highlights");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            media: "video.mp4",
            duration: 60,
            criteria: "emotional",
            useGemini: true,
          },
          mockContext
        );

        // Manifest's remix_highlights passes args through raw; the legacy
        // handler used to resolve `media` against ctx.workingDirectory. If
        // path resolution is needed, executeHighlights handles it internally.
        expect(executeHighlights).toHaveBeenCalledWith(
          expect.objectContaining({
            media: "video.mp4",
            duration: 60,
            criteria: "emotional",
            useGemini: true,
          })
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain("highlights extracted");
      });
    });

    describe("remix_auto_shorts handler", () => {
      it("should call executeAutoShorts with correct parameters", async () => {
        const { executeAutoShorts } = await import("../../commands/ai-highlights.js");
        const handler = registry.getHandler("remix_auto_shorts");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            video: "long-video.mp4",
            count: 3,
            duration: 45,
            aspect: "9:16",
          },
          mockContext
        );

        // Manifest passes args through raw (see remix_highlights note above).
        expect(executeAutoShorts).toHaveBeenCalledWith(
          expect.objectContaining({
            video: "long-video.mp4",
            count: 3,
            duration: 45,
            aspect: "9:16",
          })
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain("shorts generated");
      });

      it("should handle analyzeOnly mode", async () => {
        const handler = registry.getHandler("remix_auto_shorts");
        const result = await handler!(
          {
            video: "video.mp4",
            analyzeOnly: true,
          },
          mockContext
        );

        expect(result.success).toBe(true);
      });
    });

    describe("inspect_video handler", () => {
      it("should call executeGeminiVideo with correct parameters", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai-analyze.js");
        const handler = registry.getHandler("inspect_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            source: "video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          },
          mockContext
        );

        // Manifest passes args through raw (see remix_highlights note).
        expect(executeGeminiVideo).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          })
        );
        expect(result.success).toBe(true);
        // Manifest's inspect_video humanLines reports the model, not the
        // raw summary text — the summary is in result.data.text.
        expect(result.output).toContain("Analyzed video");
      });

      it("should handle YouTube URLs without modification", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai-analyze.js");
        const handler = registry.getHandler("inspect_video");

        await handler!(
          {
            source: "https://youtube.com/watch?v=test",
            prompt: "Summarize",
          },
          mockContext
        );

        expect(executeGeminiVideo).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "https://youtube.com/watch?v=test",
          })
        );
      });
    });
  });

  describe("Tool Categories Match CLAUDE.md Documentation", () => {
    it("should have correct tool counts per category", () => {
      const allTools = registry.getAll();

      const projectTools = allTools.filter((t) => t.name.startsWith("project_"));
      const timelineTools = allTools.filter((t) =>
        t.name.startsWith("timeline_")
      );
      const fsTools = allTools.filter((t) => t.name.startsWith("fs_"));
      const mediaTools = allTools.filter(
        (t) =>
          t.name.startsWith("media_") ||
          t.name.startsWith("detect_") ||
          t.name.startsWith("audio_")
      );
      const generateTools = allTools.filter((t) => t.name.startsWith("generate_"));
      const editTools = allTools.filter((t) => t.name.startsWith("edit_"));
      // v0.75: `analyze_*` renamed to `inspect_*`; `pipeline_*` renamed to
      // `remix_*` (with `pipeline_run` becoming bare `run` since `vibe run`
      // is groupless at the CLI). Top-level project-flow tools (`init`,
      // `build`, `render`) likewise dropped their old `scene_` prefix.
      const inspectTools = allTools.filter((t) => t.name.startsWith("inspect_"));
      const remixTools = allTools.filter((t) => t.name.startsWith("remix_"));
      const exportTools = allTools.filter((t) => t.name.startsWith("export_"));
      const batchTools = allTools.filter((t) => t.name.startsWith("batch_"));
      const sceneTools = allTools.filter((t) => t.name.startsWith("scene_"));
      const projectFlowTools = allTools.filter((t) =>
        ["init", "build", "render"].includes(t.name),
      );
      const walkthroughTools = allTools.filter((t) => t.name === "walkthrough");
      const runTools = allTools.filter((t) => t.name === "run");

      expect(projectTools.length).toBe(5);
      expect(timelineTools.length).toBe(13);  // Includes canonical timeline_create/info
      expect(fsTools.length).toBe(4);
      expect(mediaTools.length).toBe(12);  // +audio_isolate/voice_clone/dub/duck (Phase B v0.64)
      expect(generateTools.length).toBe(13);  // +background, video_status/cancel/extend, music_status (Phase B v0.64)
      expect(editTools.length).toBe(15);  // +grade, speed_ramp, reframe, interpolate, upscale, animated_caption (Phase B+D v0.64), edit_fill_gaps (Plan G Phase 4)
      expect(inspectTools.length).toBe(4);  // v0.75: video, media, review, suggest (was analyze_*)
      expect(remixTools.length).toBe(3);    // v0.75: highlights, auto_shorts, regenerate_scene (was pipeline_*)
      expect(runTools.length).toBe(0);      // v0.75: bare `run` is MCP-only (`surfaces: ["mcp"]`); not registered into the agent surface
      expect(exportTools.length).toBe(3);
      expect(batchTools.length).toBe(3);
      expect(sceneTools.length).toBe(5);    // v0.75: init/build/render moved out (now project-flow); scene_* keeps add/lint/styles/install-skill/compose-prompts
      expect(projectFlowTools.length).toBe(3);  // v0.75: init/build/render top-level
      expect(walkthroughTools.length).toBe(1);  // v0.71: universal slash-command equivalent

      // 5+13+4+12+13+15+4+3+0+3+3+5+3+1 = 84.
      // timeline_create/info are canonical; project_create/info remain
      // compatibility aliases until v1.0.
      const totalTools = projectTools.length +
          timelineTools.length +
          fsTools.length +
          mediaTools.length +
          generateTools.length +
          editTools.length +
          inspectTools.length +
          remixTools.length +
          runTools.length +
          exportTools.length +
          batchTools.length +
          sceneTools.length +
          projectFlowTools.length +
          walkthroughTools.length;
      expect(totalTools).toBe(84);
    });
  });
});

describe("Exported CLI Functions", () => {
  describe("Function signatures match Agent tool parameters", () => {
    it("executeHighlights accepts HighlightsOptions", async () => {
      const { executeHighlights } = await import("../../commands/ai-highlights.js");
      expect(typeof executeHighlights).toBe("function");
    });

    it("executeAutoShorts accepts AutoShortsOptions", async () => {
      const { executeAutoShorts } = await import("../../commands/ai-highlights.js");
      expect(typeof executeAutoShorts).toBe("function");
    });

    it("executeGeminiVideo accepts GeminiVideoOptions", async () => {
      const { executeGeminiVideo } = await import("../../commands/ai-analyze.js");
      expect(typeof executeGeminiVideo).toBe("function");
    });
  });
});

describe("Tool Name Consistency", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
  });

  it("all tool names should follow naming convention", () => {
    const tools = registry.getAll();
    const validPrefixes = [
      "project_",
      "timeline_",
      "fs_",
      "media_",
      "detect_",
      "audio_",
      "generate_",
      "edit_",
      "inspect_",  // v0.75: was analyze_
      "remix_",    // v0.75: was pipeline_
      "export_",
      "batch_",
      "scene_",
    ];
    // Top-level utility tools that don't fit a category prefix. Keep this
    // list small — every entry is a deliberate naming exception.
    const exactMatches = new Set([
      "walkthrough", // v0.71: universal slash-command equivalent (one tool, multi-topic)
      "init",        // v0.75: top-level project-flow tool (was scene_init)
      "build",       // v0.75: top-level project-flow tool (was scene_build)
      "render",      // v0.75: top-level project-flow tool (was scene_render)
      "run",         // v0.75: top-level YAML pipeline runner (was pipeline_run)
    ]);

    for (const tool of tools) {
      const hasValidPrefix = validPrefixes.some((prefix) =>
        tool.name.startsWith(prefix)
      );
      const isExactMatch = exactMatches.has(tool.name);
      expect(hasValidPrefix || isExactMatch, `tool "${tool.name}" doesn't follow naming convention`).toBe(true);
    }
  });

  it("all tool names should be lowercase with underscores", () => {
    const tools = registry.getAll();
    const validNamePattern = /^[a-z_]+$/;

    for (const tool of tools) {
      expect(tool.name).toMatch(validNamePattern);
    }
  });
});

/**
 * Manifest = SSOT invariant. Originally added in v0.66 PR1 as a regression
 * for the silent-overwrite bug (legacy register*Tools running AFTER
 * registerManifestIntoAgent and clobbering definitions via Map.set). After
 * v0.67 PR2 there are no more legacy register*Tools paths — this test now
 * acts as an adapter-roundtrip check: registry descriptions stay in sync
 * with manifest descriptions.
 */
describe("Manifest is SSOT for Agent surface", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
  });

  it("every manifest entry with agent surface has its description served by registry", () => {
    const drift: Array<{ name: string; manifest: string; registry: string }> = [];
    for (const entry of manifest) {
      if (entry.surfaces && !entry.surfaces.includes("agent")) continue;
      const registered = registry.get(entry.name);
      if (!registered) {
        drift.push({ name: entry.name, manifest: entry.description, registry: "<not registered>" });
        continue;
      }
      if (registered.description !== entry.description) {
        drift.push({ name: entry.name, manifest: entry.description, registry: registered.description });
      }
    }
    expect(drift, `Agent registry diverges from manifest for: ${drift.map((d) => d.name).join(", ")}`).toEqual([]);
  });
});
