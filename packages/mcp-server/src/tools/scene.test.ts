import { describe, expect, it } from "vitest";
import { mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sceneTools } from "@vibeframe/cli/tools/manifest";
import { manifestToMcpTools } from "@vibeframe/cli/tools/adapters/mcp";
import { tools, handleToolCall } from "./index.js";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function makeTmp(label = "vibe-mcp-scene-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

// Project the manifest's scene entries into the MCP tool shape so the legacy
// per-tool inputSchema assertions still apply.
const sceneMcpTools = manifestToMcpTools(sceneTools);

async function callScene(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await handleToolCall(name, args);
  return result.content[0].text;
}

describe("MCP scene tools — registration", () => {
  it("exports eight tools with the canonical names", () => {
    const names = sceneMcpTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "scene_add",
      "scene_build",
      "scene_compose_prompts",
      "scene_init",
      "scene_install_skill",
      "scene_lint",
      "scene_render",
      "scene_styles",
    ]);
  });

  it("includes scene tools in the global MCP tools list", () => {
    const globalNames = new Set(tools.map((t) => t.name));
    expect(globalNames.has("scene_init")).toBe(true);
    expect(globalNames.has("scene_add")).toBe(true);
    expect(globalNames.has("scene_lint")).toBe(true);
    expect(globalNames.has("scene_render")).toBe(true);
  });

  it.each(sceneMcpTools.map((t) => [t.name, t] as const))(
    "%s has well-formed inputSchema",
    (name, tool) => {
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeTypeOf("object");
    },
  );

  it("scene_init declares `dir` as required; scene_add requires `name`; lint+render are arg-free", () => {
    const byName = Object.fromEntries(sceneMcpTools.map((t) => [t.name, t]));
    expect(byName.scene_init.inputSchema.required).toEqual(["dir"]);
    expect(byName.scene_add.inputSchema.required).toEqual(["name"]);
    expect(byName.scene_lint.inputSchema.required).toEqual([]);
    expect(byName.scene_render.inputSchema.required).toEqual([]);
  });
});

describe("handleToolCall — scene offline path", () => {
  // Absolute paths so the handler doesn't depend on process.cwd().

  it("scene_init scaffolds a project at the given absolute dir", async () => {
    const dir = resolve(await makeTmp(), "promo");
    const text = await callScene("scene_init", { dir, aspect: "9:16", duration: 6 });
    const parsed = JSON.parse(text) as { success: boolean; created: string[] };
    expect(parsed.success).toBe(true);
    expect(parsed.created.length).toBeGreaterThan(0);
    expect(await pathExists(resolve(dir, "index.html"))).toBe(true);
  });

  it("scene_add → scene_lint flow: skipAudio/skipImage scene + lint reports ok", async () => {
    const projectDir = await makeTmp();
    await callScene("scene_init", { dir: projectDir });

    const addText = await callScene("scene_add", {
      projectDir,
      name: "intro",
      preset: "announcement",
      headline: "Hi",
      duration: 4,
      skipAudio: true,
      skipImage: true,
    });
    const addParsed = JSON.parse(addText) as { success: boolean; id: string; preset: string };
    expect(addParsed.success).toBe(true);
    expect(addParsed.id).toBe("intro");
    expect(addParsed.preset).toBe("announcement");

    const lintText = await callScene("scene_lint", { projectDir });
    const lintParsed = JSON.parse(lintText) as { ok: boolean; errorCount: number; files: unknown[] };
    expect(lintParsed.ok).toBe(true);
    expect(lintParsed.errorCount).toBe(0);
    expect(lintParsed.files.length).toBeGreaterThan(0);
  });

  it("scene_render returns a structured failure when no project exists", async () => {
    const text = await callScene("scene_render", {
      projectDir: resolve(await makeTmp(), "missing"),
    });
    expect(text).toMatch(/scene_render failed|Project directory not found|Chrome not found|Root composition not found/);
  });

  it("handleToolCall enforces required args (scene_init without dir → error message)", async () => {
    const result = await handleToolCall("scene_init", {});
    expect(result.content[0].text).toMatch(/missing required argument.*dir/);
  });
});
