import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSystemPrompt,
  buildUserPrompt,
  composeBeatHtml,
  computeCacheKey,
  defaultCacheDir,
  extractHtml,
  ComposeBeatError,
} from "./compose-scenes-skills.js";

import type { Beat } from "./storyboard-parse.js";

// Shared fixtures
const beat: Beat = {
  id: "1",
  heading: "Beat 1 — Hook (0–3s)",
  body: "### Concept\n\nCold open.\n",
};
const designMd = "# Design\n\n## Palette\n- `#000000`\n- `#ffffff`\n";
const skillBundle = { content: "=== hyperframes/SKILL.md ===\n\nFRAMEWORK RULES.", hash: "abc123" };
const baseCtx = {
  beat,
  designMd,
  storyboardGlobal: "**Format:** 1920×1080",
  skillBundle,
  apiKey: "sk-test",
};

// ── Pure helpers ────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("includes skill bundle content + DESIGN.md hard-gate", () => {
    const sys = buildSystemPrompt({ skillBundle, designMd });
    expect(sys).toContain("FRAMEWORK RULES.");
    expect(sys).toContain("DESIGN.md");
    expect(sys).toContain("Palette");
    expect(sys).toContain("HARD-GATE");
  });
});

describe("buildUserPrompt", () => {
  it("includes the beat heading + body + storyboard global", () => {
    const u = buildUserPrompt({ beat, storyboardGlobal: "**Format:** 1920×1080" });
    expect(u).toContain("Beat 1 — Hook");
    expect(u).toContain("Cold open.");
    expect(u).toContain("**Format:** 1920×1080");
  });

  it("uses scene-<id>.html as the composition path", () => {
    const u = buildUserPrompt({ beat, storyboardGlobal: "" });
    expect(u).toContain('compositions/scene-1.html');
    expect(u).toContain('Composition id: `scene-1`');
  });

  it("emits placeholder when global direction is empty", () => {
    const u = buildUserPrompt({ beat, storyboardGlobal: "" });
    expect(u).toContain("(no global direction)");
  });

  it("appends retry feedback section when supplied", () => {
    const u = buildUserPrompt({
      beat,
      storyboardGlobal: "",
      retryFeedback: "ERROR: missing class=\"clip\" on the headline div",
    });
    expect(u).toContain("Previous attempt failed lint");
    expect(u).toContain("missing class=\"clip\"");
  });

  it("omits retry-feedback section when retryFeedback is empty / whitespace", () => {
    const a = buildUserPrompt({ beat, storyboardGlobal: "" });
    const b = buildUserPrompt({ beat, storyboardGlobal: "", retryFeedback: "" });
    const c = buildUserPrompt({ beat, storyboardGlobal: "", retryFeedback: "  \n  " });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("computeCacheKey", () => {
  it("returns a stable sha256 hex for the same triple", () => {
    const a = computeCacheKey({ systemPrompt: "S", userPrompt: "U", model: "M" });
    const b = computeCacheKey({ systemPrompt: "S", userPrompt: "U", model: "M" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when system / user / model differs", () => {
    const base = computeCacheKey({ systemPrompt: "S", userPrompt: "U", model: "M" });
    expect(computeCacheKey({ systemPrompt: "S2", userPrompt: "U", model: "M" })).not.toBe(base);
    expect(computeCacheKey({ systemPrompt: "S", userPrompt: "U2", model: "M" })).not.toBe(base);
    expect(computeCacheKey({ systemPrompt: "S", userPrompt: "U", model: "M2" })).not.toBe(base);
  });

  it("avoids prefix collisions via record separator", () => {
    // Without separators, "AB" + "C" and "A" + "BC" would hash identically.
    // With ␞ (RECORD SEPARATOR) between fields, they don't.
    const a = computeCacheKey({ systemPrompt: "AB", userPrompt: "C", model: "M" });
    const b = computeCacheKey({ systemPrompt: "A", userPrompt: "BC", model: "M" });
    expect(a).not.toBe(b);
  });
});

describe("defaultCacheDir", () => {
  it("returns ~/.vibeframe/cache/compose-scenes/", () => {
    const d = defaultCacheDir();
    expect(d).toMatch(/\.vibeframe\/cache\/compose-scenes$/);
  });
});

describe("extractHtml", () => {
  it("extracts from a fenced ```html block", () => {
    const r = extractHtml("Here you go:\n```html\n<template>X</template>\n```");
    expect(r).toBe("<template>X</template>");
  });

  it("falls back to bare HTML when there's no fence", () => {
    const r = extractHtml("<template>Y</template>");
    expect(r).toBe("<template>Y</template>");
  });

  it("throws on prose-only response with no HTML markers", () => {
    expect(() => extractHtml("I cannot generate that.")).toThrowError(ComposeBeatError);
    try { extractHtml("x"); } catch (e) {
      expect((e as ComposeBeatError).code).toBe("no-html-in-response");
    }
  });
});

// ── composeBeatHtml ─────────────────────────────────────────────────────

describe("composeBeatHtml", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "compose-scenes-test-"));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("calls the API on cache miss and persists the HTML", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>fresh</template>\n```" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const client = { messages: { create } } as never;

    const r = await composeBeatHtml({ ...baseCtx, cacheDir }, { client });

    expect(r.cached).toBe(false);
    expect(r.html).toBe("<template>fresh</template>");
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    // Sonnet 4.6: 100/M * $3 + 50/M * $15 = $0.000300 + $0.000750 = $0.00105
    expect(r.costUsd).toBeCloseTo(0.0011, 4);
    expect(create).toHaveBeenCalledOnce();

    // Cache file written
    const written = readFileSync(join(cacheDir, `${r.cacheKey}.html`), "utf-8");
    expect(written).toBe("<template>fresh</template>");
  });

  it("returns cached HTML on hit without calling the API", async () => {
    // First call seeds the cache
    const create1 = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>seeded</template>\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const r1 = await composeBeatHtml({ ...baseCtx, cacheDir }, { client: { messages: { create: create1 } } as never });

    // Second call with same input → cache hit
    const create2 = vi.fn();
    const r2 = await composeBeatHtml({ ...baseCtx, cacheDir }, { client: { messages: { create: create2 } } as never });

    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(r2.html).toBe(r1.html);
    expect(r2.cacheKey).toBe(r1.cacheKey);
    expect(create2).not.toHaveBeenCalled();
    // Cache-hit results don't surface fresh-call metrics
    expect(r2.inputTokens).toBeUndefined();
    expect(r2.costUsd).toBeUndefined();
    expect(r2.latencyMs).toBeUndefined();
  });

  it("retry feedback changes the cache key (different prompt → fresh call)", async () => {
    const create1 = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>v1</template>\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await composeBeatHtml({ ...baseCtx, cacheDir }, { client: { messages: { create: create1 } } as never });

    const create2 = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>v2-after-retry</template>\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const r2 = await composeBeatHtml(
      { ...baseCtx, cacheDir, retryFeedback: "ERROR: missing class=\"clip\"" },
      { client: { messages: { create: create2 } } as never },
    );

    expect(r2.cached).toBe(false);
    expect(create2).toHaveBeenCalledOnce();
    expect(r2.html).toBe("<template>v2-after-retry</template>");
  });

  it("throws ComposeBeatError when API call fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const client = { messages: { create } } as never;

    await expect(
      composeBeatHtml({ ...baseCtx, cacheDir }, { client }),
    ).rejects.toThrowError(/Anthropic API call failed: network unreachable/);
  });

  it("throws missing-api-key error when apiKey is empty AND cache miss", async () => {
    await expect(
      composeBeatHtml({ ...baseCtx, apiKey: "", cacheDir }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY required/);
  });

  it("uses the cached value even when apiKey is empty (cache hit doesn't need a key)", async () => {
    // Seed cache
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>seeded</template>\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await composeBeatHtml({ ...baseCtx, cacheDir }, { client: { messages: { create } } as never });

    // Now drop apiKey — cache hit should still work
    const r = await composeBeatHtml({ ...baseCtx, apiKey: "", cacheDir });
    expect(r.cached).toBe(true);
    expect(r.html).toBe("<template>seeded</template>");
  });

  it("effort=high uses higher max_tokens", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "```html\n<template>x</template>\n```" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await composeBeatHtml({ ...baseCtx, cacheDir, effort: "high" }, { client: { messages: { create } } as never });

    const args = create.mock.calls[0][0];
    expect(args.max_tokens).toBe(8_000);
  });
});
