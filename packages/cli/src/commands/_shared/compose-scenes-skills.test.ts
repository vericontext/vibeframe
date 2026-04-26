import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSystemPrompt,
  buildUserPrompt,
  composeBeatHtml,
  composeBeatWithRetry,
  computeCacheKey,
  defaultCacheDir,
  executeComposeScenesWithSkills,
  extractHtml,
  formatLintFeedback,
  lintBeatHtml,
  ComposeBeatError,
} from "./compose-scenes-skills.js";

import type { Beat } from "./storyboard-parse.js";
import type { LintFinding } from "./scene-lint.js";

import { mkdirSync, writeFileSync, readFileSync as fsReadFileSync } from "node:fs";

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

// ── Lint feedback helpers (C4) ──────────────────────────────────────────

describe("formatLintFeedback", () => {
  it("returns empty string when no errors", () => {
    expect(formatLintFeedback([])).toBe("");
    const warningsOnly: LintFinding[] = [
      { severity: "warning", code: "x", message: "y" },
    ];
    expect(formatLintFeedback(warningsOnly)).toBe("");
  });

  it("formats each error as ERROR [code] message", () => {
    const findings: LintFinding[] = [
      { severity: "error", code: "missing_clip_class", message: 'div lacks class="clip"' },
      { severity: "error", code: "no_timeline", message: "no GSAP timeline registered" },
    ];
    const out = formatLintFeedback(findings);
    expect(out).toContain('ERROR [missing_clip_class] div lacks class="clip"');
    expect(out).toContain("ERROR [no_timeline] no GSAP timeline registered");
  });

  it("includes fixHint on a separate line when present", () => {
    const findings: LintFinding[] = [
      {
        severity: "error",
        code: "missing_clip_class",
        message: 'div lacks class="clip"',
        fixHint: 'add class="clip" to the timed div',
      },
    ];
    const out = formatLintFeedback(findings);
    expect(out).toContain("Fix hint: add class=\"clip\"");
  });

  it("filters out non-error findings (warnings/info)", () => {
    const findings: LintFinding[] = [
      { severity: "error", code: "real-error", message: "fix me" },
      { severity: "warning", code: "soft-warn", message: "minor" },
      { severity: "info", code: "fyi", message: "irrelevant" },
    ];
    const out = formatLintFeedback(findings);
    expect(out).toContain("real-error");
    expect(out).not.toContain("soft-warn");
    expect(out).not.toContain("fyi");
  });
});

describe("lintBeatHtml", () => {
  it("returns errors for HTML missing required structure", () => {
    // Missing data-composition-id, data-width, data-height entirely
    const html = `<template id="bad"><div>hi</div></template>`;
    const r = lintBeatHtml(html, "test");
    expect(r.errorCount).toBeGreaterThan(0);
  });

  it("structure has expected counts shape", () => {
    const html = `<template id="bad"><div>nothing</div></template>`;
    const r = lintBeatHtml(html, "test");
    expect(r).toHaveProperty("errorCount");
    expect(r).toHaveProperty("warningCount");
    expect(r).toHaveProperty("findings");
    expect(Array.isArray(r.findings)).toBe(true);
  });
});

// ── composeBeatWithRetry (C4) ───────────────────────────────────────────

const validHtml = `<template id="scene-1-template">
  <div data-composition-id="scene-1" data-width="1920" data-height="1080" data-start="0" data-duration="3">
    <div class="clip" data-start="0" data-duration="3" data-track-index="0">
      <p>Hello</p>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["scene-1"] = { paused: true };
    </script>
  </div>
</template>`;

const invalidHtml = `<template id="bad"><div>nothing</div></template>`;

function fenced(html: string): string {
  return "```html\n" + html + "\n```";
}

describe("composeBeatWithRetry", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "compose-retry-test-"));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns lintAttempts=1 when first shot lints clean", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenced(validHtml) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const r = await composeBeatWithRetry(
      { ...baseCtx, cacheDir },
      { client: { messages: { create } } as never },
    );

    expect(r.lintAttempts).toBe(1);
    expect(r.lint.errorCount).toBe(0);
    expect(create).toHaveBeenCalledOnce();
  });

  it("retries with feedback when first shot fails lint, returns lintAttempts=2 on success", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        content: [{ type: "text", text: fenced(invalidHtml) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: fenced(validHtml) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const r = await composeBeatWithRetry(
      { ...baseCtx, cacheDir },
      { client: { messages: { create } } as never },
    );

    expect(r.lintAttempts).toBe(2);
    expect(r.lint.errorCount).toBe(0);
    expect(create).toHaveBeenCalledTimes(2);

    // Retry call's user prompt must include the lint findings as feedback
    const retryArgs = create.mock.calls[1][0];
    const retryUserMsg = retryArgs.messages[0].content;
    expect(retryUserMsg).toContain("Previous attempt failed lint");
  });

  it("throws lint-failed-after-retry when both attempts fail", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenced(invalidHtml) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(
      composeBeatWithRetry({ ...baseCtx, cacheDir }, { client: { messages: { create } } as never }),
    ).rejects.toMatchObject({
      name: "ComposeBeatError",
      code: "lint-failed-after-retry",
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

// ── executeComposeScenesWithSkills (C5 pipeline action) ─────────────────

const validSceneHtml = `<template id="scene-1-template">
  <div data-composition-id="scene-1" data-width="1920" data-height="1080" data-start="0" data-duration="3">
    <div class="clip" data-start="0" data-duration="3" data-track-index="0">
      <p>Hello</p>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["scene-1"] = { paused: true };
    </script>
  </div>
</template>`;

function fenceHtml(html: string): string {
  return "```html\n" + html + "\n```";
}

function seedProject(root: string, designMd: string, storyboardMd: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "DESIGN.md"), designMd, "utf-8");
  writeFileSync(join(root, "STORYBOARD.md"), storyboardMd, "utf-8");
}

describe("executeComposeScenesWithSkills", () => {
  let projectRoot: string;
  let cacheDir: string;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "compose-action-test-"));
    cacheDir = mkdtempSync(join(tmpdir(), "compose-action-cache-"));
    process.env.ANTHROPIC_API_KEY = "sk-test";
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("composes one composition file per beat and reports aggregate metadata", async () => {
    seedProject(
      projectRoot,
      "# Design\n\n## Palette\n- `#000000`\n",
      "**Format:** 1920x1080\n\n## Beat 1 — Hook\n\nbody1\n\n## Beat 2 — Outro\n\nbody2\n",
    );
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenceHtml(validSceneHtml) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const r = await executeComposeScenesWithSkills(
      { cacheDir },
      projectRoot,
      { client: { messages: { create } } as never },
    );

    expect(r.success).toBe(true);
    expect(r.outputPath).toBe(projectRoot);
    expect(r.data?.beats).toBe(2);
    expect(r.data?.written).toHaveLength(2);
    expect(r.data?.written[0].beatId).toBe("1");
    expect(r.data?.written[1].beatId).toBe("2");
    expect(r.data?.cacheHits).toBe(0);
    expect(r.data?.totalTokensIn).toBeGreaterThan(0);

    // Composition files exist
    const c1 = fsReadFileSync(join(projectRoot, "compositions/scene-1.html"), "utf-8");
    const c2 = fsReadFileSync(join(projectRoot, "compositions/scene-2.html"), "utf-8");
    expect(c1).toBe(validSceneHtml);
    expect(c2).toBe(validSceneHtml);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns failure when DESIGN.md is missing", async () => {
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "STORYBOARD.md"), "## Beat 1 — x\nbody\n");
    const r = await executeComposeScenesWithSkills({}, projectRoot);
    expect(r.success).toBe(false);
    expect(r.error).toContain("DESIGN.md not found");
  });

  it("returns failure when STORYBOARD.md is missing", async () => {
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "DESIGN.md"), "# d");
    const r = await executeComposeScenesWithSkills({}, projectRoot);
    expect(r.success).toBe(false);
    expect(r.error).toContain("STORYBOARD.md not found");
  });

  it("returns failure when STORYBOARD.md has no beats", async () => {
    seedProject(projectRoot, "# d", "Just prose, no headings.\n");
    const r = await executeComposeScenesWithSkills({}, projectRoot);
    expect(r.success).toBe(false);
    expect(r.error).toContain("no `## Beat …` headings");
  });

  it("emits onProgress events per beat: start → fresh|cached|failed", async () => {
    seedProject(
      projectRoot,
      "# d",
      "## Beat 1 — A\n\nbody\n\n## Beat 2 — B\n\nbody\n",
    );
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenceHtml(validSceneHtml) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const events: string[] = [];

    await executeComposeScenesWithSkills(
      {
        cacheDir,
        onProgress: (e) => events.push(`${e.type}:${e.beatId}:${e.beatIndex}`),
      },
      projectRoot,
      { client: { messages: { create } } as never },
    );

    // Both beats fired through start → fresh (no cache hits on first run).
    expect(events).toContain("beat-start:1:0");
    expect(events).toContain("beat-start:2:1");
    expect(events).toContain("beat-fresh:1:0");
    expect(events).toContain("beat-fresh:2:1");
    expect(events.filter((e) => e.startsWith("beat-failed"))).toHaveLength(0);
  });

  it("emits beat-cached on second run when content already cached", async () => {
    seedProject(projectRoot, "# d", "## Beat 1 — A\n\nbody\n");
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenceHtml(validSceneHtml) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    // First run — fresh.
    const events1: string[] = [];
    await executeComposeScenesWithSkills(
      { cacheDir, onProgress: (e) => events1.push(e.type) },
      projectRoot,
      { client: { messages: { create } } as never },
    );
    expect(events1).toContain("beat-fresh");

    // Second run — same project + same cacheDir → cache hit.
    const events2: string[] = [];
    await executeComposeScenesWithSkills(
      { cacheDir, onProgress: (e) => events2.push(e.type) },
      projectRoot,
      { client: { messages: { create } } as never },
    );
    expect(events2).toContain("beat-cached");
    expect(events2).not.toContain("beat-fresh");
  });

  it("aggregates multiple beat failures into one error message (doesn't fail-fast)", async () => {
    seedProject(
      projectRoot,
      "# d",
      "## Beat 1 — Bad\n\nbody\n\n## Beat 2 — AlsoBad\n\nbody\n",
    );
    // Every call returns invalid HTML → both beats fail twice → both throw.
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: fenceHtml("<template id=\"x\"><div>nope</div></template>") }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const r = await executeComposeScenesWithSkills(
      { cacheDir },
      projectRoot,
      { client: { messages: { create } } as never },
    );

    expect(r.success).toBe(false);
    // Both beat ids appear in the aggregated error (deriveBeatId → "1", "2")
    expect(r.error).toContain("- 1: ");
    expect(r.error).toContain("- 2: ");
    expect(r.error).toMatch(/failed at 2 beats/);
    // 4 calls total: 2 beats × 2 attempts (initial + retry)
    expect(create).toHaveBeenCalledTimes(4);
  });

  it("aborts on first beat failure and reports partial progress", async () => {
    seedProject(
      projectRoot,
      "# d",
      "## Beat 1 — Good\n\nbody\n\n## Beat 2 — Bad\n\nbody\n",
    );
    // First beat: good HTML. Second beat: invalid HTML → fails lint twice → throws.
    const create = vi.fn()
      .mockResolvedValueOnce({  // beat 1 — valid
        content: [{ type: "text", text: fenceHtml(validSceneHtml) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({  // beat 2 first attempt — invalid
        content: [{ type: "text", text: fenceHtml("<template id=\"x\"><div>nope</div></template>") }],
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce({  // beat 2 retry — also invalid
        content: [{ type: "text", text: fenceHtml("<template id=\"x\"><div>still nope</div></template>") }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const r = await executeComposeScenesWithSkills(
      { cacheDir },
      projectRoot,
      { client: { messages: { create } } as never },
    );

    expect(r.success).toBe(false);
    expect(r.error).toContain('compose-scenes-with-skills failed at beat "2"');
    // Beat 1 was already written; metadata reflects that.
    expect(r.data?.written).toHaveLength(1);
    expect(r.data?.written[0].beatId).toBe("1");
  });
});
