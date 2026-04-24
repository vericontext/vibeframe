import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as yamlParse } from "yaml";

import {
  aspectToDims,
  buildEmptyRootHtml,
  buildHyperframesConfig,
  buildHyperframesMeta,
  buildProjectClaudeMd,
  buildSceneGitignore,
  defaultVibeProjectConfig,
  mergeHyperframesConfig,
  scaffoldSceneProject,
  type HyperframesConfig,
} from "./scene-project.js";

async function makeTmp(label = "vibe-scene-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), label));
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

describe("aspectToDims", () => {
  it.each([
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["1:1",  1080, 1080],
    ["4:5",  1080, 1350],
  ] as const)("%s → %dx%d", (ratio, w, h) => {
    expect(aspectToDims(ratio)).toEqual({ width: w, height: h });
  });
});

describe("buildHyperframesConfig", () => {
  it("produces the shape expected by hyperframes CLI", () => {
    const cfg = buildHyperframesConfig();
    expect(cfg.$schema).toContain("hyperframes.json");
    expect(cfg.paths).toEqual({
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets",
    });
  });
});

describe("buildHyperframesMeta", () => {
  it("uses project name as both id and name", () => {
    const meta = buildHyperframesMeta("my-video", new Date("2026-04-25T00:00:00Z"));
    expect(meta).toEqual({
      id: "my-video",
      name: "my-video",
      createdAt: "2026-04-25T00:00:00.000Z",
    });
  });
});

describe("mergeHyperframesConfig", () => {
  it("preserves existing top-level keys", () => {
    const existing: HyperframesConfig = {
      $schema: "custom-schema",
      registry: "https://my.registry/",
      customField: "user-value",
    };
    const merged = mergeHyperframesConfig(existing, buildHyperframesConfig());
    expect(merged.$schema).toBe("custom-schema");
    expect(merged.registry).toBe("https://my.registry/");
    expect(merged.customField).toBe("user-value");
  });

  it("shallow-merges nested paths preserving user keys", () => {
    const existing: HyperframesConfig = {
      paths: { blocks: "custom-blocks", assets: "media" },
    };
    const merged = mergeHyperframesConfig(existing, buildHyperframesConfig());
    expect(merged.paths).toEqual({
      blocks: "custom-blocks",         // preserved
      components: "compositions/components", // from defaults
      assets: "media",                 // preserved
    });
  });

  it("falls back to defaults when existing is empty", () => {
    const merged = mergeHyperframesConfig({}, buildHyperframesConfig());
    expect(merged).toEqual(buildHyperframesConfig());
  });
});

describe("buildEmptyRootHtml", () => {
  it("embeds aspect-correct canvas dimensions", () => {
    const html = buildEmptyRootHtml({ aspect: "9:16", duration: 12 });
    expect(html).toContain("width: 1080px");
    expect(html).toContain("height: 1920px");
    expect(html).toContain('data-duration="12"');
    expect(html).toContain('data-composition-id="main"');
  });

  it("registers a paused main timeline", () => {
    const html = buildEmptyRootHtml({ aspect: "16:9", duration: 5 });
    expect(html).toContain('window.__timelines["main"] = gsap.timeline({ paused: true });');
  });
});

describe("buildProjectClaudeMd", () => {
  it("names the project and references both toolchains", () => {
    const md = buildProjectClaudeMd("my-promo");
    expect(md).toContain("# my-promo");
    expect(md).toContain("/vibe-scene");
    expect(md).toContain("/hyperframes");
    expect(md).toContain("vibe scene add");
    expect(md).toContain("npx hyperframes");
  });
});

describe("buildSceneGitignore", () => {
  it("excludes caches and rendered outputs", () => {
    const out = buildSceneGitignore();
    expect(out).toContain(".vibeframe/cache/");
    expect(out).toContain("renders/*.mp4");
  });
});

describe("defaultVibeProjectConfig", () => {
  it("produces sane defaults", () => {
    const cfg = defaultVibeProjectConfig("promo");
    expect(cfg.name).toBe("promo");
    expect(cfg.aspect).toBe("16:9");
    expect(cfg.defaultSceneDuration).toBe(5);
    expect(cfg.providers).toEqual({ image: null, tts: null, transcribe: null });
    expect(cfg.budget.maxUsd).toBe(0);
  });
});

describe("scaffoldSceneProject", () => {
  it("creates all expected files in an empty directory", async () => {
    const dir = await makeTmp();
    const result = await scaffoldSceneProject({
      dir,
      name: "fixture",
      aspect: "16:9",
      duration: 8,
      now: new Date("2026-04-25T00:00:00Z"),
    });

    const expected = [
      "hyperframes.json",
      "meta.json",
      "index.html",
      "vibe.project.yaml",
      "CLAUDE.md",
      ".gitignore",
    ];
    for (const f of expected) {
      expect(await pathExists(resolve(dir, f))).toBe(true);
    }
    expect(await pathExists(resolve(dir, "compositions"))).toBe(true);
    expect(await pathExists(resolve(dir, "assets"))).toBe(true);

    expect(result.created.length).toBe(expected.length);
    expect(result.merged).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("vibe.project.yaml parses as valid YAML and carries the chosen aspect", async () => {
    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "9:16", duration: 10 });
    const raw = await readFile(resolve(dir, "vibe.project.yaml"), "utf-8");
    const parsed = yamlParse(raw);
    expect(parsed).toMatchObject({
      name: "fixture",
      aspect: "9:16",
      defaultSceneDuration: 5,
      providers: { image: null, tts: null, transcribe: null },
    });
  });

  it("is idempotent: running twice is a no-op (no overwrites of user-editable files)", async () => {
    const dir = await makeTmp();
    const first = await scaffoldSceneProject({ dir, name: "fixture" });
    const claudeBefore = await readFile(resolve(dir, "CLAUDE.md"), "utf-8");

    // User edits CLAUDE.md
    await writeFile(resolve(dir, "CLAUDE.md"), claudeBefore + "\n\n## My notes\n\nHand-written.\n", "utf-8");

    const second = await scaffoldSceneProject({ dir, name: "fixture" });
    const claudeAfter = await readFile(resolve(dir, "CLAUDE.md"), "utf-8");

    // CLAUDE.md edit survives.
    expect(claudeAfter).toContain("Hand-written.");
    // Second run reports every non-hyperframes.json file as skipped.
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    // hyperframes.json is always merge-updated (idempotent shape).
    expect(second.merged.map((p) => p.split("/").pop())).toContain("hyperframes.json");
    // First run created hyperframes.json; second merged it.
    expect(first.created.map((p) => p.split("/").pop())).toContain("hyperframes.json");
  });

  it("preserves user keys in existing hyperframes.json (merge, not overwrite)", async () => {
    const dir = await makeTmp();
    await mkdir(dir, { recursive: true });
    // Pre-seed a Hyperframes project with custom paths + user field.
    const preExisting = {
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      paths: { blocks: "custom-blocks", assets: "media" },
      userField: "kept",
    };
    await writeFile(resolve(dir, "hyperframes.json"), JSON.stringify(preExisting, null, 2) + "\n", "utf-8");

    const result = await scaffoldSceneProject({ dir, name: "fixture" });

    const merged = JSON.parse(await readFile(resolve(dir, "hyperframes.json"), "utf-8"));
    expect(merged.userField).toBe("kept");
    expect(merged.paths.blocks).toBe("custom-blocks");
    expect(merged.paths.assets).toBe("media");
    // Default key backfilled:
    expect(merged.paths.components).toBe("compositions/components");

    expect(result.merged.some((p) => p.endsWith("hyperframes.json"))).toBe(true);
  });

  it("creates index.html with the correct aspect", async () => {
    const dir = await makeTmp();
    await scaffoldSceneProject({ dir, name: "fixture", aspect: "1:1", duration: 6 });
    const html = await readFile(resolve(dir, "index.html"), "utf-8");
    expect(html).toContain("width: 1080px");
    expect(html).toContain("height: 1080px");
    expect(html).toContain('data-duration="6"');
  });
});
