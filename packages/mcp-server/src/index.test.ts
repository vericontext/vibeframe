/**
 * MCP Server package smoke tests
 * Verifies exports and basic structure
 */

import { describe, it, expect } from "vitest";
import { tools, handleToolCall } from "./tools/index.js";

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

    // Anthropic extension-directory requirement: every tool ships a display
    // title plus a readOnlyHint or destructiveHint safety annotation.
    it("every tool has a title and complete safety annotations", () => {
      for (const tool of tools) {
        expect(tool.title, `${tool.name} missing title`).toBeTruthy();
        const a = tool.annotations;
        expect(a, `${tool.name} missing annotations`).toBeDefined();
        expect(typeof a.readOnlyHint, `${tool.name} readOnlyHint`).toBe("boolean");
        expect(typeof a.openWorldHint, `${tool.name} openWorldHint`).toBe("boolean");
        if (a.readOnlyHint) {
          expect(a.destructiveHint, `${tool.name} read-only must omit destructiveHint`).toBeUndefined();
        } else {
          expect(typeof a.destructiveHint, `${tool.name} destructiveHint`).toBe("boolean");
        }
      }
    });

    it("should export handleToolCall function", () => {
      expect(handleToolCall).toBeDefined();
      expect(typeof handleToolCall).toBe("function");
    });

    it("should have scene project tools", () => {
      const toolNames = tools.map((t) => t.name);
      for (const name of ["init", "plan", "build", "render", "project_list", "status_project"]) {
        expect(toolNames).toContain(name);
      }
    });

    it("no longer exposes the removed timeline model tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames.filter((n) => n.startsWith("timeline_"))).toEqual([]);
      for (const name of ["project_create", "project_info", "export_video", "edit_fill_gaps", "inspect_suggest"]) {
        expect(toolNames).not.toContain(name);
      }
    });

    it("should have AI editing tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("edit_silence_cut");
      expect(toolNames).toContain("edit_caption");
      expect(toolNames).toContain("edit_fade");
      expect(toolNames).toContain("edit_noise_reduce");
      expect(toolNames).toContain("edit_jump_cut");
      expect(toolNames).toContain("edit_text_overlay");
      expect(toolNames).toContain("edit_motion_overlay");
      expect(toolNames).toContain("edit_translate_srt");
    });

    it("should have AI analysis tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("inspect_media");
      expect(toolNames).toContain("generate_thumbnail");
    });

    it("should have AI pipeline tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("remix_highlights");
      expect(toolNames).toContain("remix_auto_shorts");
      expect(toolNames).toContain("run");
    });

    it("should have AI generation tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("generate_motion");
      expect(toolNames).toContain("edit_animated_caption");
      expect(toolNames).toContain("generate_narration");
      expect(toolNames).toContain("generate_sound_effect");
      expect(toolNames).toContain("generate_music");
      expect(toolNames).toContain("generate_image");
      expect(toolNames).toContain("edit_image");
    });

    it("should have AI video tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("generate_video");
      expect(toolNames).toContain("generate_video_cancel");
      expect(toolNames).toContain("generate_video_extend");
    });

    it("should have AI audio tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("audio_transcribe");
      expect(toolNames).toContain("audio_isolate");
      expect(toolNames).toContain("audio_clone_voice");
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
    // Regression for #44: a missing required arg must not be stringified
    // into a path like "undefined".
    it("rejects init with a missing dir (not an 'undefined' directory)", async () => {
      const result = await handleToolCall("init", {});
      const text = result.content[0].text;
      expect(text).toContain("missing required");
      expect(text).toContain("dir");
      expect(text).not.toContain("/undefined");
    });

    it("reports all missing required args for multi-required tools", async () => {
      const result = await handleToolCall("audio_duck", {});
      const text = result.content[0].text;
      expect(text).toContain("missing required");
      expect(text).toContain("musicPath");
      expect(text).toContain("voicePath");
    });

    it("rejects null as a missing required arg (not empty string)", async () => {
      const result = await handleToolCall("init", { dir: null });
      expect(result.content[0].text).toContain("missing required");
    });

    it("accepts a valid call with all required args present", async () => {
      const { mkdtemp, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const root = await mkdtemp(join(tmpdir(), "vibeframe-validation-test-"));
      try {
        const result = await handleToolCall("init", { dir: join(root, "validation-test") });
        const text = result.content[0].text;
        expect(text).not.toContain("missing required");
        expect(text).toContain("validation-test");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
