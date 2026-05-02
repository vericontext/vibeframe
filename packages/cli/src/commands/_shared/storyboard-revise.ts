import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createAdapter } from "../../agent/adapters/index.js";
import type { AgentMessage } from "../../agent/types.js";
import {
  ComposerResolveError,
  resolveComposer,
  type ComposerProvider,
} from "./composer-resolve.js";
import { readProjectConfig } from "./project-config.js";
import { parseStoryboard } from "./storyboard-parse.js";
import {
  validateStoryboardMarkdown,
  type StoryboardValidationIssue,
  type StoryboardValidationResult,
} from "./storyboard-edit.js";

export type StoryboardRevisionChat = (messages: AgentMessage[]) => Promise<string>;

export interface StoryboardRevisionOptions {
  projectDir: string;
  request: string;
  durationSec?: number;
  composer?: ComposerProvider;
  dryRun?: boolean;
  chat?: StoryboardRevisionChat;
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

  const currentStoryboard = await readFile(storyboardPath, "utf-8");
  const projectConfig = await readProjectConfig(projectDir);
  const explicitComposer = opts.composer ?? projectConfig.config.providers.composer ?? undefined;

  let provider = explicitComposer ?? "claude";
  let chat = opts.chat;
  if (!chat) {
    try {
      const resolution = resolveComposer(explicitComposer);
      provider = resolution.provider;
      const adapter = await createAdapter(resolution.provider);
      await adapter.initialize(resolution.apiKey);
      chat = async (messages) => {
        const response = await adapter.chat(messages, []);
        return response.content;
      };
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
  const initial = await requestRevision(chat, {
    provider,
    projectDir,
    request: opts.request,
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
      code: "STORYBOARD_REVISION_BAD_RESPONSE",
      message: initial.message,
      suggestion: "Retry the revision, or make a smaller request.",
      retryWith,
    });
  }

  let payload = initial.payload;
  let validation = validateRevision(payload.storyboardMd, opts.durationSec);
  const warnings = [...payload.warnings];

  if (!validation.ok) {
    warnings.push("Initial storyboard revision failed validation; attempted one self-repair pass.");
    const repaired = await requestRevision(chat, {
      provider,
      projectDir,
      request: opts.request,
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
    await writeFile(storyboardPath, storyboardMd, "utf-8");
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

async function requestRevision(
  chat: StoryboardRevisionChat,
  opts: {
    provider: ComposerProvider;
    projectDir: string;
    request: string;
    durationSec?: number;
    currentStoryboard: string;
    designMd: string | null;
    configJson: string;
    buildReportJson: string | null;
    invalidStoryboard?: string;
    validationIssues?: StoryboardValidationIssue[];
  },
): Promise<{ success: true; payload: RevisionPayload } | { success: false; message: string }> {
  const messages = revisionMessages(opts);
  try {
    const raw = await chat(messages);
    const parsed = parseRevisionPayload(raw);
    return { success: true, payload: parsed };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function revisionMessages(opts: {
  provider: ComposerProvider;
  projectDir: string;
  request: string;
  durationSec?: number;
  currentStoryboard: string;
  designMd: string | null;
  configJson: string;
  buildReportJson: string | null;
  invalidStoryboard?: string;
  validationIssues?: StoryboardValidationIssue[];
}): AgentMessage[] {
  const system = [
    "You revise VibeFrame STORYBOARD.md files.",
    "Return exactly one JSON object, with no markdown fence and no prose outside JSON.",
    "The JSON object must have: storyboardMd string, summary string, changedBeats string[], warnings string[].",
    "Preserve existing frontmatter, beat ids, cue YAML keys, and useful prose unless the user asks to change structure.",
    "Keep cue YAML valid. Allowed cue keys are duration, narration, backdrop, video, motion, voice, music, asset.",
    "If a target duration is supplied, every beat must have a positive duration cue and durations must sum to that target.",
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
    `Revision request:\n${opts.request}`,
    opts.durationSec ? `Target total duration: ${opts.durationSec} seconds` : "Target total duration: unchanged unless the request requires it",
    `vibe.config.json:\n${opts.configJson}`,
    opts.designMd ? `DESIGN.md:\n${opts.designMd}` : "DESIGN.md: not present",
    opts.buildReportJson ? `Latest build-report.json:\n${opts.buildReportJson}` : "Latest build-report.json: not present",
    `Current STORYBOARD.md:\n${opts.currentStoryboard}`,
    repairBlock,
  ].filter(Boolean).join("\n\n---\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
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
