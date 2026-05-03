import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { join, resolve } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { createDefaultConfig, type VibeConfig } from "./schema.js";

// Mock homedir → unique tmp dir per test run.
const TEST_HOME = resolve(tmpdir(), `vibe-scope-home-${Date.now()}`);
const ORIGINAL_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const ORIGINAL_XDG_CACHE_HOME = process.env.XDG_CACHE_HOME;
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;
const ORIGINAL_VIBEFRAME_CONFIG_HOME = process.env.VIBEFRAME_CONFIG_HOME;
const ORIGINAL_VIBEFRAME_CACHE_HOME = process.env.VIBEFRAME_CACHE_HOME;

process.env.VIBEFRAME_CONFIG_HOME = resolve(TEST_HOME, ".vibeframe");
process.env.VIBEFRAME_CACHE_HOME = resolve(TEST_HOME, ".vibeframe", "cache");
process.env.XDG_CONFIG_HOME = resolve(TEST_HOME, ".config");
process.env.XDG_CACHE_HOME = resolve(TEST_HOME, ".cache");
process.env.XDG_DATA_HOME = resolve(TEST_HOME, ".local", "share");

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...(actual as object),
    homedir: () => TEST_HOME,
  };
});

const {
  loadConfig,
  saveConfig,
  findProjectConfigPath,
  getActiveScope,
  USER_CONFIG_DIR,
  USER_CONFIG_PATH,
  getProjectConfigDir,
  getProjectConfigPath,
  getUserConfigStatus,
} = await import("./index.js");

afterAll(() => {
  if (ORIGINAL_XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG_CONFIG_HOME;
  if (ORIGINAL_XDG_CACHE_HOME === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIGINAL_XDG_CACHE_HOME;
  if (ORIGINAL_XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = ORIGINAL_XDG_DATA_HOME;
  if (ORIGINAL_VIBEFRAME_CONFIG_HOME === undefined) delete process.env.VIBEFRAME_CONFIG_HOME;
  else process.env.VIBEFRAME_CONFIG_HOME = ORIGINAL_VIBEFRAME_CONFIG_HOME;
  if (ORIGINAL_VIBEFRAME_CACHE_HOME === undefined) delete process.env.VIBEFRAME_CACHE_HOME;
  else process.env.VIBEFRAME_CACHE_HOME = ORIGINAL_VIBEFRAME_CACHE_HOME;
});

const PROJECT_CWD = resolve(tmpdir(), `vibe-scope-project-${Date.now()}`);

async function clean(): Promise<void> {
  await rm(TEST_HOME, { recursive: true, force: true });
  await rm(PROJECT_CWD, { recursive: true, force: true });
}

async function writeUserConfig(partial: Partial<VibeConfig>): Promise<void> {
  await mkdir(USER_CONFIG_DIR, { recursive: true });
  const cfg: VibeConfig = { ...createDefaultConfig(), ...partial };
  await writeFile(USER_CONFIG_PATH, stringify(cfg), "utf-8");
}

async function writeProjectConfig(partial: Partial<VibeConfig>): Promise<void> {
  await mkdir(getProjectConfigDir(PROJECT_CWD), { recursive: true });
  const cfg: VibeConfig = { ...createDefaultConfig(), ...partial };
  await writeFile(getProjectConfigPath(PROJECT_CWD), stringify(cfg), "utf-8");
}

describe("Config scope", () => {
  beforeEach(clean);
  afterEach(clean);

  describe("getActiveScope", () => {
    it("returns 'user' when no project config exists at cwd", async () => {
      expect(await getActiveScope(PROJECT_CWD)).toBe("user");
    });

    it("does not treat ~/.vibeframe/config.yaml as a parent project config", async () => {
      await writeUserConfig({ llm: { provider: "claude" } });
      const nestedCwd = resolve(TEST_HOME, "dev", "project");
      expect(await getActiveScope(nestedCwd)).toBe("user");
      expect(await findProjectConfigPath(nestedCwd)).toBeNull();
    });

    it("returns 'project' when a project config exists at cwd", async () => {
      await writeProjectConfig({ llm: { provider: "openai" } });
      expect(await getActiveScope(PROJECT_CWD)).toBe("project");
    });

    it("returns 'project' when a project config exists in an ancestor", async () => {
      await writeProjectConfig({ llm: { provider: "openai" } });
      expect(await getActiveScope(join(PROJECT_CWD, "nested", "scene"))).toBe("project");
    });
  });

  describe("loadConfig (auto)", () => {
    it("returns null when neither config exists", async () => {
      const cfg = await loadConfig({ cwd: PROJECT_CWD });
      expect(cfg).toBeNull();
    });

    it("falls back to user when no project config exists", async () => {
      await writeUserConfig({ llm: { provider: "claude" } });
      const cfg = await loadConfig({ cwd: PROJECT_CWD });
      expect(cfg?.llm.provider).toBe("claude");
    });

    it("prefers project when both exist (project-only semantics)", async () => {
      await writeUserConfig({
        llm: { provider: "claude" },
        providers: { anthropic: "user-key" },
      });
      await writeProjectConfig({
        llm: { provider: "openai" },
        providers: { openai: "project-key" },
      });

      const cfg = await loadConfig({ cwd: PROJECT_CWD });
      expect(cfg?.llm.provider).toBe("openai");
      // user's anthropic key must NOT leak through in auto mode
      expect(cfg?.providers.anthropic).toBeUndefined();
      expect(cfg?.providers.openai).toBe("project-key");
    });

    it("finds project config from nested working directories", async () => {
      await writeProjectConfig({
        llm: { provider: "openai" },
        providers: { openai: "project-openai" },
      });

      const cfg = await loadConfig({ cwd: join(PROJECT_CWD, "nested", "scene") });
      expect(cfg?.llm.provider).toBe("openai");
      expect(cfg?.providers.openai).toBe("project-openai");
    });
  });

  describe("loadConfig (explicit scope)", () => {
    it("scope:'user' ignores project even when project exists", async () => {
      await writeUserConfig({ llm: { provider: "claude" } });
      await writeProjectConfig({ llm: { provider: "openai" } });

      const cfg = await loadConfig({ scope: "user", cwd: PROJECT_CWD });
      expect(cfg?.llm.provider).toBe("claude");
    });

    it("scope:'project' ignores user even when only user exists", async () => {
      await writeUserConfig({ llm: { provider: "claude" } });
      const cfg = await loadConfig({ scope: "project", cwd: PROJECT_CWD });
      expect(cfg).toBeNull();
    });
  });

  describe("loadConfig (merge:true)", () => {
    it("overlays project on user, project wins per-key", async () => {
      await writeUserConfig({
        llm: { provider: "claude" },
        providers: { anthropic: "user-anthropic", openai: "user-openai" },
      });
      await writeProjectConfig({
        providers: { openai: "project-openai" },
      });

      const cfg = await loadConfig({ merge: true, cwd: PROJECT_CWD });
      // user-only key survives
      expect(cfg?.providers.anthropic).toBe("user-anthropic");
      // project overrides shared key
      expect(cfg?.providers.openai).toBe("project-openai");
      // user llm.provider survives because project didn't set it explicitly
      // (createDefaultConfig sets claude — both files end up with provider:claude
      // after applyDefaults; this test asserts merge semantics, not defaults).
      expect(cfg?.llm.provider).toBe("claude");
    });

    it("overlays ancestor project config on user", async () => {
      await writeUserConfig({
        providers: { anthropic: "user-anthropic", openai: "user-openai" },
      });
      await writeProjectConfig({
        providers: { openai: "project-openai" },
      });

      const cfg = await loadConfig({ merge: true, cwd: join(PROJECT_CWD, "nested") });
      expect(cfg?.providers.anthropic).toBe("user-anthropic");
      expect(cfg?.providers.openai).toBe("project-openai");
    });

    it("returns null when neither config exists", async () => {
      const cfg = await loadConfig({ merge: true, cwd: PROJECT_CWD });
      expect(cfg).toBeNull();
    });
  });

  describe("saveConfig (scope)", () => {
    it("default scope is 'user' and writes ~/.vibeframe config", async () => {
      const cfg = createDefaultConfig();
      cfg.llm.provider = "openai";
      await saveConfig(cfg);

      const back = await loadConfig({ scope: "user" });
      expect(back?.llm.provider).toBe("openai");
      const status = await getUserConfigStatus();
      expect(status.configPath).toBe(USER_CONFIG_PATH);
      expect(status.source).toBe("user");

      const project = await loadConfig({ scope: "project", cwd: PROJECT_CWD });
      expect(project).toBeNull();
    });

    it("scope:'project' writes to <cwd>/.vibeframe/config.yaml", async () => {
      const cfg = createDefaultConfig();
      cfg.llm.provider = "gemini";
      cfg.providers.google = "g-key";

      await saveConfig(cfg, { scope: "project", cwd: PROJECT_CWD });

      const back = await loadConfig({ scope: "project", cwd: PROJECT_CWD });
      expect(back?.llm.provider).toBe("gemini");
      expect(back?.providers.google).toBe("g-key");

      const user = await loadConfig({ scope: "user" });
      expect(user).toBeNull();
    });
  });
});
