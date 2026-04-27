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
 * - Every name in `MIGRATED` is actually present in the manifest (catches
 *   "added MIGRATED entry but forgot to add the manifest tool")
 */

import { describe, expect, it } from "vitest";
import { manifest } from "./manifest/index.js";
import { MIGRATED } from "./define-tool.js";
import { manifestToMcpTools } from "./adapters/mcp.js";
import {
  registerManifestIntoAgent,
} from "./adapters/agent.js";
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

  it("Agent adapter registers every agent-surfaced entry", () => {
    const registry = new ToolRegistry();
    registerManifestIntoAgent(registry, manifest);
    const expected = manifest.filter(
      (t) => !t.surfaces || t.surfaces.includes("agent"),
    );
    const registered = registry.getDefinitions().map((d) => d.name).sort();
    expect(registered).toEqual(expected.map((t) => t.name).sort());
  });

  it("every name in MIGRATED is present in the manifest", () => {
    const manifestNames = new Set(manifest.map((t) => t.name));
    for (const migrated of MIGRATED) {
      expect(
        manifestNames.has(migrated),
        `MIGRATED has "${migrated}" but the manifest does not define it`,
      ).toBe(true);
    }
  });
});
