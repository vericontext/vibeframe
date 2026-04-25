import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ToolRegistry } from "./index.js";
import { registerSceneTools, sceneToolDefinitions } from "./scene.js";
import type { AgentContext, ToolDefinition } from "../types.js";

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function makeTmp(label = "vibe-scene-agent-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

function ctx(workingDirectory: string): AgentContext {
  return { projectPath: null, workingDirectory };
}

let registry: ToolRegistry;
beforeEach(() => {
  registry = new ToolRegistry();
  registerSceneTools(registry);
});

describe("scene agent tools — registration + schema", () => {
  it("registers exactly four scene_* tools", () => {
    const names = registry.getDefinitions().map((t) => t.name).filter((n) => n.startsWith("scene_")).sort();
    expect(names).toEqual(["scene_add", "scene_init", "scene_lint", "scene_render"]);
  });

  it("exports definitions matching the registered set (parity with sceneToolDefinitions)", () => {
    const exported = sceneToolDefinitions.map((d) => d.name).sort();
    const registered = registry.getDefinitions().map((t) => t.name).sort();
    expect(exported).toEqual(registered);
  });

  it.each(sceneToolDefinitions.map((d) => [d.name, d] as const))(
    "%s has well-formed JSON-schema-ish parameters",
    (name: string, def: ToolDefinition) => {
      expect(def.name).toBe(name);
      expect(def.description.length).toBeGreaterThan(20);
      expect(def.parameters.type).toBe("object");
      expect(def.parameters.properties).toBeTypeOf("object");
      expect(Array.isArray(def.parameters.required)).toBe(true);
      // Every property has a string description.
      for (const [key, prop] of Object.entries(def.parameters.properties)) {
        expect(prop.description, `${name}.${key} missing description`).toBeTruthy();
        expect(["string", "number", "boolean", "array", "object"]).toContain(prop.type);
      }
      // Every required arg is actually declared.
      for (const req of def.parameters.required) {
        expect(def.parameters.properties).toHaveProperty(req);
      }
    },
  );

  it("scene_init requires only `dir`; scene_add requires only `name`; lint+render are arg-free", () => {
    const byName = Object.fromEntries(sceneToolDefinitions.map((d) => [d.name, d]));
    expect(byName.scene_init.parameters.required).toEqual(["dir"]);
    expect(byName.scene_add.parameters.required).toEqual(["name"]);
    expect(byName.scene_lint.parameters.required).toEqual([]);
    expect(byName.scene_render.parameters.required).toEqual([]);
  });
});

describe("scene_init handler", () => {
  it("scaffolds a project relative to the agent's working directory", async () => {
    const cwd = await makeTmp();
    const handler = registry.getHandler("scene_init")!;
    const result = await handler({ dir: "promo", aspect: "9:16", duration: 8 }, ctx(cwd));

    expect(result.success).toBe(true);
    expect(result.output).toContain("Scene project scaffolded at promo");
    expect(await pathExists(resolve(cwd, "promo/index.html"))).toBe(true);
    expect(await pathExists(resolve(cwd, "promo/vibe.project.yaml"))).toBe(true);
    expect(await pathExists(resolve(cwd, "promo/compositions"))).toBe(true);
  });
});

describe("scene_add handler — offline path", () => {
  it("adds a scene with skipAudio + skipImage and reports the new clip start/duration", async () => {
    const cwd = await makeTmp();
    await registry.getHandler("scene_init")!({ dir: ".", aspect: "16:9", duration: 6 }, ctx(cwd));

    const result = await registry.getHandler("scene_add")!({
      name: "Intro Scene",
      preset: "announcement",
      headline: "Hello",
      duration: 4,
      skipAudio: true,
      skipImage: true,
    }, ctx(cwd));

    expect(result.success).toBe(true);
    expect(result.output).toContain('Added scene "intro-scene"');
    expect(result.output).toContain("preset=announcement");
    expect(result.output).toContain("start:    0.00s");
    expect(result.output).toContain("duration: 4.00s");

    const sceneFile = await readFile(resolve(cwd, "compositions/scene-intro-scene.html"), "utf-8");
    expect(sceneFile).toContain("Hello");
    expect(sceneFile).not.toContain("<audio");
  });

  it("returns a structured failure when a scene file already exists (no --force)", async () => {
    const cwd = await makeTmp();
    await registry.getHandler("scene_init")!({ dir: "." }, ctx(cwd));
    await registry.getHandler("scene_add")!({
      name: "intro", duration: 3, skipAudio: true, skipImage: true,
    }, ctx(cwd));

    const second = await registry.getHandler("scene_add")!({
      name: "intro", duration: 3, skipAudio: true, skipImage: true,
    }, ctx(cwd));
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already exists/);
  });
});

describe("scene_lint handler — offline path", () => {
  it("reports ok for a freshly scaffolded + populated project", async () => {
    const cwd = await makeTmp();
    await registry.getHandler("scene_init")!({ dir: "." }, ctx(cwd));
    await registry.getHandler("scene_add")!({
      name: "hello", duration: 3, skipAudio: true, skipImage: true,
    }, ctx(cwd));

    const result = await registry.getHandler("scene_lint")!({}, ctx(cwd));
    expect(result.success).toBe(true);
    expect(result.output).toContain("Lint clean");
  });

  it("on an empty dir reports ok with zero findings (linter sees no files, the agent does not second-guess)", async () => {
    const cwd = await makeTmp();
    const result = await registry.getHandler("scene_lint")!({}, ctx(cwd));
    expect(result.success).toBe(true);
    expect(result.output).toContain("0 error(s)");
    expect(result.output).toContain("0 warning(s)");
  });
});

describe("scene_render handler — Chrome-gated", () => {
  it("returns a structured Chrome-not-found error when Chrome is missing OR the project is missing", async () => {
    // We don't try to render — we just exercise the validation surface so the
    // test stays Chrome-free. With a non-existent project the handler fails
    // before reaching the Chrome preflight.
    const cwd = await makeTmp();
    const result = await registry.getHandler("scene_render")!({
      projectDir: "no-such-dir",
    }, ctx(cwd));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Project directory not found|Chrome not found|Root composition not found/);
  });
});
