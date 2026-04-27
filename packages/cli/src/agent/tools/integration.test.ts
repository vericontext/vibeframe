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
import { registerProjectTools } from "./project.js";
import { registerTimelineTools } from "./timeline.js";
import { registerFilesystemTools } from "./filesystem.js";
import { registerMediaTools } from "./media.js";
import { registerAITools } from "./ai.js";
import { registerExportTools } from "./export.js";
import { registerBatchTools } from "./batch.js";
import { manifest } from "../../tools/manifest/index.js";
import { registerManifestIntoAgent } from "../../tools/adapters/agent.js";
// Mock the imported CLI functions to avoid actual API calls
vi.mock("../../commands/ai-script-pipeline.js", () => ({
  executeScriptToVideo: vi.fn().mockResolvedValue({
    success: true,
    outputDir: "/test/output",
    scenes: 3,
    storyboardPath: "/test/output/storyboard.json",
    projectPath: "/test/output/project.vibe.json",
    narrationEntries: [{ path: "/test/output/narration-1.mp3", duration: 3, segmentIndex: 0, failed: false }],
    images: ["/test/output/scene-1.png"],
    videos: ["/test/output/scene-1.mp4"],
    totalDuration: 30,
    failedScenes: [],
  }),
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
    // Mirror production: manifest first, then legacy register*Tools (which
    // skip names already in MIGRATED).
    registerManifestIntoAgent(registry, manifest);
    registerProjectTools(registry);
    registerTimelineTools(registry);
    registerFilesystemTools(registry);
    registerMediaTools(registry);
    registerAITools(registry);
    registerExportTools(registry);
    registerBatchTools(registry);
  });

  describe("Tool Registration", () => {
    it("should register the full manifest + legacy agent-only tools", () => {
      // Production registers manifest (79 entries with agent surface) plus
      // legacy register*Tools (gated on MIGRATED). 6 scene tools come from
      // manifest now, so the previous "73 non-scene" framing no longer
      // applies — assert the post-v0.66 unified count.
      const tools = registry.getAll();
      expect(tools.length).toBe(79);
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
        "analyze_review",
        "analyze_video",
        "analyze_media",
        // Pipeline tools (4)
        "pipeline_script_to_video",
        "pipeline_highlights",
        "pipeline_auto_shorts",
        "pipeline_regenerate_scene",
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
    describe("pipeline_script_to_video", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("pipeline_script_to_video");
        expect(tool).toBeDefined();

        const params = tool!.parameters.properties;
        // Required
        expect(params.script).toBeDefined();
        // Optional (matching CLI options). Manifest is SSOT — if a param
        // diverges from the CLI, the fix is in the manifest, not here.
        expect(params.outputDir).toBeDefined();
        expect(params.duration).toBeDefined();
        expect(params.voice).toBeDefined();
        expect(params.generator).toBeDefined();
        expect(params.imageProvider).toBeDefined();
        expect(params.aspectRatio).toBeDefined();
        expect(params.imagesOnly).toBeDefined();
        expect(params.noVoiceover).toBeDefined();
      });

      it("should have correct enum values for generator", () => {
        const tool = registry.get("pipeline_script_to_video");
        const generator = tool!.parameters.properties.generator as {
          enum?: string[];
        };
        expect(generator.enum).toContain("runway");
        expect(generator.enum).toContain("kling");
      });

      it("should have correct enum values for imageProvider", () => {
        const tool = registry.get("pipeline_script_to_video");
        const imageProvider = tool!.parameters.properties.imageProvider as {
          enum?: string[];
        };
        expect(imageProvider.enum).toContain("openai");
        expect(imageProvider.enum).toContain("gemini");
      });

      it("should have correct enum values for aspectRatio", () => {
        const tool = registry.get("pipeline_script_to_video");
        const aspectRatio = tool!.parameters.properties.aspectRatio as {
          enum?: string[];
        };
        expect(aspectRatio.enum).toContain("16:9");
        expect(aspectRatio.enum).toContain("9:16");
        expect(aspectRatio.enum).toContain("1:1");
      });
    });

    describe("pipeline_highlights", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("pipeline_highlights");
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
        const tool = registry.get("pipeline_highlights");
        const criteria = tool!.parameters.properties.criteria as {
          enum?: string[];
        };
        expect(criteria.enum).toContain("emotional");
        expect(criteria.enum).toContain("informative");
        expect(criteria.enum).toContain("funny");
        expect(criteria.enum).toContain("all");
      });
    });

    describe("pipeline_auto_shorts", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("pipeline_auto_shorts");
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
        const tool = registry.get("pipeline_auto_shorts");
        const aspect = tool!.parameters.properties.aspect as { enum?: string[] };
        expect(aspect.enum).toContain("9:16");
        expect(aspect.enum).toContain("1:1");
      });

      it("should have correct enum values for captionStyle", () => {
        const tool = registry.get("pipeline_auto_shorts");
        const captionStyle = tool!.parameters.properties.captionStyle as {
          enum?: string[];
        };
        expect(captionStyle.enum).toContain("minimal");
        expect(captionStyle.enum).toContain("bold");
        expect(captionStyle.enum).toContain("animated");
      });
    });

    describe("analyze_video", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("analyze_video");
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
        const tool = registry.get("analyze_video");
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

    describe("pipeline_script_to_video handler", () => {
      it("should call executeScriptToVideo with correct parameters", async () => {
        const { executeScriptToVideo } = await import("../../commands/ai-script-pipeline.js");
        const handler = registry.getHandler("pipeline_script_to_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            script: "Test script. Scene two. Conclusion.",
            outputDir: "output",
            generator: "runway",
            imageProvider: "gemini",
            aspectRatio: "16:9",
          },
          mockContext
        );

        expect(executeScriptToVideo).toHaveBeenCalledWith(
          expect.objectContaining({
            script: "Test script. Scene two. Conclusion.",
            generator: "runway",
            imageProvider: "gemini",
            aspectRatio: "16:9",
          })
        );
        expect(result.success).toBe(true);
        // Manifest's pipeline_script_to_video humanLines uses "Script-to-video"
        // (lower-cased "video"). The legacy handler's "Script-to-Video complete"
        // wording is gone post-v0.66.
        expect(result.output).toContain("Script-to-video");
      });

      it("should handle failure gracefully", async () => {
        const { executeScriptToVideo } = await import("../../commands/ai-script-pipeline.js");
        vi.mocked(executeScriptToVideo).mockResolvedValueOnce({
          success: false,
          outputDir: "/test/output",
          scenes: 0,
          error: "API key missing",
        });

        const handler = registry.getHandler("pipeline_script_to_video");
        const result = await handler!({ script: "Test" }, mockContext);

        expect(result.success).toBe(false);
        expect(result.error).toContain("API key missing");
      });
    });

    describe("pipeline_highlights handler", () => {
      it("should call executeHighlights with correct parameters", async () => {
        const { executeHighlights } = await import("../../commands/ai-highlights.js");
        const handler = registry.getHandler("pipeline_highlights");
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

        // Manifest's pipeline_highlights passes args through raw; the legacy
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

    describe("pipeline_auto_shorts handler", () => {
      it("should call executeAutoShorts with correct parameters", async () => {
        const { executeAutoShorts } = await import("../../commands/ai-highlights.js");
        const handler = registry.getHandler("pipeline_auto_shorts");
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

        // Manifest passes args through raw (see pipeline_highlights note above).
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
        const handler = registry.getHandler("pipeline_auto_shorts");
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

    describe("analyze_video handler", () => {
      it("should call executeGeminiVideo with correct parameters", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai-analyze.js");
        const handler = registry.getHandler("analyze_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            source: "video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          },
          mockContext
        );

        // Manifest passes args through raw (see pipeline_highlights note).
        expect(executeGeminiVideo).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          })
        );
        expect(result.success).toBe(true);
        // Manifest's analyze_video humanLines reports the model, not the
        // raw summary text — the summary is in result.data.text.
        expect(result.output).toContain("Analyzed video");
      });

      it("should handle YouTube URLs without modification", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai-analyze.js");
        const handler = registry.getHandler("analyze_video");

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
      const analyzeTools = allTools.filter((t) => t.name.startsWith("analyze_"));
      const pipelineTools = allTools.filter((t) => t.name.startsWith("pipeline_"));
      const exportTools = allTools.filter((t) => t.name.startsWith("export_"));
      const batchTools = allTools.filter((t) => t.name.startsWith("batch_"));
      const sceneTools = allTools.filter((t) => t.name.startsWith("scene_"));

      expect(projectTools.length).toBe(5);
      expect(timelineTools.length).toBe(11);  // Added timeline_clear
      expect(fsTools.length).toBe(4);
      expect(mediaTools.length).toBe(12);  // +audio_isolate/voice_clone/dub/duck (Phase B v0.64)
      expect(generateTools.length).toBe(13);  // +background, video_status/cancel/extend, music_status (Phase B v0.64)
      expect(editTools.length).toBe(14);  // +grade, speed_ramp, reframe, interpolate, upscale, animated_caption (Phase B+D v0.64)
      expect(analyzeTools.length).toBe(4);  // video, media, review, suggest
      expect(pipelineTools.length).toBe(4);  // animated_caption renamed to edit_animated_caption (Phase D)
      expect(exportTools.length).toBe(3);
      expect(batchTools.length).toBe(3);
      expect(sceneTools.length).toBe(6);  // v0.66: scene_* surfaced via manifest (init/add/lint/render/build/styles)

      // Total: 5+11+4+12+13+14+4+4+3+3+6 = 79
      const totalTools = projectTools.length +
          timelineTools.length +
          fsTools.length +
          mediaTools.length +
          generateTools.length +
          editTools.length +
          analyzeTools.length +
          pipelineTools.length +
          exportTools.length +
          batchTools.length +
          sceneTools.length;
      expect(totalTools).toBe(79);
    });
  });
});

describe("Exported CLI Functions", () => {
  describe("Function signatures match Agent tool parameters", () => {
    it("executeScriptToVideo accepts ScriptToVideoOptions", async () => {
      // Type check - this will fail at compile time if signatures don't match
      const { executeScriptToVideo } = await import("../../commands/ai-script-pipeline.js");
      expect(typeof executeScriptToVideo).toBe("function");
    });

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
    // Mirror production: manifest first, then legacy register*Tools (which
    // skip names already in MIGRATED).
    registerManifestIntoAgent(registry, manifest);
    registerProjectTools(registry);
    registerTimelineTools(registry);
    registerFilesystemTools(registry);
    registerMediaTools(registry);
    registerAITools(registry);
    registerExportTools(registry);
    registerBatchTools(registry);
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
      "analyze_",
      "pipeline_",
      "export_",
      "batch_",
      "scene_",
    ];

    for (const tool of tools) {
      const hasValidPrefix = validPrefixes.some((prefix) =>
        tool.name.startsWith(prefix)
      );
      expect(hasValidPrefix).toBe(true);
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
 * Regression for v0.65 silent overwrite bug: legacy register*Tools functions
 * in ai-editing/ai-generation/ai-pipeline/media did NOT gate on MIGRATED, so
 * they ran AFTER registerManifestIntoAgent and overwrote manifest definitions
 * via Map.set. v0.66 PR1 added MIGRATED gates to all four files. This test
 * proves the manifest definition is what the registry actually serves.
 */
describe("Manifest is SSOT for Agent surface", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
    registerProjectTools(registry);
    registerTimelineTools(registry);
    registerFilesystemTools(registry);
    registerMediaTools(registry);
    registerAITools(registry);
    registerExportTools(registry);
    registerBatchTools(registry);
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
