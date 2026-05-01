import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "node:path";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { createDefaultConfig, type VibeConfig } from "./schema.js";

// Mock homedir → unique tmp dir per test run.
const TEST_HOME = resolve(tmpdir(), `vibe-scope-home-${Date.now()}`);

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
  getActiveScope,
  USER_CONFIG_DIR,
  USER_CONFIG_PATH,
  getProjectConfigDir,
  getProjectConfigPath,
} = await import("./index.js");

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

    it("returns 'project' when a project config exists at cwd", async () => {
      await writeProjectConfig({ llm: { provider: "openai" } });
      expect(await getActiveScope(PROJECT_CWD)).toBe("project");
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

    it("returns null when neither config exists", async () => {
      const cfg = await loadConfig({ merge: true, cwd: PROJECT_CWD });
      expect(cfg).toBeNull();
    });
  });

  describe("saveConfig (scope)", () => {
    it("default scope is 'user' (back-compat)", async () => {
      const cfg = createDefaultConfig();
      cfg.llm.provider = "openai";
      await saveConfig(cfg);

      const back = await loadConfig({ scope: "user" });
      expect(back?.llm.provider).toBe("openai");

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
