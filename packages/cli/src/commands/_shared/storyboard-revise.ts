import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createTextGenerator,
  isProviderError,
  type TextGenerator,
  type TextRequest,
} from "@vibeframe/ai-providers";
import {
  ComposerResolveError,
  resolveComposer,
  type ComposerProvider,
} from "./composer-resolve.js";
import { readProjectConfig } from "./project-config.js";
import { parseStoryboard, STORYBOARD_CUE_KEYS } from "./storyboard-parse.js";
import { loadStoryboard, rewriteBundleFromMarkdown } from "./storyboard-source.js";
import {
  validateStoryboardMarkdown,
  type StoryboardValidationIssue,
  type StoryboardValidationResult,
} from "./storyboard-edit.js";

export interface StoryboardRevisionOptions {
  projectDir: string;
  request: string;
  durationSec?: number;
  composer?: ComposerProvider;
  dryRun?: boolean;
  /**
   * "draft" writes a storyboard for `request` (a brief) on top of the
   * skeleton `vibe init --from` scaffolds, instead of editing an authored one.
   */
  mode?: "revise" | "draft";
  /** Overrides the composer's text generator (tests). */
  generator?: TextGenerator;
}

export interface StoryboardRevisionResult {
  schemaVersion: "1";
  kind: "storyboard-revision";
  success: boolean;
  projectDir: string;
  storyboardPath: string;
  provider?: ComposerProvider;
  summary: string;
  changedBeats: string[];
  validation: StoryboardValidationResult;
  warnings: string[];
  wrote: boolean;
  retryWith: string[];
  storyboard?: string;
  code?: string;
  message?: string;
  suggestion?: string;
  recoverable?: boolean;
}

interface RevisionPayload {
  storyboardMd: string;
  summary: string;
  changedBeats: string[];
  warnings: string[];
}

export async function executeStoryboardRevision(opts: StoryboardRevisionOptions): Promise<StoryboardRevisionResult> {
  const projectDir = resolve(opts.projectDir);
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const retryWith = [`vibe storyboard revise ${projectDir} --from "<request>" --dry-run --json`];
  if (!existsSync(storyboardPath)) {
    return failureResult({
      projectDir,
      storyboardPath,
      code: "STORYBOARD_NOT_FOUND",
      message: `STORYBOARD.md not found at ${storyboardPath}.`,
      suggestion: `Run 'vibe init ${projectDir} --from "<brief>" --json' first.`,
      retryWith: [`vibe init ${projectDir} --from "<brief>" --json`],
    });
  }

  // Read through the loader: on a bundle the current storyboard is the
  // assembled scenes, not the near-empty STORYBOARD.md on disk.
  const loaded = await loadStoryboard(projectDir);
  const currentStoryboard = loaded.markdown;
  const projectConfig = await readProjectConfig(projectDir);
  const explicitComposer = opts.composer ?? projectConfig.config.providers.composer ?? undefined;

  let provider = explicitComposer ?? "claude";
  let generator = opts.generator;
  if (!generator) {
    try {
      const resolution = resolveComposer(explicitComposer);
      provider = resolution.provider;
      generator = await createTextGenerator(resolution.provider, resolution.apiKey);
    } catch (error) {
      if (error instanceof ComposerResolveError) {
        return failureResult({
          projectDir,
          storyboardPath,
          provider: explicitComposer,
          code: "COMPOSER_KEY_MISSING",
          message: error.message,
          suggestion: "Set a composer API key with `vibe setup`, or pass --composer for a configured provider.",
          retryWith: ["vibe setup", ...retryWith],
        });
      }
      return failureResult({
        projectDir,
        storyboardPath,
        provider,
        code: "STORYBOARD_REVISION_PROVIDER_ERROR",
        message: error instanceof Error ? error.message : String(error),
        suggestion: "Retry with a different composer provider.",
        retryWith,
      });
    }
  }

  const context = await readRevisionContext(projectDir);
  const initial = await requestRevision(generator, {
    provider,
    projectDir,
    request: opts.request,
    draft: opts.mode === "draft",
    durationSec: opts.durationSec,
    currentStoryboard,
    designMd: context.designMd,
    configJson: JSON.stringify(projectConfig.config, null, 2),
    buildReportJson: context.buildReportJson,
  });
  if (!initial.success) {
    return failureResult({
      projectDir,
      storyboardPath,
      provider,
      code: initial.code,
      message: initial.message,
      suggestion: initial.suggestion,
      retryWith,
    });
  }

  let payload = initial.payload;
  let validation = validateRevision(payload.storyboardMd, opts.durationSec);
  const warnings = [...payload.warnings];

  if (!validation.ok) {
    warnings.push("Initial storyboard revision failed validation; attempted one self-repair pass.");
    const repaired = await requestRevision(generator, {
      provider,
      projectDir,
      request: opts.request,
      draft: opts.mode === "draft",
      durationSec: opts.durationSec,
      currentStoryboard,
      designMd: context.designMd,
      configJson: JSON.stringify(projectConfig.config, null, 2),
      buildReportJson: context.buildReportJson,
      invalidStoryboard: payload.storyboardMd,
      validationIssues: validation.issues,
    });
    if (repaired.success) {
      payload = repaired.payload;
      validation = validateRevision(payload.storyboardMd, opts.durationSec);
      warnings.push(...payload.warnings);
    }
  }

  if (!validation.ok) {
    return failureResult({
      projectDir,
      storyboardPath,
      provider,
      code: "STORYBOARD_REVISION_INVALID",
      message: "The revised storyboard did not pass validation.",
      suggestion: "Retry with a narrower request or edit STORYBOARD.md directly.",
      retryWith: [`vibe storyboard validate ${projectDir} --json`, ...retryWith],
      validation,
      warnings,
      storyboard: payload.storyboardMd,
    });
  }

  const storyboardMd = normalizeMarkdown(payload.storyboardMd);
  if (!opts.dryRun) {
    if (loaded.layout === "bundle") {
      // Writing the model's single document to STORYBOARD.md would lose the
      // revision entirely: scenes/ still wins, so the old scenes would render
      // while the new beats sat in STORYBOARD.md being reported as stray.
      // Re-split instead, and drop scene files the revision no longer names.
      await rewriteBundleFromMarkdown(projectDir, storyboardMd);
    } else {
      await writeFile(storyboardPath, storyboardMd, "utf-8");
    }
  }

  const changedBeats = unique([...diffChangedBeats(currentStoryboard, storyboardMd), ...payload.changedBeats]);
  return stripUndefined({
    schemaVersion: "1" as const,
    kind: "storyboard-revision" as const,
    success: true,
    projectDir,
    storyboardPath,
    provider,
    summary: payload.summary,
    changedBeats,
    validation,
    warnings,
    wrote: !opts.dryRun,
    retryWith: [`vibe storyboard validate ${projectDir} --json`, `vibe plan ${projectDir} --json`],
    storyboard: opts.dryRun ? storyboardMd : undefined,
  });
}

/** The reply shape, enforced by the provider's structured output. */
const REVISION_SCHEMA = {
  type: "object",
  properties: {
    storyboardMd: { type: "string" },
    summary: { type: "string" },
    changedBeats: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["storyboardMd", "summary", "changedBeats", "warnings"],
  additionalProperties: false,
};

type RevisionAttempt =
  | { success: true; payload: RevisionPayload }
  | { success: false; code: string; message: string; suggestion: string };

async function requestRevision(
  generator: TextGenerator,
  opts: {
    provider: ComposerProvider;
    projectDir: string;
    request: string;
    draft: boolean;
    durationSec?: number;
    currentStoryboard: string;
    designMd: string | null;
    configJson: string;
    buildReportJson: string | null;
    invalidStoryboard?: string;
    validationIssues?: StoryboardValidationIssue[];
  },
): Promise<RevisionAttempt> {
  let text: string;
  try {
    ({ text } = await generator.generateText({ ...revisionRequest(opts), jsonSchema: REVISION_SCHEMA }));
  } catch (error) {
    if (!isProviderError(error)) throw error;
    return {
      success: false,
      code: "STORYBOARD_REVISION_PROVIDER_ERROR",
      message: error.message,
      suggestion:
        error.kind === "auth"
          ? "Check the composer API key with `vibe setup`."
          : error.retryable
            ? "Retry the revision in a moment."
            : "Retry with a narrower request or a different --composer.",
    };
  }
  try {
    return { success: true, payload: parseRevisionPayload(text) };
  } catch (error) {
    return {
      success: false,
      code: "STORYBOARD_REVISION_BAD_RESPONSE",
      message: error instanceof Error ? error.message : String(error),
      suggestion: "Retry the revision, or make a smaller request.",
    };
  }
}

function revisionRequest(opts: {
  provider: ComposerProvider;
  projectDir: string;
  request: string;
  draft: boolean;
  durationSec?: number;
  currentStoryboard: string;
  designMd: string | null;
  configJson: string;
  buildReportJson: string | null;
  invalidStoryboard?: string;
  validationIssues?: StoryboardValidationIssue[];
}): TextRequest {
  const task = opts.draft
    ? [
        "You write VibeFrame STORYBOARD.md files from a brief.",
        "The current STORYBOARD.md is a skeleton made offline from the brief. Keep its frontmatter (set title to the video's subject) and its format: one `## Beat <id> - <Title>` heading per beat, then one ```yaml cue block, then a line or two of direction.",
        "Replace the skeleton's beats with the beats this video needs. Every beat needs narration (the words spoken, in the brief's language), a backdrop (an image prompt with no readable text or logos), and motion.",
        "Reply with the JSON object the schema describes: storyboardMd is the full STORYBOARD.md, changedBeats the ids of every beat, warnings anything the user should check before spending on providers.",
      ]
    : [
        "You revise VibeFrame STORYBOARD.md files.",
        "Reply with the JSON object the schema describes: storyboardMd is the full revised STORYBOARD.md, changedBeats the ids of beats you changed, warnings anything the user should know.",
        "Preserve existing frontmatter, beat ids, cue YAML keys, and useful prose unless the user asks to change structure.",
      ];
  const system = [
    ...task,
    // Rendered from the SSOT: this list used to be a hand-typed subset of 8,
    // so a revise pass could silently drop `characters`, `keyframe`, and the
    // lower-third cues it had never been told about.
    `Keep cue YAML valid. Allowed cue keys are ${STORYBOARD_CUE_KEYS.join(", ")}.`,
    "If a target duration is supplied, every beat must have a positive duration cue and durations must sum to that target.",
    "Aim for 6-15 seconds per beat and never exceed ~15s - long beats render as static, overstuffed scenes. A 90-second video should have 6-8 beats.",
  ].join("\n");

  const repairBlock = opts.invalidStoryboard
    ? [
        "The previous revision failed validation. Repair it.",
        "Validation issues:",
        JSON.stringify(opts.validationIssues ?? [], null, 2),
        "Invalid storyboard:",
        opts.invalidStoryboard,
      ].join("\n\n")
    : "";

  const user = [
    `Project directory: ${opts.projectDir}`,
    opts.draft ? `Brief:\n${opts.request}` : `Revision request:\n${opts.request}`,
    opts.durationSec ? `Target total duration: ${opts.durationSec} seconds` : "Target total duration: unchanged unless the request requires it",
    `vibe.config.json:\n${opts.configJson}`,
    opts.designMd ? `DESIGN.md:\n${opts.designMd}` : "DESIGN.md: not present",
    opts.buildReportJson ? `Latest build-report.json:\n${opts.buildReportJson}` : "Latest build-report.json: not present",
    `Current STORYBOARD.md:\n${opts.currentStoryboard}`,
    repairBlock,
  ].filter(Boolean).join("\n\n---\n\n");

  return { system, messages: [{ role: "user", content: user }] };
}

function parseRevisionPayload(raw: string): RevisionPayload {
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  if (typeof parsed.storyboardMd !== "string" || parsed.storyboardMd.trim().length === 0) {
    throw new Error("Revision response must include a non-empty storyboardMd string.");
  }
  return {
    storyboardMd: normalizeMarkdown(parsed.storyboardMd),
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "Storyboard revised.",
    changedBeats: Array.isArray(parsed.changedBeats)
      ? parsed.changedBeats.filter((item): item is string => typeof item === "string")
      : [],
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) return candidate.slice(start, end + 1);
  throw new Error("Revision response did not contain a JSON object.");
}

function validateRevision(markdown: string, durationSec: number | undefined): StoryboardValidationResult {
  const base = validateStoryboardMarkdown(markdown);
  const issues = [...base.issues];
  if (durationSec !== undefined && base.beats.length > 0) {
    const missing = base.beats.filter((beat) => beat.duration === undefined);
    for (const beat of missing) {
      issues.push({
        severity: "error",
        code: "MISSING_DURATION",
        beatId: beat.id,
        message: `Beat "${beat.id}" needs a duration cue when --duration is used.`,
      });
    }
    const total = base.beats.reduce((sum, beat) => sum + (beat.duration ?? 0), 0);
    if (missing.length === 0 && Math.abs(total - durationSec) > 0.25) {
      issues.push({
        severity: "error",
        code: "TARGET_DURATION_MISMATCH",
        message: `Beat durations sum to ${Number(total.toFixed(2))}s, expected ${durationSec}s.`,
      });
    }
  }
  return {
    ...base,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function diffChangedBeats(before: string, after: string): string[] {
  const beforeBeats = new Map(parseStoryboard(before).beats.map((beat) => [beat.id, beat]));
  const afterBeats = new Map(parseStoryboard(after).beats.map((beat) => [beat.id, beat]));
  const ids = unique([...beforeBeats.keys(), ...afterBeats.keys()]);
  return ids.filter((id) => JSON.stringify(beforeBeats.get(id) ?? null) !== JSON.stringify(afterBeats.get(id) ?? null));
}

async function readRevisionContext(projectDir: string): Promise<{
  designMd: string | null;
  buildReportJson: string | null;
}> {
  const designMd = await readOptionalText(join(projectDir, "DESIGN.md"));
  const buildReportJson = await readOptionalJsonText(join(projectDir, "build-report.json"));
  return { designMd, buildReportJson };
}

async function readOptionalText(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  return readFile(path, "utf-8");
}

async function readOptionalJsonText(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

function failureResult(opts: {
  projectDir: string;
  storyboardPath: string;
  provider?: ComposerProvider;
  code: string;
  message: string;
  suggestion: string;
  retryWith: string[];
  validation?: StoryboardValidationResult;
  warnings?: string[];
  storyboard?: string;
}): StoryboardRevisionResult {
  return stripUndefined({
    schemaVersion: "1" as const,
    kind: "storyboard-revision" as const,
    success: false,
    projectDir: opts.projectDir,
    storyboardPath: opts.storyboardPath,
    provider: opts.provider,
    summary: "",
    changedBeats: [],
    validation: opts.validation ?? { ok: false, beats: [], issues: [] },
    warnings: opts.warnings ?? [],
    wrote: false,
    retryWith: unique(opts.retryWith),
    storyboard: opts.storyboard,
    code: opts.code,
    message: opts.message,
    suggestion: opts.suggestion,
    recoverable: true,
  });
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
