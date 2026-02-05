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

  describe("handleToolCall", () => {
    it("should handle unknown tool gracefully", async () => {
      const result = await handleToolCall("unknown_tool", {});
      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Error");
    });
  });
});
