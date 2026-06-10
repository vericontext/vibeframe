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
  it("exports ten tools with the canonical names", () => {
    const names = sceneMcpTools.map((t) => t.name).sort();
    expect(names).toEqual([
      "build",
      "init",
      "render",
      "scene_add",
      "scene_compose_prompts",
      "scene_install_skill",
      "scene_lint",
      "scene_list_styles",
      "scene_repair",
      "scene_submit",
    ]);
  });

  it("includes scene tools in the global MCP tools list", () => {
    const globalNames = new Set(tools.map((t) => t.name));
    expect(globalNames.has("init")).toBe(true);
    expect(globalNames.has("scene_add")).toBe(true);
    expect(globalNames.has("scene_lint")).toBe(true);
    expect(globalNames.has("render")).toBe(true);
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

  it("init declares `dir` as required; scene_add requires `name`; lint+render are arg-free", () => {
    const byName = Object.fromEntries(sceneMcpTools.map((t) => [t.name, t]));
    expect(byName.init.inputSchema.required).toEqual(["dir"]);
    expect(byName.scene_add.inputSchema.required).toEqual(["name"]);
    expect(byName.scene_lint.inputSchema.required).toEqual([]);
    expect(byName.render.inputSchema.required).toEqual([]);
    expect(byName.render.inputSchema.properties).toHaveProperty("openAfterRender");
    expect(byName.render.inputSchema.properties).toHaveProperty("revealInFinder");
  });

  it("explains MCP workspace-relative project paths", () => {
    const byName = Object.fromEntries(sceneMcpTools.map((t) => [t.name, t]));
    expect(byName.init.inputSchema.properties.dir.description).toContain("workspace-relative");
    expect(byName.init.inputSchema.properties.dir.description).toContain("Do not use /tmp");
    expect(byName.scene_lint.inputSchema.properties.projectDir.description).toContain(
      "configured server workspace"
    );
  });
});

describe("handleToolCall — scene offline path", () => {
  // Absolute paths so the handler doesn't depend on process.cwd().

  it("init scaffolds a project at the given absolute dir", async () => {
    const dir = resolve(await makeTmp(), "promo");
    const text = await callScene("init", { dir, aspect: "9:16", duration: 6 });
    const parsed = JSON.parse(text) as { success: boolean; created: string[] };
    expect(parsed.success).toBe(true);
    expect(parsed.created.length).toBeGreaterThan(0);
    expect(await pathExists(resolve(dir, "index.html"))).toBe(true);
  });

  it("scene_add → scene_lint flow: skipAudio/skipImage scene + lint reports ok", async () => {
    const projectDir = await makeTmp();
    await callScene("init", { dir: projectDir });

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

  it("render returns a structured failure when no project exists", async () => {
    const text = await callScene("render", {
      projectDir: resolve(await makeTmp(), "missing"),
    });
    expect(text).toMatch(/render failed|Project directory not found|Chrome not found|Root composition not found/);
  });

  it("status_project returns the MCP working directory and resolved projectDir", async () => {
    const projectDir = await makeTmp();
    const text = await callScene("status_project", { projectDir });
    const parsed = JSON.parse(text) as {
      success: boolean;
      workingDirectory: string;
      projectDir: string;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.workingDirectory).toBe(process.cwd());
    expect(parsed.projectDir).toBe(projectDir);
  });

  it("inspect_project preserves path context even when inspection fails", async () => {
    const projectDir = await makeTmp();
    const text = await callScene("inspect_project", { projectDir, report: false });
    const parsed = JSON.parse(text) as {
      success: boolean;
      workingDirectory: string;
      projectDir: string;
    };
    expect(parsed.success).toBe(false);
    expect(parsed.workingDirectory).toBe(process.cwd());
    expect(parsed.projectDir).toBe(projectDir);
  });

  it("handleToolCall enforces required args (init without dir → error message)", async () => {
    const result = await handleToolCall("init", {});
    expect(result.content[0].text).toMatch(/missing required argument.*dir/);
  });
});
