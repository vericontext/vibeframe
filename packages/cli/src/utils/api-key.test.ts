import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEnv, getApiKey } from "./api-key.js";

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
});
