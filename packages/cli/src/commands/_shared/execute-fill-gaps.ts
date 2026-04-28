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
import { KlingProvider } from "@vibeframe/ai-providers";
import { Project, type ProjectFile } from "../../engine/index.js";
import { getApiKey } from "../../utils/api-key.js";
import { execSafe, ffprobeDuration } from "../../utils/exec-safe.js";
import { downloadVideo, formatTime } from "../ai-helpers.js";

export interface ExecuteFillGapsOptions {
  /** Project file path (resolved relative to cwd). */
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
  /** Override ImgBB API key (used to host frames for Kling input). */
  imgbbApiKey?: string;
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

async function uploadFrameToImgbb(
  framePath: string,
  imgbbApiKey: string,
): Promise<{ url?: string; error?: string }> {
  try {
    const frameBuffer = await readFile(framePath);
    const frameBase64 = frameBuffer.toString("base64");

    const formData = new FormData();
    formData.append("key", imgbbApiKey);
    formData.append("image", frameBase64);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData,
    });

    const data = (await response.json()) as {
      success: boolean;
      data?: { url: string };
      error?: { message: string };
    };
    if (!data.success || !data.data?.url) {
      return { error: data.error?.message || "Upload failed" };
    }
    return { url: data.data.url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── main entry point ────────────────────────────────────────────────────

export async function executeFillGaps(
  options: ExecuteFillGapsOptions,
): Promise<ExecuteFillGapsResult> {
  const onProgress = options.onProgress ?? (() => {});
  const humanLines: string[] = [];

  try {
    onProgress("Loading project...");
    const filePath = resolve(process.cwd(), options.projectPath);
    if (!existsSync(filePath)) {
      return {
        success: false,
        error: `Project file not found: ${filePath}`,
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

    const kling = new KlingProvider();
    await kling.initialize({ apiKey });

    if (!kling.isConfigured()) {
      return {
        success: false,
        error: "Invalid KLING_API_KEY (expected ACCESS_KEY:SECRET_KEY format)",
        humanLines,
      };
    }

    // Determine output directory for generated videos
    const projectDir = dirname(filePath);
    const footageDir = options.dir
      ? resolve(process.cwd(), options.dir)
      : resolve(projectDir, "footage");

    if (!existsSync(footageDir)) {
      await mkdir(footageDir, { recursive: true });
    }

    humanLines.push("Generating AI Videos");

    const imgbbApiKey =
      options.imgbbApiKey || (await getApiKey("IMGBB_API_KEY", "imgbb", undefined));
    if (!imgbbApiKey) {
      return {
        success: false,
        error:
          "IMGBB_API_KEY required for image hosting. Get a free API key at https://api.imgbb.com/",
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

      // Upload frame to imgbb
      onProgress("Uploading frame to imgbb...");
      const upload = await uploadFrameToImgbb(framePath, imgbbApiKey);
      if (!upload.url) {
        return {
          success: false,
          error: `Failed to upload frame to imgbb: ${upload.error || "unknown"}`,
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

      const result = await kling.generateVideo(prompt, {
        prompt,
        referenceImage: frameUrl,
        duration: parseInt(klingDuration) as 5 | 10,
        aspectRatio: options.ratio || "16:9",
        mode: options.mode || "std",
      });

      if (result.status === "failed") {
        humanLines.push(`  Failed to start generation: ${result.error}`);
        continue;
      }

      onProgress(`Generating video (task: ${result.id})...`);

      const finalResult = await kling.waitForCompletion(
        result.id,
        "image2video",
        (status) => onProgress(`Generating video... ${status.status}`),
        600000,
      );

      if (
        finalResult.status !== "completed" ||
        !finalResult.videoUrl ||
        !finalResult.videoId
      ) {
        humanLines.push(`  Generation failed: ${finalResult.error || "Unknown error"}`);
        continue;
      }

      // Download the generated video
      const videoFileName = `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}.mp4`;
      const videoPath = resolve(footageDir, videoFileName);

      onProgress("Downloading generated video...");
      const videoBuffer = await downloadVideo(finalResult.videoUrl);
      await writeFile(videoPath, videoBuffer);

      generatedDuration = finalResult.duration || parseInt(klingDuration);
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

        const extUpload = await uploadFrameToImgbb(lastFramePath, imgbbApiKey);
        if (!extUpload.url) {
          humanLines.push("  Failed to upload continuation frame");
          break;
        }

        const segResult = await kling.generateVideo(prompt, {
          prompt,
          referenceImage: extUpload.url,
          duration: parseInt(segmentDuration) as 5 | 10,
          aspectRatio: options.ratio || "16:9",
          mode: options.mode || "std",
        });

        if (segResult.status === "failed") {
          humanLines.push(`  Segment generation failed: ${segResult.error}`);
          break;
        }

        const segFinalResult = await kling.waitForCompletion(
          segResult.id,
          "image2video",
          (status) => onProgress(`Generating segment... ${status.status}`),
          600000,
        );

        if (segFinalResult.status !== "completed" || !segFinalResult.videoUrl) {
          humanLines.push(
            `  Segment generation failed: ${segFinalResult.error || "Unknown error"}`,
          );
          break;
        }

        const segVideoPath = resolve(
          footageDir,
          `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-seg${segmentIndex}.mp4`,
        );
        const segVideoBuffer = await downloadVideo(segFinalResult.videoUrl);
        await writeFile(segVideoPath, segVideoBuffer);

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
        generatedDuration += segFinalResult.duration || parseInt(segmentDuration);
        segmentIndex++;

        humanLines.push(`  Added segment, total: ${generatedDuration.toFixed(1)}s`);
      }

      // Add the generated video to the project
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
