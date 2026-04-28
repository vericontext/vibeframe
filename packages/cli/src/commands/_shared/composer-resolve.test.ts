import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ComposerResolveError,
  composerEnvVar,
  composerLabel,
  isComposerProvider,
  resolveComposer,
} from "./composer-resolve.js";

describe("composer-resolve", () => {
  // Snapshot all three keys so tests can mutate freely without leaking state.
  const originals = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("isComposerProvider", () => {
    it("accepts the three valid ids", () => {
      expect(isComposerProvider("claude")).toBe(true);
      expect(isComposerProvider("openai")).toBe(true);
      expect(isComposerProvider("gemini")).toBe(true);
    });
    it("rejects anything else", () => {
      expect(isComposerProvider("anthropic")).toBe(false);
      expect(isComposerProvider("gpt")).toBe(false);
      expect(isComposerProvider("")).toBe(false);
      expect(isComposerProvider(undefined)).toBe(false);
      expect(isComposerProvider(123)).toBe(false);
    });
  });

  describe("composerEnvVar / composerLabel", () => {
    it("maps each provider to its canonical env var", () => {
      expect(composerEnvVar("claude")).toBe("ANTHROPIC_API_KEY");
      expect(composerEnvVar("openai")).toBe("OPENAI_API_KEY");
      expect(composerEnvVar("gemini")).toBe("GOOGLE_API_KEY");
    });
    it("returns a human label for each provider", () => {
      expect(composerLabel("claude")).toContain("Claude");
      expect(composerLabel("openai")).toContain("OpenAI");
      expect(composerLabel("gemini")).toContain("Gemini");
    });
  });

  describe("resolveComposer", () => {
    it("auto-resolves to claude when ANTHROPIC_API_KEY is set", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-x";
      const r = resolveComposer();
      expect(r).toEqual({ provider: "claude", apiKey: "sk-ant-x" });
    });

    it("auto-resolves to gemini when only GOOGLE_API_KEY is set", () => {
      process.env.GOOGLE_API_KEY = "key-google";
      const r = resolveComposer();
      expect(r).toEqual({ provider: "gemini", apiKey: "key-google" });
    });

    it("auto-resolves to openai when only OPENAI_API_KEY is set", () => {
      process.env.OPENAI_API_KEY = "sk-openai";
      const r = resolveComposer();
      expect(r).toEqual({ provider: "openai", apiKey: "sk-openai" });
    });

    it("prefers claude > gemini > openai when multiple keys present", () => {
      process.env.ANTHROPIC_API_KEY = "a";
      process.env.GOOGLE_API_KEY = "g";
      process.env.OPENAI_API_KEY = "o";
      expect(resolveComposer().provider).toBe("claude");

      delete process.env.ANTHROPIC_API_KEY;
      expect(resolveComposer().provider).toBe("gemini");

      delete process.env.GOOGLE_API_KEY;
      expect(resolveComposer().provider).toBe("openai");
    });

    it("returns the explicit provider when set + key present", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant";
      process.env.GOOGLE_API_KEY = "key-google";
      const r = resolveComposer("gemini");
      expect(r).toEqual({ provider: "gemini", apiKey: "key-google" });
    });

    it("throws ComposerResolveError when no keys are set", () => {
      try {
        resolveComposer();
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ComposerResolveError);
        expect((err as ComposerResolveError).code).toBe("no-key-available");
        expect((err as Error).message).toContain("ANTHROPIC_API_KEY");
        expect((err as Error).message).toContain("OPENAI_API_KEY");
        expect((err as Error).message).toContain("GOOGLE_API_KEY");
      }
    });

    it("throws ComposerResolveError when explicit provider's key is missing", () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant";
      try {
        resolveComposer("openai");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ComposerResolveError);
        expect((err as ComposerResolveError).code).toBe("missing-explicit-key");
        expect((err as ComposerResolveError).meta.requestedProvider).toBe("openai");
        expect((err as Error).message).toContain("OPENAI_API_KEY");
      }
    });

    it("treats empty-string keys as absent", () => {
      process.env.ANTHROPIC_API_KEY = "";
      process.env.GOOGLE_API_KEY = "valid";
      expect(resolveComposer().provider).toBe("gemini");
    });
  });
});
