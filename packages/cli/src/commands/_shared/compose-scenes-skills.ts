/**
 * @module _shared/compose-scenes-skills
 *
 * Single-beat Claude composer for the `compose-scenes-with-skills` v0.59
 * pipeline action. Per beat:
 *
 *   1. Compute a sha256 cache key over (skill-bundle hash, DESIGN.md,
 *      storyboard global direction, beat body, model id, retry-feedback).
 *   2. Read `~/.vibeframe/cache/compose-scenes/<key>.html` if present.
 *   3. Otherwise call Claude Sonnet 4.6 with the skill bundle as system
 *      prompt and the beat as user prompt; parse HTML out of a fenced
 *      code block; persist to cache.
 *
 * Pre-flight (PR #111) validated this exact prompt shape at 5/5 lint pass,
 * $0.058/scene, 8.4 s. The diff between runs is high (~33 % line-Jaccard)
 * which is precisely *why* we cache on input rather than output: same
 * input prompts always return the same cached HTML.
 *
 * C3 ships:
 *   - `composeBeatHtml(ctx)` — single shot, no retry
 *   - Cache I/O (read + write) by sha256 input key
 *   - Anthropic SDK call with model selection + cost reporting
 *   - Pure prompt construction helpers (testable without API key)
 *
 * Lint feedback retry loop comes in C4 (extends this module).
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Beat } from "./storyboard-parse.js";

/** Effort level → model + token caps. */
export type ComposeEffort = "low" | "medium" | "high";

interface ModelSettings {
  model: string;
  maxTokens: number;
  /** USD per million input / output tokens. Used to surface cost in result. */
  costPerMTokIn: number;
  costPerMTokOut: number;
}

const MODEL_SETTINGS: Record<ComposeEffort, ModelSettings> = {
  // Sonnet 4.6 — pre-flight validated default. $3/$15 per MTok.
  low:    { model: "claude-sonnet-4-6", maxTokens: 4_000, costPerMTokIn: 3,  costPerMTokOut: 15 },
  medium: { model: "claude-sonnet-4-6", maxTokens: 6_000, costPerMTokIn: 3,  costPerMTokOut: 15 },
  high:   { model: "claude-sonnet-4-6", maxTokens: 8_000, costPerMTokIn: 3,  costPerMTokOut: 15 },
};

export interface ComposeBeatContext {
  /** The beat to compose, from `parseStoryboard()`. */
  beat: Beat;
  /** Project's `DESIGN.md` content (visual identity hard-gate). */
  designMd: string;
  /** Storyboard's global direction (everything before the first `## Beat`). */
  storyboardGlobal: string;
  /** Hyperframes skill bundle content + hash, from `loadHyperframesSkillBundle()`. */
  skillBundle: { content: string; hash: string };
  /** Effort level — picks model + token caps. Defaults to "medium". */
  effort?: ComposeEffort;
  /**
   * Optional lint feedback to append to the user prompt, used by C4's retry
   * loop. When non-empty, the cache key includes it so retries don't return
   * the cached first-shot HTML.
   */
  retryFeedback?: string;
  /** Anthropic API key. */
  apiKey: string;
  /**
   * Cache directory override. Defaults to `~/.vibeframe/cache/compose-scenes/`.
   * Tests pass a temp dir.
   */
  cacheDir?: string;
}

export interface ComposeBeatResult {
  /** Generated HTML (from cache or fresh API call). */
  html: string;
  /** True when the HTML came from cache (no API call made). */
  cached: boolean;
  /** Cache key used (sha256 hex). */
  cacheKey: string;
  /** Anthropic input tokens (only set on fresh API call). */
  inputTokens?: number;
  /** Anthropic output tokens (only set on fresh API call). */
  outputTokens?: number;
  /** USD cost of this beat (only set on fresh API call). */
  costUsd?: number;
  /** Wall-clock latency in ms (only set on fresh API call). */
  latencyMs?: number;
  /** Resolved model id (e.g. "claude-sonnet-4-6"). */
  model: string;
}

// ── Prompt construction (pure) ──────────────────────────────────────────

/** Build the system prompt — skill bundle + DESIGN.md hard-gate. */
export function buildSystemPrompt(ctx: Pick<ComposeBeatContext, "skillBundle" | "designMd">): string {
  return `You are a Hyperframes composition author. The skill content below
defines the framework rules, motion principles, and quality standards.
Read it thoroughly before writing any HTML.

${ctx.skillBundle.content}

=== DESIGN.md (project-specific visual identity — HARD-GATE, every decision must trace back) ===

${ctx.designMd}`;
}

/** Build the user prompt — instructions + storyboard global + beat body. */
export function buildUserPrompt(ctx: Pick<ComposeBeatContext, "beat" | "storyboardGlobal" | "retryFeedback">): string {
  const compositionId = `scene-${ctx.beat.id}`;

  const baseRequirements = `Build the Hyperframes sub-composition HTML for this beat. The composition
will be loaded into a root index.html via
\`data-composition-src="compositions/${compositionId}.html"\`.

Requirements (non-negotiable):
- Use the \`<template>\` wrapper (this is a sub-composition, not standalone)
- Composition id: \`${compositionId}\`
- One paused GSAP timeline registered on \`window.__timelines["${compositionId}"]\`
- All timed elements have \`class="clip"\` and \`data-start\`, \`data-duration\`, \`data-track-index\`
- No \`Math.random()\`, \`Date.now()\`, \`repeat: -1\`, or \`<br>\` in content
- Layout-before-animation: position elements at hero-frame state in CSS, animate FROM
- No exit animations (transitions handle scene exits, except the final beat)
- Strictly follow DESIGN.md palette, typography, motion signature

=== Storyboard — global direction ===

${ctx.storyboardGlobal || "(no global direction)"}

=== Beat to build ===

## ${ctx.beat.heading}

${ctx.beat.body}

=== Output format ===

Return ONE complete HTML file in a single \`\`\`html\`\`\` fenced code block.
No prose, no explanations, no commentary outside the code block. Just the HTML.`;

  if (ctx.retryFeedback && ctx.retryFeedback.trim().length > 0) {
    return `${baseRequirements}

=== Previous attempt failed lint with the following findings — fix them ===

${ctx.retryFeedback.trim()}`;
  }

  return baseRequirements;
}

/** Compute the sha256 cache key for a (system, user, model) triple. */
export function computeCacheKey(parts: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}): string {
  return createHash("sha256")
    .update(parts.model)
    .update("␞") // RECORD SEPARATOR
    .update(parts.systemPrompt)
    .update("␞")
    .update(parts.userPrompt)
    .digest("hex");
}

/** Default cache root: `~/.vibeframe/cache/compose-scenes/`. */
export function defaultCacheDir(): string {
  return join(homedir(), ".vibeframe", "cache", "compose-scenes");
}

// ── HTML extraction ─────────────────────────────────────────────────────

/**
 * Pull the HTML out of Claude's response. Prefers a fenced ```html block;
 * accepts a bare HTML response as fallback (some completions skip the fence
 * when the entire reply is the document).
 */
export function extractHtml(responseText: string): string {
  const fenced = responseText.match(/```html\s*\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1].trim();
  const trimmed = responseText.trim();
  if (trimmed.startsWith("<")) return trimmed;
  throw new ComposeBeatError(
    "no-html-in-response",
    `Could not extract HTML from response. First 200 chars: ${trimmed.slice(0, 200)}`,
  );
}

// ── Errors ──────────────────────────────────────────────────────────────

export class ComposeBeatError extends Error {
  constructor(public readonly code: string, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ComposeBeatError";
  }
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * Compose one beat into HTML. Cache-first; on miss, call Claude.
 *
 * @param overrides allows tests to inject a mock Anthropic client. In prod
 *   we always construct from `ctx.apiKey`.
 */
export async function composeBeatHtml(
  ctx: ComposeBeatContext,
  overrides?: { client?: Anthropic; now?: () => number },
): Promise<ComposeBeatResult> {
  const effort: ComposeEffort = ctx.effort ?? "medium";
  const settings = MODEL_SETTINGS[effort];

  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = buildUserPrompt(ctx);
  const cacheKey = computeCacheKey({
    systemPrompt,
    userPrompt,
    model: settings.model,
  });

  const cacheDir = ctx.cacheDir ?? defaultCacheDir();
  const cachePath = join(cacheDir, `${cacheKey}.html`);

  // Cache-first.
  if (existsSync(cachePath)) {
    const html = await readFile(cachePath, "utf-8");
    return { html, cached: true, cacheKey, model: settings.model };
  }

  // Cache miss → call Claude.
  if (!ctx.apiKey) {
    throw new ComposeBeatError(
      "missing-api-key",
      "ANTHROPIC_API_KEY required for compose-scenes-with-skills (set it in env or .env).",
    );
  }
  const client = overrides?.client ?? new Anthropic({ apiKey: ctx.apiKey });
  const now = overrides?.now ?? (() => Date.now());

  const t0 = now();
  let response: Awaited<ReturnType<Anthropic["messages"]["create"]>>;
  try {
    response = await client.messages.create({
      model: settings.model,
      max_tokens: settings.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (err) {
    throw new ComposeBeatError(
      "api-call-failed",
      `Anthropic API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
  const latencyMs = now() - t0;

  // Anthropic SDK v0.39 returns either a Message (non-streaming) or a stream.
  // Our `stream` is unset so we get a Message. Narrow + extract text.
  if (!("content" in response) || !Array.isArray(response.content)) {
    throw new ComposeBeatError("unexpected-response-shape", "Anthropic response missing `content` array.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ComposeBeatError("no-text-block", "Anthropic response had no text block.");
  }

  // textBlock.type === "text" narrows to TextBlock which has `text: string`.
  const html = extractHtml(textBlock.text);

  // Persist to cache (best-effort — failures don't surface as composer
  // errors; the html is still returned).
  try {
    mkdirSync(cacheDir, { recursive: true });
    await writeFile(cachePath, html, "utf-8");
  } catch {
    // ignore — caller still gets the HTML
  }

  // SDK shape: response.usage.{input_tokens, output_tokens}. Both numbers.
  const inputTokens = (response as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0;
  const outputTokens = (response as { usage?: { output_tokens?: number } }).usage?.output_tokens ?? 0;
  const costUsd = (inputTokens / 1_000_000) * settings.costPerMTokIn
    + (outputTokens / 1_000_000) * settings.costPerMTokOut;

  return {
    html,
    cached: false,
    cacheKey,
    inputTokens,
    outputTokens,
    costUsd: Number(costUsd.toFixed(4)),
    latencyMs,
    model: settings.model,
  };
}
