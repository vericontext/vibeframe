import { describe, expect, it } from "vitest";

import {
  MODEL_CATALOG,
  ModelRetiredError,
  assertModelServed,
  defaultModel,
  findModel,
  listModels,
  modelAliases,
  modelLifecycle,
  type ModelSpec,
} from "./catalog.js";

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

describe("modelLifecycle", () => {
  const dated: ModelSpec = {
    id: "old-1",
    provider: "test",
    kind: "video",
    label: "Old 1",
    status: "deprecated",
    shutdown: "2026-10-22",
    replacement: "`-p new`",
  };

  it("serves models without a shutdown date", () => {
    expect(modelLifecycle(defaultModel("seedance", "video"))).toEqual({ state: "served" });
  });

  it("counts down to the shutdown date and names the replacement", () => {
    const lifecycle = modelLifecycle(dated, new Date("2026-10-04T10:00:00Z"));
    expect(lifecycle).toMatchObject({ state: "retiring", daysLeft: 18 });
    expect(lifecycle.state === "retiring" && lifecycle.message).toBe(
      "Old 1 (old-1) shuts down on 2026-10-22 (18 days left). Use `-p new` instead."
    );
    expect(modelLifecycle(dated, new Date("2026-10-21T23:59:59Z"))).toMatchObject({ daysLeft: 1 });
  });

  it("retires a model from 00:00 UTC on the shutdown date", () => {
    expect(modelLifecycle(dated, new Date("2026-10-22T00:00:00Z"))).toMatchObject({ state: "retired" });
    expect(() => assertModelServed(dated, new Date("2026-10-22T00:00:00Z"))).toThrow(ModelRetiredError);
    expect(() => assertModelServed(dated, new Date("2026-10-21T00:00:00Z"))).not.toThrow();
  });

  it("gives every dated catalog model a parseable ISO shutdown date", () => {
    for (const m of MODEL_CATALOG.filter((m) => m.shutdown)) {
      expect(m.shutdown, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${m.shutdown}T00:00:00Z`)), m.id).toBe(false);
    }
  });
});
