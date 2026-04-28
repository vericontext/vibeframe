/**
 * MCP Server package smoke tests
 * Verifies exports and basic structure
 */

import { describe, it, expect } from "vitest";
import { tools, handleToolCall } from "./tools/index.js";
import { resources, readResource } from "./resources/index.js";
import { prompts, getPrompt } from "./prompts/index.js";

describe("@vibeframe/mcp-server", () => {
  describe("tools", () => {
    it("should export tools array", () => {
      expect(tools).toBeDefined();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should have 64 tools total", () => {
      expect(tools.length).toBe(64);
    });

    it("should have correct tool structure", () => {
      const tool = tools[0];
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    });

    it("should export handleToolCall function", () => {
      expect(handleToolCall).toBeDefined();
      expect(typeof handleToolCall).toBe("function");
    });

    it("should have project and timeline tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("project_create");
      expect(toolNames).toContain("project_info");
      expect(toolNames).toContain("timeline_add_source");
      expect(toolNames).toContain("timeline_add_clip");
      expect(toolNames).toContain("timeline_list");
    });

    it("should have export tool", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("export_video");
    });

    it("should have AI editing tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("edit_silence_cut");
      expect(toolNames).toContain("edit_caption");
      expect(toolNames).toContain("edit_fade");
      expect(toolNames).toContain("edit_noise_reduce");
      expect(toolNames).toContain("edit_jump_cut");
      expect(toolNames).toContain("edit_text_overlay");
      expect(toolNames).toContain("edit_translate_srt");
    });

    it("should have AI analysis tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("analyze_media");
      expect(toolNames).toContain("analyze_video");
      expect(toolNames).toContain("analyze_review");
      expect(toolNames).toContain("generate_thumbnail");
    });

    it("should have AI pipeline tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("pipeline_script_to_video");
      expect(toolNames).toContain("pipeline_highlights");
      expect(toolNames).toContain("pipeline_auto_shorts");
      expect(toolNames).toContain("pipeline_regenerate_scene");
      expect(toolNames).toContain("pipeline_run");
    });

    it("should have AI generation tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("generate_motion");
      expect(toolNames).toContain("edit_animated_caption");
      expect(toolNames).toContain("generate_speech");
      expect(toolNames).toContain("generate_sound_effect");
      expect(toolNames).toContain("generate_music");
      expect(toolNames).toContain("generate_image");
      expect(toolNames).toContain("edit_image");
    });

    it("should have AI video tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("generate_video");
      expect(toolNames).toContain("generate_video_status");
      expect(toolNames).toContain("generate_video_cancel");
      expect(toolNames).toContain("generate_video_extend");
    });

    it("should have AI audio tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("audio_transcribe");
      expect(toolNames).toContain("audio_isolate");
      expect(toolNames).toContain("audio_voice_clone");
      expect(toolNames).toContain("audio_dub");
      expect(toolNames).toContain("audio_duck");
    });

    it("should have detection tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("detect_scenes");
      expect(toolNames).toContain("detect_silence");
      expect(toolNames).toContain("detect_beats");
    });

    it("should have unique tool names", () => {
      const toolNames = tools.map((t) => t.name);
      const uniqueNames = new Set(toolNames);
      expect(uniqueNames.size).toBe(toolNames.length);
    });
  });

  describe("resources", () => {
    it("should export resources array", () => {
      expect(resources).toBeDefined();
      expect(Array.isArray(resources)).toBe(true);
    });

    it("should export readResource function", () => {
      expect(readResource).toBeDefined();
      expect(typeof readResource).toBe("function");
    });
  });

  describe("prompts", () => {
    it("should export prompts array", () => {
      expect(prompts).toBeDefined();
      expect(Array.isArray(prompts)).toBe(true);
    });

    it("should export getPrompt function", () => {
      expect(getPrompt).toBeDefined();
      expect(typeof getPrompt).toBe("function");
    });
  });

  describe("schema consistency", () => {
    it("every tool should have a registered handler (not unknown)", async () => {
      // Call with empty args — handlers should fail with domain error, NOT "Unknown tool"
      // Use Promise.allSettled to avoid timeout on slow handlers
      const results = await Promise.all(
        tools.map(async (tool) => {
          try {
            const result = await Promise.race([
              handleToolCall(tool.name, {}),
              new Promise<{ content: Array<{ type: string; text: string }> }>((resolve) =>
                setTimeout(() => resolve({ content: [{ type: "text", text: "timeout-ok" }] }), 500)
              ),
            ]);
            return { name: tool.name, text: result.content[0].text };
          } catch {
            return { name: tool.name, text: "error-ok" };
          }
        })
      );
      for (const r of results) {
        expect(r.text).not.toContain("Unknown tool");
      }
    });

    it("every tool inputSchema should have valid structure", () => {
      for (const tool of tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeDefined();
        expect(typeof tool.inputSchema.properties).toBe("object");

        // Required fields should reference existing properties
        if (tool.inputSchema.required) {
          for (const req of tool.inputSchema.required) {
            expect(tool.inputSchema.properties).toHaveProperty(
              req,
              expect.anything(),
            );
          }
        }

        // Each property should have a type and description
        for (const [, val] of Object.entries(tool.inputSchema.properties)) {
          const prop = val as unknown as Record<string, unknown>;
          expect(prop.type || prop.enum).toBeDefined();
          expect(prop.description).toBeDefined();
        }
      }
    });

    it("tool names should follow snake_case convention", () => {
      for (const tool of tools) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe("handleToolCall", () => {
    it("should handle unknown tool gracefully", async () => {
      const result = await handleToolCall("unknown_tool", {});
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toMatch(/Unknown tool|Error/);
    });
  });

  describe("required args validation", () => {
    // Regression for #44: project_create stringified undefined into "undefined.vibe.json".
    it("rejects project_create with missing name (not 'undefined.vibe.json')", async () => {
      const result = await handleToolCall("project_create", {});
      const text = result.content[0].text;
      expect(text).toContain("missing required");
      expect(text).toContain("name");
      expect(text).not.toContain("undefined.vibe.json");
    });

    it("reports all missing required args for multi-required tools", async () => {
      const result = await handleToolCall("timeline_add_source", {});
      const text = result.content[0].text;
      expect(text).toContain("missing required");
      expect(text).toContain("projectPath");
      expect(text).toContain("mediaPath");
    });

    it("rejects null as a missing required arg (not empty string)", async () => {
      const result = await handleToolCall("project_create", { name: null });
      expect(result.content[0].text).toContain("missing required");
    });

    it("accepts a valid call with all required args present", async () => {
      // Use a throwaway path that won't collide with anything
      const tmpPath = `/tmp/vibeframe-validation-test-${Date.now()}.vibe.json`;
      const result = await handleToolCall("project_create", {
        name: "validation-test",
        outputPath: tmpPath,
      });
      const text = result.content[0].text;
      expect(text).not.toContain("missing required");
      expect(text).toContain("validation-test");
      // Cleanup
      const { unlink } = await import("node:fs/promises");
      try { await unlink(tmpPath); } catch { /* ignore */ }
    });
  });
});
