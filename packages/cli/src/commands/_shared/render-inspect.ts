import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { executeReview, type ReviewResult } from "../ai-review.js";
import type { VideoReviewFeedback } from "../ai-edit.js";
import { commandExists, execSafe } from "../../utils/exec-safe.js";
import { readProjectConfig } from "./project-config.js";
import {
  buildReviewReport,
  defaultReviewReportPath,
  normalizeReviewIssues,
  scoreIssues,
  statusFromIssues,
  summarizeReviewIssues,
  uniqueRetryWith,
  writeReviewReport,
  type ReviewIssue,
  type ReviewSeverity,
  type ReviewSummary,
  type ReviewStatus,
} from "./review-report.js";

export interface TimeRange {
  start: number;
  end: number;
  duration: number;
}

export type RenderInspectModel = "flash" | "flash-2.5" | "pro";

export interface RenderInspectOptions {
  projectDir: string;
  beatId?: string;
  videoPath?: string;
  outputPath?: string;
  writeReport?: boolean;
  ai?: boolean;
  model?: RenderInspectModel;
}

export interface RenderInspectDryRunResult {
  schemaVersion: "1";
  kind: "render";
  project: string;
  beat?: string;
  videoPath: string | null;
  reportPath?: string;
  params: {
    projectDir: string;
    beatId?: string;
    videoPath?: string;
    outputPath?: string;
    writeReport: boolean;
    cheap: true;
    ai: boolean;
    model: RenderInspectModel;
  };
  checks: {
    renderFound: boolean;
    storyboardPath: string | null;
  };
}

export interface RenderAiCheck {
  enabled: true;
  model: RenderInspectModel;
  success: boolean;
  overallScore?: number;
  categories?: VideoReviewFeedback["categories"];
  recommendations?: string[];
  error?: string;
}

export interface RenderInspectResult {
  schemaVersion: "1";
  kind: "render";
  mode: "render";
  project: string;
  beat?: string;
  videoPath: string | null;
  status: ReviewStatus;
  score: number;
  issues: ReviewIssue[];
  summary: ReviewSummary;
  sourceReports: string[];
  checks: {
    renderFound: boolean;
    fileSizeBytes?: number;
    durationSec?: number;
    expectedDurationSec?: number;
    durationDriftSec?: number;
    width?: number;
    height?: number;
    expectedAspect?: string;
    hasAudio?: boolean;
    blackFrames: TimeRange[];
    silences: TimeRange[];
    ai?: RenderAiCheck;
  };
  retryWith: string[];
  reportPath?: string;
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

interface FfprobeInfo {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    size?: string;
  };
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const DEFAULT_AI_MODEL: RenderInspectModel = "flash";
const AI_CATEGORY_LABELS = {
  pacing: "Pacing",
  color: "Color",
  textReadability: "Text readability",
  audioVisualSync: "Audio-visual sync",
  composition: "Composition",
} as const;

export function parseBlackdetectOutput(output: string): TimeRange[] {
  const ranges: TimeRange[] = [];
  const regex =
    /black_start:(-?\d+(?:\.\d+)?)\s+black_end:(-?\d+(?:\.\d+)?)\s+black_duration:(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    ranges.push({
      start: Number.parseFloat(match[1]),
      end: Number.parseFloat(match[2]),
      duration: Number.parseFloat(match[3]),
    });
  }
  return ranges;
}

export function parseSilencedetectOutput(output: string): TimeRange[] {
  const starts: number[] = [];
  const ranges: TimeRange[] = [];
  const startRegex = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
  const endRegex = /silence_end:\s*(-?\d+(?:\.\d+)?)\s+\|\s+silence_duration:\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = startRegex.exec(output)) !== null) {
    starts.push(Number.parseFloat(match[1]));
  }
  let index = 0;
  while ((match = endRegex.exec(output)) !== null) {
    if (index >= starts.length) continue;
    ranges.push({
      start: starts[index],
      end: Number.parseFloat(match[1]),
      duration: Number.parseFloat(match[2]),
    });
    index++;
  }
  return ranges;
}

export async function previewInspectRender(
  opts: RenderInspectOptions
): Promise<RenderInspectDryRunResult> {
  const projectDir = resolve(opts.projectDir);
  const videoPath = await resolveRenderVideoPath(projectDir, opts.videoPath, opts.beatId);
  const writeReport = opts.writeReport !== false;
  const reportPath = writeReport
    ? opts.outputPath
      ? resolve(process.cwd(), opts.outputPath)
      : defaultReviewReportPath(projectDir)
    : undefined;
  const storyboardPath = resolveStoryboardPath(projectDir);
  return {
    schemaVersion: "1",
    kind: "render",
    project: projectDir,
    ...(opts.beatId ? { beat: opts.beatId } : {}),
    videoPath,
    reportPath,
    params: {
      projectDir,
      beatId: opts.beatId,
      videoPath: opts.videoPath,
      outputPath: opts.outputPath,
      writeReport,
      cheap: true,
      ai: opts.ai === true,
      model: opts.model ?? DEFAULT_AI_MODEL,
    },
    checks: {
      renderFound: videoPath !== null,
      storyboardPath,
    },
  };
}

export function aiReviewSeverity(score: number): ReviewSeverity {
  if (score <= 4) return "error";
  if (score <= 6) return "warning";
  return "info";
}

export function mapAiReviewFeedbackToIssues(
  feedback: VideoReviewFeedback,
  videoPath?: string
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const [key, label] of Object.entries(AI_CATEGORY_LABELS) as Array<
    [keyof typeof AI_CATEGORY_LABELS, string]
  >) {
    const category = feedback.categories[key];
    if (!category || category.issues.length === 0) continue;
    for (const issue of category.issues) {
      issues.push({
        severity: aiReviewSeverity(category.score),
        code: `AI_REVIEW_${toSnakeCase(String(key))}`,
        message: `${label}: ${issue}`,
        file: videoPath ? displayPath(videoPath) : undefined,
        fixOwner: "host-agent",
        suggestedFix: category.fixable
          ? "Adjust the relevant storyboard or scene composition, then rerender."
          : "Review this finding manually before rerendering.",
      });
    }
  }
  return issues;
}

export function scoreRenderReview(issues: ReviewIssue[], aiOverallScore?: number): number {
  const localScore = scoreIssues(issues);
  if (aiOverallScore === undefined) return localScore;
  const aiScore = Math.max(0, Math.min(100, Math.round(aiOverallScore * 10)));
  return Math.round((localScore + aiScore) / 2);
}

export async function inspectRender(opts: RenderInspectOptions): Promise<RenderInspectResult> {
  const projectDir = resolve(opts.projectDir);
  const issues: ReviewIssue[] = [];
  const retryWith: string[] = [];
  const model = opts.model ?? DEFAULT_AI_MODEL;
  const videoPath = await resolveRenderVideoPath(projectDir, opts.videoPath, opts.beatId);
  const checks: RenderInspectResult["checks"] = {
    renderFound: videoPath !== null,
    blackFrames: [],
    silences: [],
  };
  if (opts.ai) {
    checks.ai = {
      enabled: true,
      model,
      success: false,
    };
  }

  if (!videoPath) {
    issues.push({
      severity: "error",
      code: "RENDER_NOT_FOUND",
      message: opts.beatId
        ? `No rendered video was found for beat "${opts.beatId}". Pass --video or render the beat first.`
        : "No rendered video was found. Pass --video or render the project first.",
      suggestedFix: opts.beatId
        ? "Run `vibe render <project> --beat <id> --json`."
        : "Run `vibe build --stage render --json` or `vibe render --json`.",
    });
    retryWith.push(
      ...(opts.beatId
        ? [`vibe render ${projectDir} --beat ${opts.beatId} --json`]
        : [`vibe build ${projectDir} --stage render --json`, `vibe render ${projectDir} --json`])
    );
    if (checks.ai) {
      checks.ai.error = "Skipped AI review because no rendered video was found.";
    }
    return maybeWriteRenderReport(
      projectDir,
      opts,
      makeRenderResult(projectDir, opts, null, issues, checks, retryWith, scoreRenderReview(issues))
    );
  }

  const fileStat = await stat(videoPath);
  checks.fileSizeBytes = fileStat.size;
  if (fileStat.size === 0) {
    issues.push({
      severity: "error",
      code: "EMPTY_RENDER",
      message: "Rendered video file is empty.",
      file: displayPath(videoPath),
      suggestedFix: opts.beatId
        ? "Render again with `vibe render --beat <id> --json`."
        : "Render again with `vibe render --json`.",
    });
    retryWith.push(
      opts.beatId
        ? `vibe render ${projectDir} --beat ${opts.beatId} --json`
        : `vibe render ${projectDir} --json`
    );
  }

  const expectedDurationSec = await expectedDurationFromBuildReport(projectDir, opts.beatId);
  if (expectedDurationSec !== undefined) checks.expectedDurationSec = expectedDurationSec;

  if (!commandExists("ffprobe")) {
    issues.push({
      severity: "error",
      code: "FFPROBE_UNAVAILABLE",
      message: "ffprobe is required for cheap render inspection.",
      suggestedFix: "Install FFmpeg so ffprobe is available on PATH.",
    });
  } else {
    try {
      const probe = await ffprobe(videoPath);
      const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
      const audioStream = probe.streams?.find((stream) => stream.codec_type === "audio");
      const durationSec = parseOptionalNumber(probe.format?.duration);
      checks.durationSec = durationSec;
      checks.width = videoStream?.width;
      checks.height = videoStream?.height;
      checks.hasAudio = audioStream !== undefined;

      if (!videoStream) {
        issues.push({
          severity: "error",
          code: "NO_VIDEO_STREAM",
          message: "Rendered file has no video stream.",
          file: displayPath(videoPath),
        });
      }

      if (!audioStream) {
        issues.push({
          severity: "warning",
          code: "NO_AUDIO_STREAM",
          message: "Rendered file has no audio stream.",
          file: displayPath(videoPath),
          suggestedFix: opts.beatId
            ? "Check narration assets and rerun `vibe build --beat <id> --stage sync --json`."
            : "Check narration assets and rerun `vibe build --stage sync --json`.",
        });
        retryWith.push(
          opts.beatId
            ? `vibe build ${projectDir} --beat ${opts.beatId} --stage sync --json`
            : `vibe build ${projectDir} --stage sync --json`
        );
      }

      if (durationSec !== undefined && expectedDurationSec !== undefined) {
        const drift = Number((durationSec - expectedDurationSec).toFixed(3));
        checks.durationDriftSec = drift;
        if (Math.abs(drift) > Math.max(1, expectedDurationSec * 0.05)) {
          issues.push({
            severity: "warning",
            code: "DURATION_DRIFT",
            message: `Rendered duration differs from build-report duration by ${drift.toFixed(2)}s.`,
            suggestedFix: opts.beatId
              ? "Rerun `vibe build --beat <id> --stage sync --json` before rendering."
              : "Rerun `vibe build --stage sync --json` before rendering.",
          });
          retryWith.push(
            ...(opts.beatId
              ? [
                  `vibe build ${projectDir} --beat ${opts.beatId} --stage sync --json`,
                  `vibe render ${projectDir} --beat ${opts.beatId} --json`,
                ]
              : [
                  `vibe build ${projectDir} --stage sync --json`,
                  `vibe render ${projectDir} --json`,
                ])
          );
        }
      }

      const loadedConfig = await readProjectConfig(projectDir);
      checks.expectedAspect = loadedConfig.config.aspect;
      if (videoStream?.width && videoStream.height) {
        const expectedRatio = aspectRatio(loadedConfig.config.aspect);
        const actualRatio = videoStream.width / videoStream.height;
        if (Math.abs(actualRatio - expectedRatio) > 0.08) {
          issues.push({
            severity: "warning",
            code: "ASPECT_MISMATCH",
            message: `Rendered dimensions ${videoStream.width}x${videoStream.height} do not match project aspect ${loadedConfig.config.aspect}.`,
            suggestedFix: "Check `vibe.config.json` and render settings.",
          });
        }
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "FFPROBE_FAILED",
        message: `ffprobe failed: ${error instanceof Error ? error.message : String(error)}`,
        file: displayPath(videoPath),
      });
    }
  }

  if (commandExists("ffmpeg")) {
    try {
      checks.blackFrames = await detectBlackFrames(videoPath);
      for (const range of checks.blackFrames) {
        issues.push({
          severity: "warning",
          code: "BLACK_FRAME_SEGMENT",
          message: `Black frame segment from ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s (${range.duration.toFixed(2)}s).`,
          file: displayPath(videoPath),
          suggestedFix: "Inspect scene backgrounds or rerender after repairing composition timing.",
        });
      }
    } catch (error) {
      issues.push({
        severity: "info",
        code: "BLACKDETECT_SKIPPED",
        message: `Black-frame scan skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (checks.hasAudio !== false) {
      try {
        checks.silences = await detectLongSilences(videoPath);
        for (const range of checks.silences) {
          issues.push({
            severity: "warning",
            code: "LONG_SILENCE",
            message: `Long silence from ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s (${range.duration.toFixed(2)}s).`,
            file: displayPath(videoPath),
            suggestedFix: opts.beatId
              ? "Check narration/music wiring and rerun `vibe build --beat <id> --stage sync --json`."
              : "Check narration/music wiring and rerun `vibe build --stage sync --json`.",
          });
        }
      } catch (error) {
        issues.push({
          severity: "info",
          code: "SILENCEDETECT_SKIPPED",
          message: `Silence scan skipped: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  } else {
    issues.push({
      severity: "info",
      code: "FFMPEG_UNAVAILABLE",
      message: "ffmpeg is not available, so black-frame and silence scans were skipped.",
      suggestedFix: "Install FFmpeg for full cheap render inspection.",
    });
  }

  let aiOverallScore: number | undefined;
  if (opts.ai && checks.ai) {
    if (fileStat.size === 0) {
      checks.ai.error = "Skipped AI review because the rendered video file is empty.";
    } else {
      const aiResult = await runAiRenderReview(projectDir, videoPath, model);
      if (aiResult.success && aiResult.feedback) {
        checks.ai.success = true;
        checks.ai.overallScore = aiResult.feedback.overallScore;
        checks.ai.categories = aiResult.feedback.categories;
        checks.ai.recommendations = aiResult.feedback.recommendations;
        aiOverallScore = aiResult.feedback.overallScore;
        const aiIssues = mapAiReviewFeedbackToIssues(aiResult.feedback, videoPath);
        issues.push(...aiIssues);
        if (aiIssues.length > 0) {
          retryWith.push(
            'codex "fix issues from review-report.json"',
            opts.beatId
              ? `vibe render ${projectDir} --beat ${opts.beatId} --json`
              : `vibe render ${projectDir} --json`,
            opts.beatId
              ? `vibe inspect render ${projectDir} --beat ${opts.beatId} --ai --json`
              : `vibe inspect render ${projectDir} --ai --json`
          );
        }
      } else {
        const message = aiResult.error ?? "Gemini video review failed";
        checks.ai.error = message;
        issues.push({
          severity: "error",
          code: "AI_REVIEW_FAILED",
          message: `AI render review failed: ${message}`,
          file: displayPath(videoPath),
          suggestedFix: "Set GOOGLE_API_KEY or retry the AI review later.",
        });
      }
    }
  }

  const result = makeRenderResult(
    projectDir,
    opts,
    videoPath,
    issues,
    checks,
    retryWith,
    scoreRenderReview(issues, aiOverallScore)
  );
  return maybeWriteRenderReport(projectDir, opts, result);
}

function makeRenderResult(
  projectDir: string,
  opts: RenderInspectOptions,
  videoPath: string | null,
  issues: ReviewIssue[],
  checks: RenderInspectResult["checks"],
  retryWith: string[],
  score: number
): RenderInspectResult {
  const normalizedIssues = normalizeReviewIssues(issues);
  const status = statusFromIssues(normalizedIssues);
  return {
    schemaVersion: "1",
    kind: "render",
    mode: "render",
    project: projectDir,
    ...(opts.beatId ? { beat: opts.beatId } : {}),
    videoPath,
    status,
    score,
    issues: normalizedIssues,
    summary: summarizeReviewIssues(normalizedIssues),
    sourceReports: renderSourceReports(projectDir, videoPath, checks),
    checks,
    retryWith: uniqueRetryWith(retryWith),
  };
}

async function maybeWriteRenderReport(
  projectDir: string,
  opts: RenderInspectOptions,
  result: RenderInspectResult
): Promise<RenderInspectResult> {
  if (opts.writeReport === false) return result;
  const reportPath = opts.outputPath
    ? resolve(process.cwd(), opts.outputPath)
    : defaultReviewReportPath(projectDir);
  try {
    const reviewReport = buildReviewReport({
      project: projectDir,
      mode: "render",
      beat: result.beat,
      status: result.status,
      score: result.score,
      issues: result.issues,
      retryWith: result.retryWith,
      sourceReports: result.sourceReports,
      reportPath,
    });
    await writeReviewReport(reportPath, reviewReport as unknown as Record<string, unknown>);
    return { ...result, reportPath };
  } catch {
    return result;
  }
}

function renderSourceReports(
  projectDir: string,
  videoPath: string | null,
  checks: RenderInspectResult["checks"]
): string[] {
  const reports: string[] = [];
  if (existsSync(join(projectDir, "build-report.json"))) reports.push("build-report.json");
  if (existsSync(join(projectDir, "render-report.json"))) reports.push("render-report.json");
  if (videoPath) reports.push(displayPath(videoPath));
  if (
    checks.durationSec !== undefined ||
    checks.width !== undefined ||
    checks.height !== undefined
  ) {
    reports.push("ffprobe");
  }
  if (checks.blackFrames.length > 0 || checks.silences.length > 0) reports.push("ffmpeg");
  if (checks.ai) reports.push("gemini-review");
  return reports;
}

export async function resolveRenderVideoPath(
  projectDir: string,
  explicit?: string,
  beatId?: string
): Promise<string | null> {
  if (explicit) {
    const candidate = resolve(process.cwd(), explicit);
    return existsSync(candidate) ? candidate : null;
  }

  const renderReportPath = join(projectDir, "render-report.json");
  if (existsSync(renderReportPath)) {
    try {
      const report = JSON.parse(await readFile(renderReportPath, "utf-8")) as {
        beat?: unknown;
        outputPath?: unknown;
      };
      const reportBeat = typeof report.beat === "string" ? report.beat : null;
      if ((!beatId && reportBeat === null) || (beatId && reportBeat === beatId)) {
        const candidate = resolveReportedPath(projectDir, report.outputPath);
        if (candidate && existsSync(candidate)) return candidate;
      }
    } catch {
      // Fall through to build-report/renders scan.
    }
  }

  const reportPath = join(projectDir, "build-report.json");
  if (!beatId && existsSync(reportPath)) {
    try {
      const report = JSON.parse(await readFile(reportPath, "utf-8")) as { outputPath?: unknown };
      const candidate = resolveReportedPath(projectDir, report.outputPath);
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      // Fall through to renders/ scan.
    }
  }

  const rendersDir = join(projectDir, "renders");
  if (!existsSync(rendersDir)) return null;
  const entries = await readdir(rendersDir, { withFileTypes: true });
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    if (beatId && !entry.name.includes(sanitizeFileSegment(beatId))) continue;
    const full = join(rendersDir, entry.name);
    const info = await stat(full);
    candidates.push({ path: full, mtimeMs: info.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

async function runAiRenderReview(
  projectDir: string,
  videoPath: string,
  model: RenderInspectModel
): Promise<ReviewResult> {
  return executeReview({
    videoPath,
    storyboardPath: resolveStoryboardPath(projectDir) ?? undefined,
    autoApply: false,
    verify: false,
    model,
  });
}

function resolveStoryboardPath(projectDir: string): string | null {
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  return existsSync(storyboardPath) ? storyboardPath : null;
}

async function expectedDurationFromBuildReport(
  projectDir: string,
  beatId?: string
): Promise<number | undefined> {
  const reportPath = join(projectDir, "build-report.json");
  if (!existsSync(reportPath)) return undefined;
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      beats?: Array<{
        id?: unknown;
        sceneDurationSec?: unknown;
        narration?: { sceneDurationSec?: unknown };
      }>;
    };
    const beats = beatId
      ? (report.beats ?? []).filter((beat) => beat.id === beatId)
      : (report.beats ?? []);
    const durations = beats
      .map(
        (beat) =>
          parseOptionalNumber(beat.sceneDurationSec) ??
          parseOptionalNumber(beat.narration?.sceneDurationSec)
      )
      .filter((n): n is number => n !== undefined);
    if (durations.length === 0) return undefined;
    return Number(durations.reduce((sum, value) => sum + value, 0).toFixed(3));
  } catch {
    return undefined;
  }
}

async function ffprobe(videoPath: string): Promise<FfprobeInfo> {
  const { stdout } = await execSafe("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  return JSON.parse(stdout) as FfprobeInfo;
}

async function detectBlackFrames(videoPath: string): Promise<TimeRange[]> {
  const output = await ffmpegNull(videoPath, ["-vf", "blackdetect=d=0.5:pic_th=0.98", "-an"]);
  return parseBlackdetectOutput(output);
}

async function detectLongSilences(videoPath: string): Promise<TimeRange[]> {
  const output = await ffmpegNull(videoPath, ["-af", "silencedetect=noise=-35dB:d=1"]);
  return parseSilencedetectOutput(output);
}

async function ffmpegNull(input: string, filterArgs: string[]): Promise<string> {
  const { stdout, stderr } = await execSafe(
    "ffmpeg",
    ["-hide_banner", "-i", input, ...filterArgs, "-f", "null", "-"],
    { maxBuffer: 50 * 1024 * 1024 }
  ).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return { stdout: err.stdout || "", stderr: err.stderr || "" };
    }
    throw err;
  });
  return stdout + stderr;
}

function parseOptionalNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : undefined;
}

function aspectRatio(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return 16 / 9;
  return w / h;
}

function displayPath(path: string): string {
  return relative(process.cwd(), path) || basename(path);
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match}`).toUpperCase();
}

function resolveReportedPath(projectDir: string, value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return isAbsolute(value) ? value : resolve(projectDir, value);
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "beat";
}
