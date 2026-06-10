import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadEnv,
  getApiKey,
  getConfiguredApiKey,
  hasConfiguredApiKey,
  hasApiKey,
  providerKeyForEnvVar,
} from "./api-key.js";

describe("api-key utilities", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadEnv", () => {
    it("does not throw when .env file is missing", () => {
      expect(() => loadEnv()).not.toThrow();
    });

    it("walks parent directories: nearest .env wins, ancestors fill gaps, env vars never overridden", async () => {
      const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const root = await mkdtemp(join(tmpdir(), "vibe-loadenv-"));
      const workspace = join(root, "workspace");
      const project = join(workspace, "project");
      await mkdir(project, { recursive: true });
      await writeFile(
        join(workspace, ".env"),
        "VIBE_TEST_SHARED=workspace\nVIBE_TEST_ANCESTOR_ONLY=workspace\nVIBE_TEST_PRESET=workspace\n",
        "utf-8"
      );
      await writeFile(join(project, ".env"), "VIBE_TEST_SHARED=project\n", "utf-8");

      delete process.env.VIBE_TEST_SHARED;
      delete process.env.VIBE_TEST_ANCESTOR_ONLY;
      process.env.VIBE_TEST_PRESET = "from-shell";
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(project);
      try {
        loadEnv();
        // cwd .env wins for overlapping vars
        expect(process.env.VIBE_TEST_SHARED).toBe("project");
        // ancestor-only vars are discovered by the upward walk
        expect(process.env.VIBE_TEST_ANCESTOR_ONLY).toBe("workspace");
        // already-set process env always wins
        expect(process.env.VIBE_TEST_PRESET).toBe("from-shell");
      } finally {
        cwdSpy.mockRestore();
        delete process.env.VIBE_TEST_SHARED;
        delete process.env.VIBE_TEST_ANCESTOR_ONLY;
        delete process.env.VIBE_TEST_PRESET;
      }
    });
  });

  describe("getApiKey", () => {
    it("maps Seedance fal.ai env var to the stored config provider key", () => {
      expect(providerKeyForEnvVar("FAL_API_KEY")).toBe("fal");
    });

    it("returns option value if provided", async () => {
      const result = await getApiKey("TEST_KEY", "Test", "my-api-key");
      expect(result).toBe("my-api-key");
    });

    it("returns env value if option not provided", async () => {
      process.env.TEST_KEY = "env-api-key";
      const result = await getApiKey("TEST_KEY", "Test");
      expect(result).toBe("env-api-key");
    });

    it("returns null when no key available and not TTY", async () => {
      // In test environment, stdin is not TTY, so it should return null
      delete process.env.TEST_KEY;
      const result = await getApiKey("TEST_KEY", "Test");
      expect(result).toBeNull();
    });
  });

  describe("getConfiguredApiKey", () => {
    it("returns option value without prompting", async () => {
      const result = await getConfiguredApiKey("TEST_KEY", "option-key");
      expect(result).toBe("option-key");
    });

    it("returns env value without prompting", async () => {
      process.env.TEST_KEY = "env-api-key";
      const result = await getConfiguredApiKey("TEST_KEY");
      expect(result).toBe("env-api-key");
      await expect(hasConfiguredApiKey("TEST_KEY")).resolves.toBe(true);
    });

    it("returns undefined when no non-interactive key source exists", async () => {
      delete process.env.TEST_KEY;
      const result = await getConfiguredApiKey("TEST_KEY");
      expect(result).toBeUndefined();
      await expect(hasConfiguredApiKey("TEST_KEY")).resolves.toBe(false);
    });
  });

  describe("hasApiKey", () => {
    // Regression: prior implementation called the async
    // `getApiKeyFromConfig(envVar)` without `await`, so `!!Promise` always
    // returned `true`. That made `vibe scene add --tts auto` always pick
    // ElevenLabs even when no key was present — defeating the v0.54
    // local-Kokoro fallback.

    it("returns true when env var is set", () => {
      process.env.TEST_PROBE_KEY = "actual-secret";
      expect(hasApiKey("TEST_PROBE_KEY")).toBe(true);
    });

    it("returns false when env var is unset", () => {
      delete process.env.TEST_PROBE_KEY;
      expect(hasApiKey("TEST_PROBE_KEY")).toBe(false);
    });

    it("returns false for empty-string env var", () => {
      process.env.TEST_PROBE_KEY = "";
      expect(hasApiKey("TEST_PROBE_KEY")).toBe(false);
    });
  });
});
