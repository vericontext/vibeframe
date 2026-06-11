/**
 * Manifest invariants — fails CI on shape drift.
 *
 * Runs against the live manifest (no mocks). Each invariant catches a
 * different class of regression:
 *
 * - Name uniqueness + snake_case form
 * - Schema is a ZodObject (so adapters can derive properties/required)
 * - MCP adapter round-trip: every entry tagged `mcp` produces a valid
 *   inputSchema
 * - Agent adapter round-trip: every entry tagged `agent` registers cleanly
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { manifest } from "./manifest/index.js";
import { buildMcpDispatcher, manifestToMcpTools } from "./adapters/mcp.js";
import {
  registerManifestIntoAgent,
} from "./adapters/agent.js";
import { defineTool, type AnyTool } from "./define-tool.js";
import { ToolRegistry } from "../agent/tools/index.js";

describe("tool manifest invariants", () => {
  it("manifest is non-empty during the v0.65 migration", () => {
    expect(manifest.length).toBeGreaterThan(0);
  });

  it("every entry has a unique snake_case name", () => {
    const names = manifest.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it("every entry's schema is a ZodObject", () => {
    for (const t of manifest) {
      const typeName = (t.schema as { _def?: { typeName?: string } })._def
        ?.typeName;
      expect(typeName, `${t.name} schema typeName`).toBe("ZodObject");
    }
  });

  it("every entry has a non-empty description (≥ 20 chars)", () => {
    for (const t of manifest) {
      expect(t.description.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("every entry's category is lowercase + dash-only", () => {
    for (const t of manifest) {
      expect(t.category).toMatch(/^[a-z-]+$/);
    }
  });

  it("MCP adapter round-trips every mcp-surfaced entry", () => {
    const mcp = manifestToMcpTools(manifest);
    const expected = manifest.filter(
      (t) => !t.surfaces || t.surfaces.includes("mcp"),
    );
    expect(mcp.map((t) => t.name).sort()).toEqual(
      expected.map((t) => t.name).sort(),
    );
    for (const tool of mcp) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it("MCP dispatcher captures noisy tool stdout so stdio transport stays JSON-only", async () => {
    const originalWrite = process.stdout.write;
    const leaked: string[] = [];
    process.stdout.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
      leaked.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      const cb = typeof encodingOrCallback === "function"
        ? encodingOrCallback
        : typeof callback === "function"
          ? callback
          : undefined;
      if (cb) queueMicrotask(() => (cb as () => void)());
      return true;
    }) as typeof process.stdout.write;

    try {
      const noisyTool = defineTool({
        name: "noisy_tool",
        category: "test",
        cost: "free",
        title: "Noisy Tool",
        annotations: { readOnly: true, openWorld: false },
        surfaces: ["mcp"],
        description: "Test tool that writes logs while returning JSON.",
        schema: z.object({}),
        async execute() {
          console.log("[Compiler] this must not leak into MCP stdout");
          process.stdout.write("[INFO] also not JSON\n");
          return { success: true, data: { ok: true } };
        },
      });
      const dispatch = buildMcpDispatcher([noisyTool as unknown as AnyTool]);
      const response = await dispatch("noisy_tool", {});
      expect(leaked).toEqual([]);
      expect(JSON.parse(response.content[0].text)).toEqual({ success: true, ok: true });
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("MCP generate_video schema stays aligned with the CLI provider surface", () => {
    const [tool] = manifestToMcpTools(manifest).filter((entry) => entry.name === "generate_video");
    expect(tool).toBeDefined();
    expect(tool.description).toContain("Seedance");
    expect(tool.description).toContain("FAL_API_KEY");

    const provider = tool.inputSchema.properties?.provider as { enum?: string[] } | undefined;
    expect(provider?.enum).toEqual(["seedance", "grok", "kling", "runway", "veo"]);
    expect(tool.inputSchema.properties).toHaveProperty("seedanceModel");
  });

  it("MCP generate_motion exposes video understanding controls", () => {
    const [tool] = manifestToMcpTools(manifest).filter((entry) => entry.name === "generate_motion");
    expect(tool).toBeDefined();

    const understand = tool.inputSchema.properties?.understand as { enum?: string[] } | undefined;
    expect(understand?.enum).toEqual(["auto", "off", "required"]);
    expect(tool.inputSchema.properties).toHaveProperty("understandingPrompt");
  });

  it("Agent adapter registers every agent-surfaced entry", () => {
    const registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
    const expected = manifest.filter(
      (t) => !t.surfaces || t.surfaces.includes("agent"),
    );
    const registered = registry.getDefinitions().map((d) => d.name).sort();
    expect(registered).toEqual(expected.map((t) => t.name).sort());
  });

});
