/**
 * @module _shared/execute-fill-gaps
 * @description `executeFillGaps` — fill timeline gaps with AI-generated
 * video (Kling image-to-video). Extracted from the 562-line `.action()`
 * body in `commands/ai-fill-gaps.ts` in v0.69 Phase 4 finishing piece.
 *
 * The CLI handler in ai-fill-gaps.ts now just wires onProgress to an
 * ora spinner and prints humanLines on completion. The manifest entry
 * (`edit_fill_gaps`) calls this same function without onProgress and
 * returns humanLines as the result body — same logic, dual surface.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename as renameFs } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { waitForVideoJob, type VideoGenerator, type VideoRequest } from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../../engine/index.js";
import { getApiKey } from "../../utils/api-key.js";
import { resolveUploadHost, type UploadHost } from "../../utils/upload-host.js";
import { execSafe, ffprobeDuration } from "../../utils/exec-safe.js";
import { resolveTimelineFile } from "../../utils/project-resolver.js";
import { formatTime } from "../ai-helpers.js";
import { openVideoGenerator } from "./video-jobs.js";

export interface ExecuteFillGapsOptions {
  /** Timeline file or directory (resolved relative to cwd). */
  projectPath: string;
  /** Output project path. Defaults to overwriting the input. */
  output?: string;
  /** Directory for generated videos. Defaults to <projectDir>/footage. */
  dir?: string;
  /** Custom prompt for video generation. */
  prompt?: string;
  /** If true, only report gaps without generating. */
  dryRun?: boolean;
  /** Kling generation mode (std or pro). */
  mode?: "std" | "pro";
  /** Aspect ratio. */
  ratio?: "16:9" | "9:16" | "1:1";
  /** Override Kling API key. */
  apiKey?: string;
  /** Optional progress callback for streaming status updates. */
  onProgress?: (message: string) => void;
}

export interface FillGapsGapReport {
  start: number;
  end: number;
  duration: number;
  /** How much of the gap can be filled by extending the previous clip. */
  canExtendBefore: number;
  /** How much can be filled by extending the next clip. */
  canExtendAfter: number;
  /** Remaining duration that needs AI generation. */
  remainingGap: number;
}

export interface ExecuteFillGapsResult {
  success: boolean;
  /** Error message on failure. */
  error?: string;
  /** Human-readable status lines (CLI prints; manifest joins). */
  humanLines: string[];
  /** Per-gap analysis (always populated when success=true). */
  gaps?: FillGapsGapReport[];
  /** Gaps that need AI generation (subset of `gaps`). */
  gapsNeedingAI?: FillGapsGapReport[];
  /** Number of gaps actually filled (0 in dry-run / no-gaps cases). */
  generatedCount?: number;
  /** Final project path (input path or `options.output`). */
  outputPath?: string;
  /** True when no gaps were detected. */
  noGaps?: boolean;
  /** True when all gaps can be filled by extending adjacent clips. */
  allExtendable?: boolean;
  /** True when dry-run mode reported gaps without generating. */
  dryRun?: boolean;
}

// ─── private helpers (also used by ai-fill-gaps.ts directly) ──────────────

export function detectVideoGaps(
  videoClips: Array<{ startTime: number; duration: number }>,
  totalDuration: number,
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  if (sortedClips.length > 0 && sortedClips[0].startTime > 0.001) {
    gaps.push({ start: 0, end: sortedClips[0].startTime });
  }

  for (let i = 0; i < sortedClips.length - 1; i++) {
    const clipEnd = sortedClips[i].startTime + sortedClips[i].duration;
    const nextStart = sortedClips[i + 1].startTime;
    if (nextStart > clipEnd + 0.001) {
      gaps.push({ start: clipEnd, end: nextStart });
    }
  }

  if (sortedClips.length > 0) {
    const lastClip = sortedClips[sortedClips.length - 1];
    const lastClipEnd = lastClip.startTime + lastClip.duration;
    if (totalDuration > lastClipEnd + 0.001) {
      gaps.push({ start: lastClipEnd, end: totalDuration });
    }
  }

  return gaps;
}

export function analyzeGapFillability(
  gaps: Array<{ start: number; end: number }>,
  videoClips: Array<{
    startTime: number;
    duration: number;
    sourceId: string;
    sourceStartOffset: number;
    sourceEndOffset: number;
  }>,
  sources: Array<{ id: string; url: string; type: string; duration: number }>,
): Array<{
  gap: { start: number; end: number };
  canExtendBefore: number;
  canExtendAfter: number;
  remainingGap: number;
  gapStart: number;
}> {
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  return gaps.map((gap) => {
    const gapDuration = gap.end - gap.start;
    let canExtendBefore = 0;
    let canExtendAfter = 0;

    const clipBefore = sortedClips.find(
      (c) => Math.abs(c.startTime + c.duration - gap.start) < 0.01,
    );

    if (clipBefore) {
      const source = sources.find((s) => s.id === clipBefore.sourceId);
      if (source && source.type === "video") {
        const usedEndInSource = clipBefore.sourceEndOffset;
        canExtendBefore = Math.max(0, source.duration - usedEndInSource);
      }
    }

    const clipAfter = sortedClips.find(
      (c) => Math.abs(c.startTime - gap.end) < 0.01,
    );

    if (clipAfter) {
      const source = sources.find((s) => s.id === clipAfter.sourceId);
      if (source && source.type === "video") {
        canExtendAfter = Math.max(0, clipAfter.sourceStartOffset);
      }
    }

    const totalExtendable = canExtendBefore + canExtendAfter;
    const remainingGap = Math.max(0, gapDuration - totalExtendable);
    const gapStart = gap.start + Math.min(canExtendBefore, gapDuration);

    return { gap, canExtendBefore, canExtendAfter, remainingGap, gapStart };
  });
}

/** Upload an extracted frame through the configured host (ImgBB or S3). */
async function uploadFrame(
  host: UploadHost,
  framePath: string,
): Promise<{ url?: string; error?: string }> {
  try {
    const upload = await host.uploadImage(await readFile(framePath), {
      filename: framePath,
      mimeType: "image/png",
    });
    return { url: upload.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Submit one clip, wait for it, and download it; a failure comes back as `{error}`. */
async function generateClip(
  generator: VideoGenerator,
  request: VideoRequest,
  onProgress: (message: string) => void,
  label: string,
): Promise<{ bytes: Uint8Array; durationSec?: number } | { error: string }> {
  try {
    const job = await generator.submitVideo(request);
    onProgress(`${label} (task: ${job.id})...`);
    const state = await waitForVideoJob(generator, job, {
      timeoutMs: 600_000,
      onProgress: (s) => onProgress(`${label}... ${s.status}`),
    });
    if (state.status !== "completed") {
      return { error: `${state.error?.message ?? `generation ${state.status}`} (task ${job.id})` };
    }
    onProgress("Downloading generated video...");
    return { bytes: await generator.downloadVideo(job, state), durationSec: state.durationSec };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// ─── main entry point ────────────────────────────────────────────────────

export async function executeFillGaps(
  options: ExecuteFillGapsOptions,
): Promise<ExecuteFillGapsResult> {
  const onProgress = options.onProgress ?? (() => {});
  const humanLines: string[] = [];

  try {
    onProgress("Loading timeline...");
    const filePath = await resolveTimelineFile(options.projectPath);
    if (!existsSync(filePath)) {
      return {
        success: false,
        error: `Timeline file not found: ${filePath}`,
        humanLines,
      };
    }

    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
    const sources = project.getSources();

    const videoClips = clips
      .filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && (source.type === "video" || source.type === "image");
      })
      .sort((a, b) => a.startTime - b.startTime);

    if (videoClips.length === 0) {
      return {
        success: false,
        error: "Project has no video clips",
        humanLines,
      };
    }

    // Determine total duration (use audio track if available)
    const audioClips = clips.filter((clip) => {
      const source = sources.find((s) => s.id === clip.sourceId);
      return source && source.type === "audio";
    });

    const totalDuration =
      audioClips.length > 0
        ? Math.max(...audioClips.map((c) => c.startTime + c.duration))
        : Math.max(...videoClips.map((c) => c.startTime + c.duration));

    onProgress("Detecting gaps...");
    const gaps = detectVideoGaps(videoClips, totalDuration);

    if (gaps.length === 0) {
      humanLines.push("No gaps found in timeline");
      return {
        success: true,
        humanLines,
        gaps: [],
        gapsNeedingAI: [],
        generatedCount: 0,
        noGaps: true,
        outputPath: filePath,
      };
    }

    const gapAnalysis = analyzeGapFillability(gaps, videoClips, sources);

    const gapReports: FillGapsGapReport[] = gapAnalysis.map((a) => ({
      start: a.gap.start,
      end: a.gap.end,
      duration: a.gap.end - a.gap.start,
      canExtendBefore: a.canExtendBefore,
      canExtendAfter: a.canExtendAfter,
      remainingGap: a.remainingGap,
    }));

    humanLines.push(`Found ${gaps.length} gap(s)`);
    humanLines.push("");
    humanLines.push("Timeline Gaps");

    const gapsNeedingAIAnalysis: typeof gapAnalysis = [];

    for (const analysis of gapAnalysis) {
      const { gap, canExtendBefore, canExtendAfter, remainingGap } = analysis;
      const gapDuration = gap.end - gap.start;

      humanLines.push("");
      humanLines.push(
        `Gap: ${formatTime(gap.start)} - ${formatTime(gap.end)} (${gapDuration.toFixed(2)}s)`,
      );

      if (canExtendBefore > 0.01 || canExtendAfter > 0.01) {
        const extendable = canExtendBefore + canExtendAfter;
        humanLines.push(`  Can extend from adjacent clips: ${extendable.toFixed(2)}s`);
      }

      if (remainingGap > 0.01) {
        humanLines.push(`  Needs AI generation: ${remainingGap.toFixed(2)}s`);
        gapsNeedingAIAnalysis.push(analysis);
      } else {
        humanLines.push(`  ✓ Can be filled by extending clips`);
      }
    }
    humanLines.push("");

    const gapsNeedingAI: FillGapsGapReport[] = gapsNeedingAIAnalysis.map(
      (a) => ({
        start: a.gap.start,
        end: a.gap.end,
        duration: a.gap.end - a.gap.start,
        canExtendBefore: a.canExtendBefore,
        canExtendAfter: a.canExtendAfter,
        remainingGap: a.remainingGap,
      }),
    );

    if (gapsNeedingAI.length === 0) {
      humanLines.push("All gaps can be filled by extending adjacent clips.");
      humanLines.push("Run export with --gap-fill extend to apply.");
      return {
        success: true,
        humanLines,
        gaps: gapReports,
        gapsNeedingAI: [],
        generatedCount: 0,
        allExtendable: true,
        outputPath: filePath,
      };
    }

    if (options.dryRun) {
      humanLines.push("Dry run - no videos generated");
      humanLines.push("");
      humanLines.push(`${gapsNeedingAI.length} gap(s) need AI video generation:`);
      for (const g of gapsNeedingAI) {
        humanLines.push(
          `  - ${formatTime(g.start)} - ${formatTime(g.end)} (${g.remainingGap.toFixed(2)}s)`,
        );
      }
      return {
        success: true,
        humanLines,
        gaps: gapReports,
        gapsNeedingAI,
        generatedCount: 0,
        dryRun: true,
        outputPath: filePath,
      };
    }

    // Get Kling API key
    const apiKey = options.apiKey || (await getApiKey("KLING_API_KEY", "Kling", undefined));
    if (!apiKey) {
      return {
        success: false,
        error: "KLING_API_KEY required for AI video generation",
        humanLines,
      };
    }

    const kling = await openVideoGenerator("kling", apiKey);

    // Determine output directory for generated videos
    const projectDir = dirname(filePath);
    const footageDir = options.dir
      ? resolve(process.cwd(), options.dir)
      : resolve(projectDir, "footage");

    if (!existsSync(footageDir)) {
      await mkdir(footageDir, { recursive: true });
    }

    humanLines.push("Generating AI Videos");

    // Kling takes frames by URL; the configured upload host (ImgBB by
    // default, S3 when VIBE_UPLOAD_PROVIDER=s3) turns them into one.
    let uploadHost: UploadHost;
    try {
      uploadHost = await resolveUploadHost();
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        humanLines,
      };
    }

    let generatedCount = 0;

    for (const analysis of gapsNeedingAIAnalysis) {
      const { gap, remainingGap, gapStart } = analysis;

      humanLines.push("");
      humanLines.push(`Processing gap: ${formatTime(gap.start)} - ${formatTime(gap.end)}`);

      // Find the clip before this gap to extract a frame
      const clipBefore = videoClips.find(
        (c) => Math.abs(c.startTime + c.duration - gap.start) < 0.1,
      );

      if (!clipBefore) {
        humanLines.push("  No preceding clip found, skipping");
        continue;
      }

      const sourceBefore = sources.find((s) => s.id === clipBefore.sourceId);
      if (!sourceBefore || sourceBefore.type !== "video") {
        humanLines.push("  Preceding clip is not a video, skipping");
        continue;
      }

      // Extract last frame from preceding clip
      onProgress("Extracting frame from preceding clip...");
      const frameOffset = clipBefore.sourceStartOffset + clipBefore.duration - 0.1;
      const framePath = resolve(footageDir, `frame-${gap.start.toFixed(2)}.png`);

      try {
        await execSafe("ffmpeg", [
          "-i", sourceBefore.url, "-ss", String(frameOffset),
          "-vframes", "1", "-f", "image2", "-y", framePath,
        ]);
      } catch (err) {
        return {
          success: false,
          error: `Failed to extract frame: ${err instanceof Error ? err.message : String(err)}`,
          humanLines,
        };
      }

      onProgress(`Uploading frame via ${uploadHost.provider}...`);
      const upload = await uploadFrame(uploadHost, framePath);
      if (!upload.url) {
        return {
          success: false,
          error: `Failed to upload frame via ${uploadHost.provider}: ${upload.error || "unknown"}`,
          humanLines,
        };
      }
      const frameUrl = upload.url;

      const targetDuration = remainingGap;
      let generatedDuration = 0;
      const generatedVideos: string[] = [];

      const initialDuration = Math.min(10, targetDuration);
      const klingDuration = initialDuration > 5 ? "10" : "5";

      onProgress(`Generating ${klingDuration}s video with Kling...`);

      const prompt = options.prompt || "Continue the scene naturally with subtle motion";

      const clipRequest = (image: string, durationSec: number): VideoRequest => ({
        prompt,
        image,
        durationSec,
        aspectRatio: (options.ratio || "16:9") as VideoRequest["aspectRatio"],
        providerOptions: { mode: options.mode || "std" },
      });

      const first = await generateClip(kling, clipRequest(frameUrl, parseInt(klingDuration)), onProgress, "Generating video");
      if ("error" in first) {
        humanLines.push(`  Generation failed: ${first.error}`);
        continue;
      }

      const videoFileName = `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}.mp4`;
      const videoPath = resolve(footageDir, videoFileName);
      await writeFile(videoPath, first.bytes);

      generatedDuration = first.durationSec || parseInt(klingDuration);
      generatedVideos.push(videoPath);

      humanLines.push(`  Generated: ${videoFileName} (${generatedDuration}s)`);

      // If we need more duration, generate additional segments
      let segmentIndex = 1;
      while (generatedDuration < targetDuration - 1) {
        const remainingNeeded = targetDuration - generatedDuration;
        const segmentDuration = remainingNeeded > 5 ? "10" : "5";

        onProgress(`Generating additional ${segmentDuration}s segment...`);

        const lastFramePath = resolve(
          footageDir,
          `frame-extend-${gap.start.toFixed(2)}-${segmentIndex}.png`,
        );
        try {
          let videoDur: number;
          try {
            videoDur = await ffprobeDuration(videoPath);
          } catch {
            videoDur = generatedDuration;
          }
          const lastFrameTime = Math.max(0, videoDur - 0.1);

          await execSafe("ffmpeg", [
            "-i", videoPath, "-ss", String(lastFrameTime),
            "-vframes", "1", "-f", "image2", "-y", lastFramePath,
          ]);
        } catch {
          humanLines.push("  Failed to extract frame for continuation");
          break;
        }

        const extUpload = await uploadFrame(uploadHost, lastFramePath);
        if (!extUpload.url) {
          humanLines.push("  Failed to upload continuation frame");
          break;
        }

        const segment = await generateClip(
          kling,
          clipRequest(extUpload.url, parseInt(segmentDuration)),
          onProgress,
          "Generating segment",
        );
        if ("error" in segment) {
          humanLines.push(`  Segment generation failed: ${segment.error}`);
          break;
        }

        const segVideoPath = resolve(
          footageDir,
          `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-seg${segmentIndex}.mp4`,
        );
        await writeFile(segVideoPath, segment.bytes);

        const concatListPath = resolve(footageDir, `concat-${gap.start.toFixed(2)}.txt`);
        const concatList =
          generatedVideos.map((v) => `file '${v}'`).join("\n") +
          `\nfile '${segVideoPath}'`;
        await writeFile(concatListPath, concatList);

        const concatOutputPath = resolve(
          footageDir,
          `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-merged.mp4`,
        );
        try {
          await execSafe("ffmpeg", [
            "-f", "concat", "-safe", "0", "-i", concatListPath,
            "-c", "copy", "-y", concatOutputPath,
          ]);
          await renameFs(concatOutputPath, videoPath);
        } catch {
          humanLines.push("  Failed to concatenate videos");
          break;
        }

        generatedVideos.push(segVideoPath);
        generatedDuration += segment.durationSec || parseInt(segmentDuration);
        segmentIndex++;

        humanLines.push(`  Added segment, total: ${generatedDuration.toFixed(1)}s`);
      }

      // Add the generated video to the timeline
      const actualGapStart = gapStart;
      const actualGapDuration = Math.min(remainingGap, generatedDuration);

      let videoDuration = generatedDuration;
      try {
        videoDuration = await ffprobeDuration(videoPath);
      } catch {
        // Use estimated duration
      }

      const newSource = project.addSource({
        name: videoFileName,
        type: "video",
        url: videoPath,
        duration: videoDuration,
      });

      project.addClip({
        sourceId: newSource.id,
        trackId: videoClips[0].trackId,
        startTime: actualGapStart,
        duration: actualGapDuration,
        sourceStartOffset: 0,
        sourceEndOffset: actualGapDuration,
      });

      generatedCount++;
      humanLines.push(
        `  Added to timeline: ${formatTime(actualGapStart)} - ${formatTime(actualGapStart + actualGapDuration)}`,
      );
    }

    humanLines.push("");

    let outputPath: string = filePath;
    if (generatedCount > 0) {
      outputPath = options.output ? resolve(process.cwd(), options.output) : filePath;
      await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2));
      humanLines.push(`✔ Filled ${generatedCount} gap(s) with AI-generated video`);
      humanLines.push(`Project saved: ${outputPath}`);
    } else {
      humanLines.push("No gaps were filled");
    }

    return {
      success: true,
      humanLines,
      gaps: gapReports,
      gapsNeedingAI,
      generatedCount,
      outputPath,
    };
  } catch (error) {
    return {
      success: false,
      error: `Fill gaps failed: ${error instanceof Error ? error.message : String(error)}`,
      humanLines,
    };
  }
}
