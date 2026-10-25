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

describe("an explicit provider whose key is missing", () => {
  // The project config holds fal and openai keys but no runway or gemini key,
  // so a fallback would have a paid provider to swap in.
  for (const [command, provider, envVar] of [
    ["video", "runway", "RUNWAY_API_SECRET"],
    ["image", "gemini", "GOOGLE_API_KEY"],
  ] as const) {
    it(`generate ${command} -p ${provider} keeps ${provider} and warns in the dry run`, () => {
      const { scene, env } = makeProject();
      const json = runJson(scene, env, ["generate", command, "a cat", "--dry-run", "--json", "-p", provider]);
      expect(json).toMatchObject({ data: { params: { provider } } });
      expect(json.warnings).toEqual(expect.arrayContaining([expect.stringContaining(`${envVar} is not set`)]));
    });

    it(`generate ${command} -p ${provider} fails on the missing key instead of spending elsewhere`, () => {
      const { scene, env } = makeProject();
      let stderr = "";
      let status: number | null = 0;
      try {
        execFileSync(process.execPath, [CLI, "generate", command, "a cat", "--json", "-p", provider], {
          cwd: scene,
          env,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        ({ stderr, status } = error as { stderr: string; status: number | null });
      }
      expect(status).not.toBe(0);
      expect(JSON.parse(stderr)).toMatchObject({ success: false, error: expect.stringContaining("API key required") });
    });
  }
});
