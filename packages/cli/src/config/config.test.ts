import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "node:path";
import { rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createDefaultConfig,
  PROVIDER_NAMES,
  PROVIDER_ENV_VARS,
  type VibeConfig,
} from "./schema.js";

// Mock homedir for tests
const TEST_HOME = resolve(tmpdir(), `vibe-config-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual("node:os");
  return {
    ...(actual as object),
    homedir: () => TEST_HOME,
  };
});

// Import after mock
const { loadConfig, saveConfig, isConfigured, CONFIG_DIR, CONFIG_PATH } = await import("./index.js");

describe("Config Schema", () => {
  describe("createDefaultConfig", () => {
    it("creates a valid default configuration", () => {
      const config = createDefaultConfig();

      expect(config.version).toBe("1.0.0");
      expect(config.llm.provider).toBe("claude");
      expect(config.providers).toEqual({});
      expect(config.defaults.aspectRatio).toBe("16:9");
      expect(config.defaults.exportQuality).toBe("standard");
      expect(config.repl.autoSave).toBe(true);
    });
  });

  describe("PROVIDER_NAMES", () => {
    it("has display names for all providers", () => {
      expect(PROVIDER_NAMES.claude).toBe("Claude (Anthropic)");
      expect(PROVIDER_NAMES.openai).toBe("GPT-4 (OpenAI)");
      expect(PROVIDER_NAMES.gemini).toBe("Gemini (Google)");
      expect(PROVIDER_NAMES.ollama).toBe("Ollama (Local)");
    });
  });

  describe("PROVIDER_ENV_VARS", () => {
    it("has environment variables for all providers", () => {
      expect(PROVIDER_ENV_VARS.anthropic).toBe("ANTHROPIC_API_KEY");
      expect(PROVIDER_ENV_VARS.openai).toBe("OPENAI_API_KEY");
      expect(PROVIDER_ENV_VARS.google).toBe("GOOGLE_API_KEY");
      expect(PROVIDER_ENV_VARS.elevenlabs).toBe("ELEVENLABS_API_KEY");
      expect(PROVIDER_ENV_VARS.runway).toBe("RUNWAY_API_SECRET");
      expect(PROVIDER_ENV_VARS.kling).toBe("KLING_API_KEY");
      expect(PROVIDER_ENV_VARS.stability).toBe("STABILITY_API_KEY");
      expect(PROVIDER_ENV_VARS.replicate).toBe("REPLICATE_API_TOKEN");
    });
  });
});

describe("Config Loader", () => {
  beforeEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("loadConfig", () => {
    it("returns null when config does not exist", async () => {
      const config = await loadConfig();
      expect(config).toBeNull();
    });

    it("loads existing config", async () => {
      // Create config directory and file
      await mkdir(CONFIG_DIR, { recursive: true });
      const testConfig: VibeConfig = {
        version: "1.0.0",
        llm: { provider: "openai" },
        providers: { openai: "test-key" },
        defaults: { aspectRatio: "9:16", exportQuality: "high" },
        repl: { autoSave: false },
      };

      const { writeFile: fsWrite } = await import("node:fs/promises");
      const { stringify } = await import("yaml");
      await fsWrite(CONFIG_PATH, stringify(testConfig), "utf-8");

      const loaded = await loadConfig();
      expect(loaded).not.toBeNull();
      expect(loaded?.llm.provider).toBe("openai");
      expect(loaded?.providers.openai).toBe("test-key");
      expect(loaded?.defaults.aspectRatio).toBe("9:16");
      expect(loaded?.repl.autoSave).toBe(false);
    });

    it("merges with defaults for missing fields", async () => {
      await mkdir(CONFIG_DIR, { recursive: true });
      const partialConfig = {
        version: "1.0.0",
        llm: { provider: "gemini" },
        providers: {},
        defaults: {},
        repl: {},
      };

      const { writeFile: fsWrite } = await import("node:fs/promises");
      const { stringify } = await import("yaml");
      await fsWrite(CONFIG_PATH, stringify(partialConfig), "utf-8");

      const loaded = await loadConfig();
      expect(loaded?.llm.provider).toBe("gemini");
      expect(loaded?.defaults.aspectRatio).toBe("16:9"); // Default
      expect(loaded?.repl.autoSave).toBe(true); // Default
    });
  });

  describe("saveConfig", () => {
    it("creates config directory and file", async () => {
      const config = createDefaultConfig();
      config.llm.provider = "openai";
      config.providers.openai = "sk-test-123";

      await saveConfig(config);

      const content = await readFile(CONFIG_PATH, "utf-8");
      expect(content).toContain("provider: openai");
      expect(content).toContain("openai: sk-test-123");
    });

    it("overwrites existing config", async () => {
      const config1 = createDefaultConfig();
      config1.llm.provider = "claude";
      await saveConfig(config1);

      const config2 = createDefaultConfig();
      config2.llm.provider = "gemini";
      await saveConfig(config2);

      const loaded = await loadConfig();
      expect(loaded?.llm.provider).toBe("gemini");
    });
  });

  describe("isConfigured", () => {
    it("returns false when no config exists", async () => {
      const configured = await isConfigured();
      expect(configured).toBe(false);
    });

    it("returns false when config exists but no API key", async () => {
      const config = createDefaultConfig();
      await saveConfig(config);

      const configured = await isConfigured();
      expect(configured).toBe(false);
    });

    it("returns true when API key is in config", async () => {
      const config = createDefaultConfig();
      config.llm.provider = "claude";
      config.providers.anthropic = "test-key";
      await saveConfig(config);

      const configured = await isConfigured();
      expect(configured).toBe(true);
    });

    it("returns true when API key is in environment", async () => {
      const config = createDefaultConfig();
      config.llm.provider = "openai";
      await saveConfig(config);

      // Set environment variable
      process.env.OPENAI_API_KEY = "test-env-key";

      const configured = await isConfigured();
      expect(configured).toBe(true);

      // Clean up
      delete process.env.OPENAI_API_KEY;
    });
  });
});
