import { describe, expect, it } from "vitest";

import { MODEL_CATALOG, defaultModel, findModel, listModels, modelAliases } from "./catalog.js";

const pairs = [...new Set(MODEL_CATALOG.map((m) => `${m.provider}/${m.kind}`))];

describe("model catalog", () => {
  it("has exactly one default per provider and kind", () => {
    for (const pair of pairs) {
      const [provider, kind] = pair.split("/");
      const defaults = MODEL_CATALOG.filter((m) => m.provider === provider && m.kind === kind && m.default);
      expect(defaults, pair).toHaveLength(1);
    }
  });

  it("never reuses an ID or alias within a provider and kind", () => {
    for (const pair of pairs) {
      const [provider, kind] = pair.split("/");
      const models = MODEL_CATALOG.filter((m) => m.provider === provider && m.kind === kind);
      const keys = models.flatMap((m) => [m.id, ...(m.aliases ?? [])]);
      expect(new Set(keys).size, pair).toBe(keys.length);
    }
  });

  it("keeps aliases lowercase so lookups can be case-insensitive", () => {
    for (const m of MODEL_CATALOG) {
      for (const alias of m.aliases ?? []) expect(alias, m.id).toBe(alias.toLowerCase());
    }
  });

  it("dates every deprecation", () => {
    for (const m of MODEL_CATALOG.filter((m) => m.status === "deprecated")) {
      expect(m.shutdown, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("resolves aliases, IDs, and defaults", () => {
    expect(findModel("seedance", "video", "2.5")?.id).toBe("seedance-2.5");
    expect(findModel("seedance", "video", "SEEDANCE-2.5")).toBeUndefined();
    expect(findModel("kling", "video", "kling-v3")?.id).toBe("kling-v3");
    expect(findModel("gemini", "image", "PRO")?.id).toBe("gemini-3-pro-image");
    expect(findModel("gemini", "image", undefined)?.id).toBe(defaultModel("gemini", "image").id);
    expect(findModel("kling", "video", "v9")).toBeUndefined();
    expect(modelAliases("veo", "video")).toEqual(["3.1", "3.1-fast"]);
    expect(listModels({ kind: "transcription" }).map((m) => m.id)).toEqual(["whisper-1"]);
  });

  it("throws when a provider and kind has no default", () => {
    expect(() => defaultModel("kokoro", "video")).toThrow(/no default video model for kokoro/);
  });
});
