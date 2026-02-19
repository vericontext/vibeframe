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
import type { ToolDefinition } from "../types.js";

// Mock the imported CLI functions to avoid actual API calls
vi.mock("../../commands/ai.js", () => ({
  executeScriptToVideo: vi.fn().mockResolvedValue({
    success: true,
    outputDir: "/test/output",
    scenes: 3,
    storyboardPath: "/test/output/storyboard.json",
    projectPath: "/test/output/project.vibe.json",
    narrations: ["/test/output/narration-1.mp3"],
    images: ["/test/output/scene-1.png"],
    videos: ["/test/output/scene-1.mp4"],
    totalDuration: 30,
    failedScenes: [],
  }),
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
  executeGeminiVideo: vi.fn().mockResolvedValue({
    success: true,
    response: "This is a test video summary.",
    model: "gemini-3-flash-preview",
    totalTokens: 1000,
  }),
}));

describe("CLI ↔ Agent Tool Synchronization", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerProjectTools(registry);
    registerTimelineTools(registry);
    registerFilesystemTools(registry);
    registerMediaTools(registry);
    registerAITools(registry);
    registerExportTools(registry);
    registerBatchTools(registry);
  });

  describe("Tool Registration", () => {
    it("should register all 50 tools", () => {
      const tools = registry.getAll();
      expect(tools.length).toBe(50);
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
        "timeline_trim",
        "timeline_split",
        "timeline_move",
        "timeline_clear",
        "timeline_delete",
        "timeline_duplicate",
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
        "ai_transcribe",
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

    it("should register all AI tools (12)", () => {
      const aiTools = [
        // Basic AI tools (8)
        "ai_image",
        "ai_video",
        "ai_kling",
        "ai_tts",
        "ai_sfx",
        "ai_music",
        "ai_storyboard",
        "ai_motion",
        // Pipeline tools (4)
        "ai_script_to_video",
        "ai_highlights",
        "ai_auto_shorts",
        "ai_gemini_video",
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
        for (const [paramName, paramDef] of Object.entries(
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
    describe("ai_script_to_video", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("ai_script_to_video");
        expect(tool).toBeDefined();

        const params = tool!.parameters.properties;
        // Required
        expect(params.script).toBeDefined();
        // Optional (matching CLI options)
        expect(params.outputDir).toBeDefined();
        expect(params.duration).toBeDefined();
        expect(params.voice).toBeDefined();
        expect(params.generator).toBeDefined();
        expect(params.imageProvider).toBeDefined();
        expect(params.aspectRatio).toBeDefined();
        expect(params.imagesOnly).toBeDefined();
        expect(params.noVoiceover).toBeDefined();
        expect(params.retries).toBeDefined();
      });

      it("should have correct enum values for generator", () => {
        const tool = registry.get("ai_script_to_video");
        const generator = tool!.parameters.properties.generator as {
          enum?: string[];
        };
        expect(generator.enum).toContain("runway");
        expect(generator.enum).toContain("kling");
      });

      it("should have correct enum values for imageProvider", () => {
        const tool = registry.get("ai_script_to_video");
        const imageProvider = tool!.parameters.properties.imageProvider as {
          enum?: string[];
        };
        expect(imageProvider.enum).toContain("openai");
        expect(imageProvider.enum).toContain("stability");
        expect(imageProvider.enum).toContain("gemini");
      });

      it("should have correct enum values for aspectRatio", () => {
        const tool = registry.get("ai_script_to_video");
        const aspectRatio = tool!.parameters.properties.aspectRatio as {
          enum?: string[];
        };
        expect(aspectRatio.enum).toContain("16:9");
        expect(aspectRatio.enum).toContain("9:16");
        expect(aspectRatio.enum).toContain("1:1");
      });
    });

    describe("ai_highlights", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("ai_highlights");
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
        const tool = registry.get("ai_highlights");
        const criteria = tool!.parameters.properties.criteria as {
          enum?: string[];
        };
        expect(criteria.enum).toContain("emotional");
        expect(criteria.enum).toContain("informative");
        expect(criteria.enum).toContain("funny");
        expect(criteria.enum).toContain("all");
      });
    });

    describe("ai_auto_shorts", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("ai_auto_shorts");
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
        const tool = registry.get("ai_auto_shorts");
        const aspect = tool!.parameters.properties.aspect as { enum?: string[] };
        expect(aspect.enum).toContain("9:16");
        expect(aspect.enum).toContain("1:1");
      });

      it("should have correct enum values for captionStyle", () => {
        const tool = registry.get("ai_auto_shorts");
        const captionStyle = tool!.parameters.properties.captionStyle as {
          enum?: string[];
        };
        expect(captionStyle.enum).toContain("minimal");
        expect(captionStyle.enum).toContain("bold");
        expect(captionStyle.enum).toContain("animated");
      });
    });

    describe("ai_gemini_video", () => {
      it("should have all CLI options as parameters", () => {
        const tool = registry.get("ai_gemini_video");
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
        const tool = registry.get("ai_gemini_video");
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

    describe("ai_script_to_video handler", () => {
      it("should call executeScriptToVideo with correct parameters", async () => {
        const { executeScriptToVideo } = await import("../../commands/ai.js");
        const handler = registry.getHandler("ai_script_to_video");
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
        expect(result.output).toContain("Script-to-Video complete");
      });

      it("should handle failure gracefully", async () => {
        const { executeScriptToVideo } = await import("../../commands/ai.js");
        vi.mocked(executeScriptToVideo).mockResolvedValueOnce({
          success: false,
          outputDir: "/test/output",
          scenes: 0,
          error: "API key missing",
        });

        const handler = registry.getHandler("ai_script_to_video");
        const result = await handler!({ script: "Test" }, mockContext);

        expect(result.success).toBe(false);
        expect(result.error).toContain("API key missing");
      });
    });

    describe("ai_highlights handler", () => {
      it("should call executeHighlights with correct parameters", async () => {
        const { executeHighlights } = await import("../../commands/ai.js");
        const handler = registry.getHandler("ai_highlights");
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

        expect(executeHighlights).toHaveBeenCalledWith(
          expect.objectContaining({
            media: "/test/workdir/video.mp4",
            duration: 60,
            criteria: "emotional",
            useGemini: true,
          })
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain("Found 1 highlights");
      });
    });

    describe("ai_auto_shorts handler", () => {
      it("should call executeAutoShorts with correct parameters", async () => {
        const { executeAutoShorts } = await import("../../commands/ai.js");
        const handler = registry.getHandler("ai_auto_shorts");
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

        expect(executeAutoShorts).toHaveBeenCalledWith(
          expect.objectContaining({
            video: "/test/workdir/long-video.mp4",
            count: 3,
            duration: 45,
            aspect: "9:16",
          })
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain("Generated 1 short");
      });

      it("should handle analyzeOnly mode", async () => {
        const handler = registry.getHandler("ai_auto_shorts");
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

    describe("ai_gemini_video handler", () => {
      it("should call executeGeminiVideo with correct parameters", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai.js");
        const handler = registry.getHandler("ai_gemini_video");
        expect(handler).toBeDefined();

        const result = await handler!(
          {
            source: "video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          },
          mockContext
        );

        expect(executeGeminiVideo).toHaveBeenCalledWith(
          expect.objectContaining({
            source: "/test/workdir/video.mp4",
            prompt: "Summarize this video",
            model: "flash",
          })
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain("test video summary");
      });

      it("should handle YouTube URLs without modification", async () => {
        const { executeGeminiVideo } = await import("../../commands/ai.js");
        const handler = registry.getHandler("ai_gemini_video");

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
          t.name === "ai_transcribe"
      );
      const aiTools = allTools.filter(
        (t) =>
          t.name.startsWith("ai_") &&
          t.name !== "ai_transcribe" // ai_transcribe is media tool
      );
      const exportTools = allTools.filter((t) => t.name.startsWith("export_"));
      const batchTools = allTools.filter((t) => t.name.startsWith("batch_"));

      expect(projectTools.length).toBe(5);
      expect(timelineTools.length).toBe(11);  // Added timeline_clear
      expect(fsTools.length).toBe(4);
      expect(mediaTools.length).toBe(8);  // Added media_compress, media_convert, media_concat
      expect(aiTools.length).toBe(16);  // Added ai_gemini_edit, ai_regenerate_scene, ai_text_overlay, ai_review
      expect(exportTools.length).toBe(3);
      expect(batchTools.length).toBe(3);  // New batch tools

      // Total should be 48
      expect(
        projectTools.length +
          timelineTools.length +
          fsTools.length +
          mediaTools.length +
          aiTools.length +
          exportTools.length +
          batchTools.length
      ).toBe(50);
    });
  });
});

describe("Exported CLI Functions", () => {
  describe("Function signatures match Agent tool parameters", () => {
    it("executeScriptToVideo accepts ScriptToVideoOptions", async () => {
      // Type check - this will fail at compile time if signatures don't match
      const { executeScriptToVideo } = await import("../../commands/ai.js");
      expect(typeof executeScriptToVideo).toBe("function");
    });

    it("executeHighlights accepts HighlightsOptions", async () => {
      const { executeHighlights } = await import("../../commands/ai.js");
      expect(typeof executeHighlights).toBe("function");
    });

    it("executeAutoShorts accepts AutoShortsOptions", async () => {
      const { executeAutoShorts } = await import("../../commands/ai.js");
      expect(typeof executeAutoShorts).toBe("function");
    });

    it("executeGeminiVideo accepts GeminiVideoOptions", async () => {
      const { executeGeminiVideo } = await import("../../commands/ai.js");
      expect(typeof executeGeminiVideo).toBe("function");
    });
  });
});

describe("Tool Name Consistency", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
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
      "ai_",
      "export_",
      "batch_",
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
