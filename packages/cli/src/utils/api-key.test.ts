import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEnv, getApiKey, hasApiKey } from "./api-key.js";

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
  });

  describe("getApiKey", () => {
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
