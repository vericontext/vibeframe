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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  runHyperframeLint,
  type PreparedHyperframeLintInput,
} from "@hyperframes/producer";

import { loadHyperframesSkillBundle } from "./hf-skill-bundle/bundle.js";
import { filterSubCompFalsePositives, type LintFinding } from "./scene-lint.js";
import { parseStoryboard, type Beat } from "./storyboard-parse.js";

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

/**
 * Render the beat's per-beat YAML cues (narration / backdrop / duration /
 * voice — see C2 storyboard frontmatter spec) as inline context inside
 * the user prompt. Returns an empty string when no cues are present.
 *
 * Why this matters: parseStoryboard strips the \`\`\`yaml cue block from
 * \`Beat.body\` so the LLM doesn't see machine-only metadata twice. But
 * if the body becomes empty (a common case — many users put the entire
 * beat intent in cues), the cache key for "## Beat hook — Hook" + empty
 * body is identical for ANY beat with that heading. Pre-v0.63 this
 * caused composed scene HTML from one project's "hook" beat to silently
 * land on another's. Surface the cue content back into the prompt so
 * (1) the LLM can actually see what to render, and (2) the cache key
 * differs by cue content.
 */
function formatBeatCues(cues: Beat["cues"]): string {
  if (!cues) return "";
  const lines: string[] = ["", "**Beat cues** (declarative, machine-readable):"];
  if (cues.narration !== undefined) {
    lines.push(`- narration: ${JSON.stringify(cues.narration)}`);
  }
  if (cues.backdrop !== undefined) {
    lines.push(`- backdrop: ${JSON.stringify(cues.backdrop)}`);
  }
  if (cues.duration !== undefined) {
    lines.push(`- duration: ${cues.duration}s`);
  }
  if (cues.voice !== undefined) {
    lines.push(`- voice: ${JSON.stringify(cues.voice)}`);
  }
  // Surface unknown keys verbatim so users can extend cue semantics
  // (e.g. \`bgm\`, \`accent\`) without us coupling to every name.
  for (const [k, v] of Object.entries(cues)) {
    if (["narration", "backdrop", "duration", "voice"].includes(k)) continue;
    lines.push(`- ${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n") + "\n";
}

/** Build the user prompt — instructions + storyboard global + beat body. */
export function buildUserPrompt(ctx: Pick<ComposeBeatContext, "beat" | "storyboardGlobal" | "retryFeedback">): string {
  const compositionId = `scene-${ctx.beat.id}`;

  const baseRequirements = `Build the Hyperframes sub-composition HTML for this beat. The composition
will be loaded into a root index.html via
\`data-composition-src="compositions/${compositionId}.html"\`.

Requirements (non-negotiable):

- **Output must be a BARE \`<template>...</template>\` fragment.** Do NOT
  wrap it in \`<!DOCTYPE html>\`, \`<html>\`, \`<head>\`, or \`<body>\` —
  Hyperframes' producer reads the file as a fragment and full-document
  wrappers break sub-composition parsing.
- Wrapper template id: \`${compositionId}-template\`. Inner div has
  \`data-composition-id="${compositionId}"\` AND \`data-start="0"\` AND
  \`data-duration="<beat duration in seconds>"\` AND \`data-width="1920"\`
  AND \`data-height="1080"\`.
- One paused GSAP timeline registered on \`window.__timelines["${compositionId}"]\`.
- **Timeline total duration MUST equal the beat \`data-duration\`.** Hyperframes
  renders in screenshot-capture mode with virtual time; if the timeline ends
  before the beat (e.g., entry tweens covering 0–1.4s of a 3s beat), the
  producer's seek lands past the timeline's natural end and visibility state
  goes stale — the hold phase renders BLACK. Anchor the timeline to the full
  beat duration via either:
    1. A subtle idle motion spanning 0→duration on a parent element, e.g.
       \`tl.fromTo(".scene-content", { scale: 1.0 }, { scale: 1.015, duration: <beat>, ease: "none" }, 0);\`
       (Ken-Burns, breathing opacity, gradient drift — should be barely
       perceptible so it doesn't compete with entry/exit beats).
    2. OR an explicit \`tl.set(target, { ...natural state... }, <beat - 0.001>)\`
       anchor at the end.
  This is the #2 source of "text disappears mid-beat" bugs after \`.clip\` sizing.
- Timed children inside the composition have \`class="clip"\` plus
  \`data-start\`, \`data-duration\`, \`data-track-index\`.
- **\`.clip\` elements get visibility control from the framework but NO
  sizing.** Always give \`.clip\` explicit fill via CSS:
  \`{ position: absolute; inset: 0; }\` (or equivalent
  \`width: 100%; height: 100%; top: 0; left: 0;\`). Without this, the
  \`.clip\` collapses to its content size and any flex-centering inside
  it breaks. THIS IS THE #1 SOURCE OF "TEXT NOT RENDERING / WRONG
  POSITION" BUGS — do not skip the rule.
- Composition root must declare its absolute size in CSS:
  \`[data-composition-id="${compositionId}"] { position: relative; width: 1920px; height: 1080px; }\`.
- No \`Math.random()\`, \`Date.now()\`, \`repeat: -1\`, or \`<br>\` in content.
- Layout-before-animation: position elements at hero-frame state in CSS,
  animate FROM that position.
- No exit animations (transitions handle scene exits, except the final beat).
- Strictly follow DESIGN.md palette, typography, motion signature.

Reference shape (verbatim — match this skeleton exactly, no DOCTYPE / html / body):

\`\`\`
<template id="${compositionId}-template">
  <div data-composition-id="${compositionId}" data-start="0" data-duration="<sec>" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="${compositionId}"] {
        position: relative;
        width: 1920px;
        height: 1080px;
        background: /* from DESIGN.md */;
        overflow: hidden;
      }
      /* Critical: .clip elements get framework visibility control but NOT
         sizing — give them explicit fill or content centering breaks. */
      [data-composition-id="${compositionId}"] .clip {
        position: absolute;
        inset: 0;
      }
      /* …per-element styles… */
    </style>

    <div class="clip" data-start="0" data-duration="<sec>" data-track-index="0">
      <!-- content; can use display:flex etc. since .clip now fills the scene -->
    </div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // Idle motion spanning full beat duration — required to keep timeline
      // length aligned with data-duration (otherwise hold phase goes black).
      tl.fromTo(".scene-content", { scale: 1.0 }, { scale: 1.015, duration: <sec>, ease: "none" }, 0);
      // entry tweens
      window.__timelines["${compositionId}"] = tl;
    </script>
  </div>
</template>
\`\`\`

=== Storyboard — global direction ===

${ctx.storyboardGlobal || "(no global direction)"}

=== Beat to build ===

## ${ctx.beat.heading}
${formatBeatCues(ctx.beat.cues)}
${ctx.beat.body}

=== Output format ===

Return ONE bare \`<template>\` fragment in a single \`\`\`html\`\`\` fenced code
block. No \`<!DOCTYPE>\`, no \`<html>\`, no prose, no explanations, no
commentary outside the code block. Just the template.`;

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

// ── Lint retry loop (C4) ────────────────────────────────────────────────

export interface BeatLintResult {
  errorCount: number;
  warningCount: number;
  findings: LintFinding[];
}

/**
 * Lint a single beat's HTML in-memory using `@hyperframes/producer`'s
 * `runHyperframeLint` directly — no temp project shell, no subprocess.
 *
 * Sub-composition false-positives are filtered (matches what the
 * `vibe scene lint` command does). The result is the same set of
 * findings the user would see if they ran `vibe scene lint` after
 * the beat HTML landed in a project.
 */
export function lintBeatHtml(html: string, beatId: string): BeatLintResult {
  const prepared: PreparedHyperframeLintInput = {
    html,
    entryFile: `compositions/scene-${beatId}.html`,
    source: "projectDir",
  };
  const raw = runHyperframeLint(prepared);
  const findings = filterSubCompFalsePositives(raw.findings as LintFinding[], true);
  return {
    errorCount: findings.filter((f) => f.severity === "error").length,
    warningCount: findings.filter((f) => f.severity === "warning").length,
    findings,
  };
}

/**
 * Format lint findings into a feedback block for the retry prompt.
 * Errors only — warnings don't block, so we don't burn the LLM's
 * attention budget on them.
 */
export function formatLintFeedback(findings: LintFinding[]): string {
  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length === 0) return "";
  return errors
    .map((f) => {
      const fix = f.fixHint ? `\n  Fix hint: ${f.fixHint}` : "";
      return `ERROR [${f.code}] ${f.message}${fix}`;
    })
    .join("\n");
}

export interface ComposeBeatWithRetryResult extends ComposeBeatResult {
  /** 1 if first-shot HTML linted clean; 2 if retry succeeded. */
  lintAttempts: 1 | 2;
  /** Lint result from the *final* (winning) attempt. */
  lint: BeatLintResult;
}

/**
 * `composeBeatHtml` + lint feedback retry loop, capped at 1 retry.
 *
 * Pre-flight (PR #111) showed 5/5 first-pass success at $0.058/scene; deeper
 * retry loops just burn budget. If the second attempt also fails lint,
 * throws `ComposeBeatError("lint-failed-after-retry", ...)` with the final
 * findings — caller (C5 pipeline action) decides whether to fall back to
 * the 5-preset emit path or surface the failure to the user.
 *
 * Cache contract preserved: retries use a different `retryFeedback`, which
 * is folded into the cache key, so retries don't accidentally serve the
 * cached first-shot HTML.
 */
export async function composeBeatWithRetry(
  ctx: ComposeBeatContext,
  overrides?: { client?: Anthropic; now?: () => number },
): Promise<ComposeBeatWithRetryResult> {
  // Attempt 1 — no retry feedback (cache-friendly first shot).
  const first = await composeBeatHtml(ctx, overrides);
  const lint1 = lintBeatHtml(first.html, ctx.beat.id);
  if (lint1.errorCount === 0) {
    return { ...first, lintAttempts: 1, lint: lint1 };
  }

  // Attempt 2 — feed lint findings back into the prompt.
  const feedback = formatLintFeedback(lint1.findings);
  const second = await composeBeatHtml({ ...ctx, retryFeedback: feedback }, overrides);
  const lint2 = lintBeatHtml(second.html, ctx.beat.id);
  if (lint2.errorCount === 0) {
    return { ...second, lintAttempts: 2, lint: lint2 };
  }

  // Both failed → fatal.
  throw new ComposeBeatError(
    "lint-failed-after-retry",
    `Beat "${ctx.beat.id}" failed lint after retry. Final findings:\n${formatLintFeedback(lint2.findings)}`,
  );
}

// ── Pipeline action executor (C5) ───────────────────────────────────────

/**
 * YAML pipeline action: read DESIGN.md + STORYBOARD.md, compose each beat
 * via Claude, write `compositions/scene-<id>.html` per beat. Sequential
 * fanout; C6 swaps in `Promise.all` parallelism.
 *
 * Wired into `pipeline/executor.ts` as the `compose-scenes-with-skills`
 * action. YAML shape:
 *
 *     - id: compose
 *       action: compose-scenes-with-skills
 *       design: DESIGN.md          # required (relative to project)
 *       storyboard: STORYBOARD.md  # required
 *       project: .                 # optional, default outputDir
 *       effort: medium             # optional, low|medium|high
 *
 * Returns the project root as `output` and per-beat metadata in `data`.
 */
/** Per-beat lifecycle event emitted to the optional `onProgress` callback. */
export type ComposeProgressEvent =
  | { type: "beat-start"; beatId: string; beatIndex: number; totalBeats: number }
  | { type: "beat-cached"; beatId: string; beatIndex: number; totalBeats: number; lintAttempts: 1 | 2 }
  | { type: "beat-fresh"; beatId: string; beatIndex: number; totalBeats: number; lintAttempts: 1 | 2; costUsd?: number; latencyMs?: number }
  | { type: "beat-failed"; beatId: string; beatIndex: number; totalBeats: number; error: string };

export interface ComposeScenesParams {
  /** Path to DESIGN.md, relative to project root. */
  design?: string;
  /** Path to STORYBOARD.md, relative to project root. */
  storyboard?: string;
  /** Scene project root, relative to outputDir. Defaults to outputDir. */
  project?: string;
  /** Effort tier — low/medium/high. Defaults to medium. */
  effort?: ComposeEffort;
  /** Override the cache directory (tests). */
  cacheDir?: string;
  /** Optional per-beat progress callback (CLI spinner / pipeline reporter). */
  onProgress?: (event: ComposeProgressEvent) => void;
}

export interface ComposeScenesActionResult {
  success: boolean;
  /** Project root (where compositions/ lives). */
  outputPath?: string;
  /** Aggregated metadata for the dry-run / final report. */
  data?: {
    beats: number;
    written: Array<{
      beatId: string;
      path: string;
      cached: boolean;
      lintAttempts: 1 | 2;
      costUsd?: number;
    }>;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
    cacheHits: number;
  };
  error?: string;
}

/**
 * Execute the action. Per-beat fanout via `Promise.allSettled` — all beats
 * compose in parallel, all errors surface together (rather than fail-fast,
 * which would still pay for in-flight API calls without surfacing their
 * findings). Tests inject `overrides` to mock the SDK + clock.
 *
 * Wall-clock for an N-beat compose ≈ slowest single beat (~8s @ Sonnet 4.6
 * per pre-flight PR #111), regardless of N. Cost still scales with N.
 */
export async function executeComposeScenesWithSkills(
  params: ComposeScenesParams,
  outputDir: string,
  overrides?: { client?: Anthropic; now?: () => number },
): Promise<ComposeScenesActionResult> {
  const projectRoot = params.project ? resolve(outputDir, params.project) : resolve(outputDir);
  const designPath = resolve(projectRoot, params.design ?? "DESIGN.md");
  const storyboardPath = resolve(projectRoot, params.storyboard ?? "STORYBOARD.md");

  if (!existsSync(designPath)) {
    return { success: false, error: `DESIGN.md not found at ${designPath}` };
  }
  if (!existsSync(storyboardPath)) {
    return { success: false, error: `STORYBOARD.md not found at ${storyboardPath}` };
  }

  const designMd = await readFile(designPath, "utf-8");
  const storyboardMd = await readFile(storyboardPath, "utf-8");

  const { global: storyboardGlobal, beats } = parseStoryboard(storyboardMd);
  if (beats.length === 0) {
    return {
      success: false,
      error: `STORYBOARD.md at ${storyboardPath} contains no \`## Beat …\` headings.`,
    };
  }

  const skillBundleLoaded = loadHyperframesSkillBundle();
  const skillBundle = { content: skillBundleLoaded.content, hash: skillBundleLoaded.hash };

  // Allow cache hit even when no API key — only fail when an actual call would be made.
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";

  const compositionsDir = join(projectRoot, "compositions");
  await mkdir(compositionsDir, { recursive: true });

  const onProgress = params.onProgress ?? (() => {});
  const totalBeats = beats.length;

  // Fan out per-beat composes. Each task returns either { ok: true, ... }
  // (with the result + write path) or { ok: false, error } so we can
  // aggregate failures in order.
  type FanoutOutcome =
    | {
        ok: true;
        beatId: string;
        beatIndex: number;
        path: string;
        result: ComposeBeatWithRetryResult;
      }
    | {
        ok: false;
        beatId: string;
        beatIndex: number;
        error: string;
      };

  const tasks: Array<Promise<FanoutOutcome>> = beats.map(async (beat, beatIndex): Promise<FanoutOutcome> => {
    onProgress({ type: "beat-start", beatId: beat.id, beatIndex, totalBeats });
    try {
      const result = await composeBeatWithRetry(
        {
          beat,
          designMd,
          storyboardGlobal,
          skillBundle,
          apiKey,
          effort: params.effort,
          cacheDir: params.cacheDir,
        },
        overrides,
      );

      const compositionPath = join(compositionsDir, `scene-${beat.id}.html`);
      await mkdir(dirname(compositionPath), { recursive: true });
      await writeFile(compositionPath, result.html, "utf-8");

      if (result.cached) {
        onProgress({
          type: "beat-cached",
          beatId: beat.id,
          beatIndex,
          totalBeats,
          lintAttempts: result.lintAttempts,
        });
      } else {
        onProgress({
          type: "beat-fresh",
          beatId: beat.id,
          beatIndex,
          totalBeats,
          lintAttempts: result.lintAttempts,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
        });
      }

      return { ok: true, beatId: beat.id, beatIndex, path: compositionPath, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress({ type: "beat-failed", beatId: beat.id, beatIndex, totalBeats, error: message });
      return { ok: false, beatId: beat.id, beatIndex, error: message };
    }
  });

  const outcomes = await Promise.all(tasks);

  // Aggregate metadata in beat order. `outcomes` is already ordered by
  // input position (Promise.all preserves order).
  const written: ComposeScenesActionResult["data"] extends infer D
    ? D extends { written: infer W } ? W : never
    : never = [];
  const failures: Array<{ beatId: string; error: string }> = [];
  let totalCostUsd = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let cacheHits = 0;

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failures.push({ beatId: outcome.beatId, error: outcome.error });
      continue;
    }
    const r = outcome.result;
    written.push({
      beatId: outcome.beatId,
      path: outcome.path,
      cached: r.cached,
      lintAttempts: r.lintAttempts,
      costUsd: r.costUsd,
    });
    if (r.cached) cacheHits++;
    if (r.costUsd) totalCostUsd += r.costUsd;
    if (r.inputTokens) totalTokensIn += r.inputTokens;
    if (r.outputTokens) totalTokensOut += r.outputTokens;
  }

  const aggregateData = {
    beats: beats.length,
    written,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    totalTokensIn,
    totalTokensOut,
    cacheHits,
  };

  if (failures.length > 0) {
    return {
      success: false,
      outputPath: projectRoot,
      error: failures.length === 1
        ? `compose-scenes-with-skills failed at beat "${failures[0].beatId}": ${failures[0].error}`
        : `compose-scenes-with-skills failed at ${failures.length} beats:\n${failures.map((f) => `  - ${f.beatId}: ${f.error}`).join("\n")}`,
      data: aggregateData,
    };
  }

  return {
    success: true,
    outputPath: projectRoot,
    data: aggregateData,
  };
}
