import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import { executeReview, type ReviewResult } from "../ai-review.js";
import type { VideoReviewFeedback } from "../ai-edit.js";
import { commandExists, execSafe } from "../../utils/exec-safe.js";
import { readProjectConfig } from "./project-config.js";
import { parseStoryboard } from "./storyboard-parse.js";
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

export interface BeatTiming {
  id: string;
  start: number;
  end: number;
  sceneDurationSec: number;
  narrationDurationSec?: number;
}

export type RenderInspectModel = string;

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
    staticFrames: TimeRange[];
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
const BLACK_FRAME_MIN_DURATION_SEC = 1;
const STATIC_FRAME_MIN_DURATION_SEC = 2;
const STATIC_FRAME_ERROR_MIN_DURATION_SEC = 3;
const LONG_SILENCE_MIN_DURATION_SEC = 2;
const DURATION_DRIFT_MIN_SEC = 1.25;
const DURATION_DRIFT_RATIO = 0.08;
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

export function parseFreezedetectOutput(output: string): TimeRange[] {
  const ranges: TimeRange[] = [];
  let start: number | undefined;
  let duration: number | undefined;
  const regex = /lavfi\.freezedetect\.freeze_(start|duration|end):\s*(-?\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const key = match[1];
    const value = Number.parseFloat(match[2]);
    if (key === "start") {
      start = value;
      duration = undefined;
      continue;
    }
    if (key === "duration") {
      duration = value;
      continue;
    }
    if (key === "end" && start !== undefined) {
      const end = value;
      ranges.push({
        start,
        end,
        duration: duration ?? Number((end - start).toFixed(3)),
      });
      start = undefined;
      duration = undefined;
    }
  }
  return ranges;
}

export function staticFrameIssueForRange(
  range: TimeRange,
  beats: BeatTiming[],
  videoPath?: string
): ReviewIssue {
  const beat = beatForRange(range, beats);
  const overlapRatio = beat ? beatOverlapRatio(range, beat) : undefined;
  const mostlyStatic =
    overlapRatio !== undefined &&
    overlapRatio >= 0.8 &&
    range.duration >= STATIC_FRAME_ERROR_MIN_DURATION_SEC;
  return {
    severity: mostlyStatic ? "error" : "warning",
    code: "STATIC_FRAME_SEGMENT",
    message: `Static frame segment from ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s (${range.duration.toFixed(2)}s).`,
    file: videoPath ? displayPath(videoPath) : undefined,
    beatId: beat?.id,
    scene: beat?.id,
    timeRange: range,
    sceneDurationSec: beat?.sceneDurationSec,
    narrationDurationSec: beat?.narrationDurationSec,
    fixOwner: "host-agent",
    suggestedFix: beat
      ? "The beat holds too long without visual change. Add motion, shorten the beat, replace the generated video/backdrop, or revise the scene composition."
      : "Add motion, shorten the hold, replace the generated visual asset, or revise the scene composition.",
  };
}

export function blackFrameIssueForRange(
  range: TimeRange,
  beats: BeatTiming[],
  videoPath?: string
): ReviewIssue {
  const beat = beatForRange(range, beats);
  const overlapRatio = beat ? beatOverlapRatio(range, beat) : undefined;
  const mostlyBlack =
    overlapRatio !== undefined &&
    overlapRatio >= 0.8 &&
    range.duration >= BLACK_FRAME_MIN_DURATION_SEC;
  return {
    severity: mostlyBlack ? "error" : "warning",
    code: "BLACK_FRAME_SEGMENT",
    message: `Black frame segment from ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s (${range.duration.toFixed(2)}s).`,
    file: videoPath ? displayPath(videoPath) : undefined,
    beatId: beat?.id,
    scene: beat?.id,
    timeRange: range,
    sceneDurationSec: beat?.sceneDurationSec,
    narrationDurationSec: beat?.narrationDurationSec,
    fixOwner: beat ? "host-agent" : "vibe",
    suggestedFix: beat
      ? "The beat renders black for too long. Check the backdrop/media cue, scene composition background, and timeline visibility before rerendering."
      : "Inspect scene backgrounds or rerender after repairing composition timing.",
  };
}

export function durationDriftIssue(params: {
  durationSec: number;
  expectedDurationSec: number;
  driftSec: number;
  beats: BeatTiming[];
  beatId?: string;
  videoPath?: string;
}): ReviewIssue {
  const range = durationDriftRange(params.durationSec, params.expectedDurationSec);
  const beat =
    params.beatId !== undefined
      ? params.beats.find((candidate) => candidate.id === params.beatId)
      : beatForRange(range, params.beats);
  return {
    severity: "warning",
    code: "DURATION_DRIFT",
    message: `Rendered duration differs from build-report duration by ${params.driftSec.toFixed(2)}s (expected ${params.expectedDurationSec.toFixed(2)}s, got ${params.durationSec.toFixed(2)}s).`,
    file: params.videoPath ? displayPath(params.videoPath) : undefined,
    beatId: beat?.id ?? params.beatId,
    scene: beat?.id ?? params.beatId,
    timeRange: range,
    sceneDurationSec: beat?.sceneDurationSec,
    narrationDurationSec: beat?.narrationDurationSec,
    fixOwner: "vibe",
    suggestedFix: params.beatId
      ? "Rerun `vibe build --beat <id> --stage sync --json` before rendering."
      : "Rerun `vibe build --stage sync --json` before rendering.",
  };
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
  for (const issue of feedback.beatIssues ?? []) {
    if (!issue.message) continue;
    const category = issue.category ? toSnakeCase(issue.category) : "beat_issue";
    const severity =
      issue.severity === "error" || issue.severity === "warning" || issue.severity === "info"
        ? issue.severity
        : "warning";
    issues.push({
      severity,
      code: `AI_REVIEW_${category.toUpperCase()}`,
      message: issue.message,
      file: videoPath ? displayPath(videoPath) : undefined,
      beatId: issue.beatId ?? issue.scene,
      scene: issue.scene ?? issue.beatId,
      timeRange: normalizeTimeRange(issue.timeRange),
      fixOwner: "host-agent",
      suggestedFix:
        issue.suggestedFix ??
        "Adjust STORYBOARD.md, DESIGN.md, or the affected scene composition, then rerender.",
    });
  }
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
    staticFrames: [],
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

  const beatTimings = await beatTimingsFromBuildReport(projectDir, opts.beatId);
  const expectedDurationSec =
    beatTimings.length > 0
      ? Number(beatTimings.reduce((sum, beat) => sum + beat.sceneDurationSec, 0).toFixed(3))
      : await expectedDurationFromBuildReport(projectDir, opts.beatId);
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
        if (
          Math.abs(drift) >
          Math.max(DURATION_DRIFT_MIN_SEC, expectedDurationSec * DURATION_DRIFT_RATIO)
        ) {
          issues.push(
            durationDriftIssue({
              durationSec,
              expectedDurationSec,
              driftSec: drift,
              beats: beatTimings,
              beatId: opts.beatId,
              videoPath,
            })
          );
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
        const beat = beatForRange(range, beatTimings);
        issues.push(blackFrameIssueForRange(range, beatTimings, videoPath));
        if (beat?.id) {
          retryWith.push(
            `vibe storyboard get ${projectDir} ${beat.id} --json`,
            `vibe scene repair ${projectDir} --json`,
            `vibe render ${projectDir} --beat ${beat.id} --json`
          );
        } else {
          retryWith.push(
            `vibe inspect project ${projectDir} --json`,
            `vibe scene repair ${projectDir} --json`,
            `vibe render ${projectDir} --json`
          );
        }
      }
    } catch (error) {
      issues.push({
        severity: "info",
        code: "BLACKDETECT_SKIPPED",
        message: `Black-frame scan skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    try {
      checks.staticFrames = await detectStaticFrames(videoPath);
      for (const range of checks.staticFrames) {
        const beat = beatForRange(range, beatTimings);
        issues.push(staticFrameIssueForRange(range, beatTimings, videoPath));
        if (beat?.id) {
          retryWith.push(
            `vibe storyboard get ${projectDir} ${beat.id} --json`,
            `vibe build ${projectDir} --beat ${beat.id} --stage compose --force --json`,
            `vibe render ${projectDir} --beat ${beat.id} --json`
          );
        } else {
          retryWith.push(
            `vibe inspect project ${projectDir} --json`,
            `vibe render ${projectDir} --json`
          );
        }
      }
    } catch (error) {
      issues.push({
        severity: "info",
        code: "FREEZEDETECT_SKIPPED",
        message: `Static-frame scan skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (checks.hasAudio !== false) {
      try {
        checks.silences = await detectLongSilences(videoPath);
        for (const range of checks.silences) {
          const beat = beatForRange(range, beatTimings);
          const audioCoverageRatio =
            beat?.narrationDurationSec && beat.sceneDurationSec > 0
              ? Number(Math.min(1, beat.narrationDurationSec / beat.sceneDurationSec).toFixed(3))
              : undefined;
          const semanticHold = audioCoverageRatio !== undefined && audioCoverageRatio < 0.75;
          issues.push({
            severity: "warning",
            code: "LONG_SILENCE",
            message: `Long silence from ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s (${range.duration.toFixed(2)}s).`,
            file: displayPath(videoPath),
            beatId: beat?.id,
            scene: beat?.id,
            timeRange: range,
            sceneDurationSec: beat?.sceneDurationSec,
            narrationDurationSec: beat?.narrationDurationSec,
            audioCoverageRatio,
            fixOwner: semanticHold ? "host-agent" : "vibe",
            suggestedFix: semanticHold
              ? "Narration is much shorter than the beat. Shorten the beat duration, extend narration, add music, or regenerate the beat."
              : opts.beatId
                ? "Check narration/music wiring and rerun `vibe build --beat <id> --stage sync --json`."
                : "Check narration/music wiring and rerun `vibe build --stage sync --json`.",
          });
          if (semanticHold && beat?.id) {
            retryWith.push(
              `vibe storyboard get ${projectDir} ${beat.id} --json`,
              `vibe build ${projectDir} --beat ${beat.id} --stage assets --force --json`
            );
          } else {
            retryWith.push(
              opts.beatId
                ? `vibe build ${projectDir} --beat ${opts.beatId} --stage sync --json`
                : `vibe build ${projectDir} --stage sync --json`
            );
          }
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
  if (checks.staticFrames.length > 0) reports.push("ffmpeg-freezedetect");
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
    projectContext: await buildRenderReviewProjectContext(projectDir),
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

async function beatTimingsFromBuildReport(
  projectDir: string,
  beatId?: string
): Promise<BeatTiming[]> {
  const reportPath = join(projectDir, "build-report.json");
  if (!existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(await readFile(reportPath, "utf-8")) as {
      beats?: Array<{
        id?: unknown;
        sceneDurationSec?: unknown;
        narrationDurationSec?: unknown;
        narration?: { durationSec?: unknown; sceneDurationSec?: unknown };
      }>;
    };
    const source = report.beats ?? [];
    const selected = beatId ? source.filter((beat) => beat.id === beatId) : source;
    let cursor = 0;
    const timings: BeatTiming[] = [];
    for (const beat of selected) {
      const id = typeof beat.id === "string" ? beat.id : `beat-${timings.length + 1}`;
      const sceneDurationSec =
        parseOptionalNumber(beat.sceneDurationSec) ??
        parseOptionalNumber(beat.narration?.sceneDurationSec);
      if (sceneDurationSec === undefined) continue;
      const narrationDurationSec =
        parseOptionalNumber(beat.narrationDurationSec) ??
        parseOptionalNumber(beat.narration?.durationSec);
      timings.push({
        id,
        start: cursor,
        end: Number((cursor + sceneDurationSec).toFixed(3)),
        sceneDurationSec,
        narrationDurationSec,
      });
      cursor = Number((cursor + sceneDurationSec).toFixed(3));
    }
    return timings;
  } catch {
    return [];
  }
}

async function buildRenderReviewProjectContext(projectDir: string): Promise<string> {
  const parts: string[] = [];
  const storyboard = await readTextIfExists(join(projectDir, "STORYBOARD.md"));
  if (storyboard) {
    parts.push(`STORYBOARD.md:\n${truncateText(storyboard, 4000)}`);
    parts.push(`Storyboard beat cue summary:\n${storyboardBeatCueSummary(storyboard)}`);
  }
  const design = await readTextIfExists(join(projectDir, "DESIGN.md"));
  if (design) parts.push(`DESIGN.md:\n${truncateText(design, 4000)}`);
  const buildReport = await readTextIfExists(join(projectDir, "build-report.json"));
  if (buildReport) parts.push(`build-report.json:\n${truncateText(buildReport, 6000)}`);
  const timings = await beatTimingsFromBuildReport(projectDir);
  if (timings.length > 0) {
    parts.push(`Beat timing summary:\n${JSON.stringify(timings, null, 2)}`);
  }
  return parts.join("\n\n");
}

function storyboardBeatCueSummary(storyboard: string): string {
  try {
    const parsed = parseStoryboard(storyboard);
    const beats = parsed.beats.map((beat) => ({
      id: beat.id,
      duration: beat.duration,
      narration: stringOrNull(beat.cues?.narration),
      backdrop: stringOrNull(beat.cues?.backdrop),
      video: stringOrNull(beat.cues?.video),
      motion: stringOrNull(beat.cues?.motion),
      music: stringOrNull(beat.cues?.music),
    }));
    return JSON.stringify(beats, null, 2);
  } catch {
    return "Storyboard could not be parsed.";
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 24)}\n...<truncated>`;
}

function normalizeTimeRange(value: unknown): ReviewIssue["timeRange"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const start = parseOptionalNumber(record.start);
  const end = parseOptionalNumber(record.end);
  if (start === undefined || end === undefined) return undefined;
  const duration = parseOptionalNumber(record.duration) ?? Number((end - start).toFixed(3));
  return { start, end, duration };
}

function beatForRange(range: TimeRange, beats: BeatTiming[]): BeatTiming | undefined {
  if (beats.length === 0) return undefined;
  const midpoint = range.start + range.duration / 2;
  return (
    beats.find((beat) => midpoint >= beat.start && midpoint <= beat.end) ??
    beats.find((beat) => range.start < beat.end && range.end > beat.start)
  );
}

function beatOverlapRatio(range: TimeRange, beat: BeatTiming): number {
  const overlapStart = Math.max(range.start, beat.start);
  const overlapEnd = Math.min(range.end, beat.end);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  if (beat.sceneDurationSec <= 0) return 0;
  return Number((overlap / beat.sceneDurationSec).toFixed(3));
}

function durationDriftRange(durationSec: number, expectedDurationSec: number): TimeRange {
  const start = Math.min(durationSec, expectedDurationSec);
  const end = Math.max(durationSec, expectedDurationSec);
  return {
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    duration: Number((end - start).toFixed(3)),
  };
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
  const output = await ffmpegNull(videoPath, [
    "-vf",
    `blackdetect=d=${BLACK_FRAME_MIN_DURATION_SEC}:pic_th=0.98`,
    "-an",
  ]);
  return parseBlackdetectOutput(output);
}

async function detectLongSilences(videoPath: string): Promise<TimeRange[]> {
  const output = await ffmpegNull(videoPath, [
    "-af",
    `silencedetect=noise=-35dB:d=${LONG_SILENCE_MIN_DURATION_SEC}`,
  ]);
  return parseSilencedetectOutput(output);
}

async function detectStaticFrames(videoPath: string): Promise<TimeRange[]> {
  const output = await ffmpegNull(videoPath, [
    "-vf",
    `freezedetect=n=-60dB:d=${STATIC_FRAME_MIN_DURATION_SEC}`,
    "-an",
  ]);
  return parseFreezedetectOutput(output);
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

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function resolveReportedPath(projectDir: string, value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return isAbsolute(value) ? value : resolve(projectDir, value);
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "beat";
}
