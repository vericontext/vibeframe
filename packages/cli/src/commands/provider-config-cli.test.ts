import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../../dist/index.js");

function makeProject(): { root: string; scene: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "vibe-provider-config-"));
  const home = mkdtempSync(join(tmpdir(), "vibe-provider-home-"));
  const scene = join(root, "launch");
  mkdirSync(join(root, ".vibeframe"), { recursive: true });
  mkdirSync(scene, { recursive: true });
  writeFileSync(
    join(root, ".vibeframe", "config.yaml"),
    [
      "providers:",
      "  openai: sk-project-openai",
      "  xai: xai-project-key",
      "  fal: fal-project-key",
      "  kling: kling-project-key",
      "defaults:",
      "  imageProvider: openai",
      "  videoProvider: seedance",
      "",
    ].join("\n")
  );
  return {
    root,
    scene,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
    },
  };
}

function runJson(cwd: string, env: NodeJS.ProcessEnv, args: string[]): Record<string, unknown> {
  const out = execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out) as Record<string, unknown>;
}

describe("project-scope provider config from nested scene directories", () => {
  it("keeps explicit image provider when its key is only in ancestor project config", () => {
    const { scene, env } = makeProject();
    const json = runJson(scene, env, [
      "generate",
      "image",
      "logo end card",
      "--dry-run",
      "--json",
      "-p",
      "grok",
    ]);
    expect(json).toMatchObject({
      data: { params: { provider: "grok" } },
    });
  });

  it("keeps explicit video provider when its key is only in ancestor project config", () => {
    const { scene, env } = makeProject();
    const json = runJson(scene, env, [
      "generate",
      "video",
      "logo end card",
      "--dry-run",
      "--json",
      "-p",
      "kling",
    ]);
    expect(json).toMatchObject({
      data: { params: { provider: "kling" } },
    });
  });
});
