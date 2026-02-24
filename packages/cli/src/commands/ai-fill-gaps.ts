/**
 * ai-fill-gaps.ts — Fill timeline gaps with AI-generated video (Kling image-to-video).
 *
 * Commands: fill-gaps
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerFillGapsCommand(aiCommand).
 */

import { type Command } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import { KlingProvider } from '@vibeframe/ai-providers';
import { Project, type ProjectFile } from '../engine/index.js';
import { getApiKey } from '../utils/api-key.js';
import { formatTime } from './ai-helpers.js';

const execAsync = promisify(exec);


// ── Helper functions (module-private) ────────────────────────────────────────

/**
 * Detect gaps in video timeline
 */
function detectVideoGaps(
  videoClips: Array<{ startTime: number; duration: number }>,
  totalDuration: number
): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  // Check for gap at the start
  if (sortedClips.length > 0 && sortedClips[0].startTime > 0.001) {
    gaps.push({ start: 0, end: sortedClips[0].startTime });
  }

  // Check for gaps between clips
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const clipEnd = sortedClips[i].startTime + sortedClips[i].duration;
    const nextStart = sortedClips[i + 1].startTime;
    if (nextStart > clipEnd + 0.001) {
      gaps.push({ start: clipEnd, end: nextStart });
    }
  }

  // Check for gap at the end
  if (sortedClips.length > 0) {
    const lastClip = sortedClips[sortedClips.length - 1];
    const lastClipEnd = lastClip.startTime + lastClip.duration;
    if (totalDuration > lastClipEnd + 0.001) {
      gaps.push({ start: lastClipEnd, end: totalDuration });
    }
  }

  return gaps;
}

/**
 * Analyze whether gaps can be filled by extending adjacent clips
 */
function analyzeGapFillability(
  gaps: Array<{ start: number; end: number }>,
  videoClips: Array<{ startTime: number; duration: number; sourceId: string; sourceStartOffset: number; sourceEndOffset: number }>,
  sources: Array<{ id: string; url: string; type: string; duration: number }>
): Array<{
  gap: { start: number; end: number };
  canExtendBefore: number;
  canExtendAfter: number;
  remainingGap: number;
  gapStart: number; // Where the unfillable gap starts
}> {
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  return gaps.map((gap) => {
    const gapDuration = gap.end - gap.start;
    let canExtendBefore = 0;
    let canExtendAfter = 0;

    // Find clip BEFORE the gap (for extending forwards)
    const clipBefore = sortedClips.find((c) =>
      Math.abs(c.startTime + c.duration - gap.start) < 0.01
    );

    if (clipBefore) {
      const source = sources.find((s) => s.id === clipBefore.sourceId);
      if (source && source.type === "video") {
        const usedEndInSource = clipBefore.sourceEndOffset;
        canExtendBefore = Math.max(0, source.duration - usedEndInSource);
      }
    }

    // Find clip AFTER the gap (for extending backwards)
    const clipAfter = sortedClips.find((c) =>
      Math.abs(c.startTime - gap.end) < 0.01
    );

    if (clipAfter) {
      const source = sources.find((s) => s.id === clipAfter.sourceId);
      if (source && source.type === "video") {
        canExtendAfter = Math.max(0, clipAfter.sourceStartOffset);
      }
    }

    const totalExtendable = canExtendBefore + canExtendAfter;
    const remainingGap = Math.max(0, gapDuration - totalExtendable);

    // Calculate where the unfillable gap starts
    // (after we extend the clip before as much as possible)
    const gapStart = gap.start + Math.min(canExtendBefore, gapDuration);

    return {
      gap,
      canExtendBefore,
      canExtendAfter,
      remainingGap,
      gapStart,
    };
  });
}


// ── Command registration ─────────────────────────────────────────────────────

export function registerFillGapsCommand(aiCommand: Command): void {
// Fill Gaps command - AI video generation to fill timeline gaps
aiCommand
  .command("fill-gaps")
  .description("Fill timeline gaps with AI-generated video (Kling image-to-video)")
  .argument("<project>", "Project file path")
  .option("-p, --provider <provider>", "AI provider (kling)", "kling")
  .option("-o, --output <path>", "Output project path (default: overwrite)")
  .option("-d, --dir <path>", "Directory to save generated videos")
  .option("--prompt <text>", "Custom prompt for video generation")
  .option("--dry-run", "Show gaps without generating")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling)", "std")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .action(async (projectPath: string, options) => {
    try {
      const spinner = ora("Loading project...").start();

      // Load project
      const filePath = resolve(process.cwd(), projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
      const sources = project.getSources();

      // Get video clips only
      const videoClips = clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && (source.type === "video" || source.type === "image");
      }).sort((a, b) => a.startTime - b.startTime);

      if (videoClips.length === 0) {
        spinner.fail(chalk.red("Project has no video clips"));
        process.exit(1);
      }

      // Determine total duration (use audio track if available)
      const audioClips = clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && source.type === "audio";
      });

      let totalDuration: number;
      if (audioClips.length > 0) {
        totalDuration = Math.max(...audioClips.map((c) => c.startTime + c.duration));
      } else {
        totalDuration = Math.max(...videoClips.map((c) => c.startTime + c.duration));
      }

      // Detect gaps
      spinner.text = "Detecting gaps...";
      const gaps = detectVideoGaps(videoClips, totalDuration);

      if (gaps.length === 0) {
        spinner.succeed(chalk.green("No gaps found in timeline"));
        process.exit(0);
      }

      // Analyze which gaps can be filled by extending adjacent clips
      const gapAnalysis = analyzeGapFillability(gaps, videoClips, sources);

      spinner.succeed(chalk.green(`Found ${gaps.length} gap(s)`));

      console.log();
      console.log(chalk.bold.cyan("Timeline Gaps"));
      console.log(chalk.dim("─".repeat(60)));

      const gapsNeedingAI: typeof gapAnalysis = [];

      for (const analysis of gapAnalysis) {
        const { gap, canExtendBefore, canExtendAfter, remainingGap } = analysis;
        const gapDuration = gap.end - gap.start;

        console.log();
        console.log(chalk.yellow(`Gap: ${formatTime(gap.start)} - ${formatTime(gap.end)} (${gapDuration.toFixed(2)}s)`));

        if (canExtendBefore > 0.01 || canExtendAfter > 0.01) {
          const extendable = canExtendBefore + canExtendAfter;
          console.log(chalk.dim(`  Can extend from adjacent clips: ${extendable.toFixed(2)}s`));
        }

        if (remainingGap > 0.01) {
          console.log(chalk.red(`  Needs AI generation: ${remainingGap.toFixed(2)}s`));
          gapsNeedingAI.push(analysis);
        } else {
          console.log(chalk.green(`  ✓ Can be filled by extending clips`));
        }
      }

      console.log();

      if (gapsNeedingAI.length === 0) {
        console.log(chalk.green("All gaps can be filled by extending adjacent clips."));
        console.log(chalk.dim("Run export with --gap-fill extend to apply."));
        process.exit(0);
      }

      if (options.dryRun) {
        console.log(chalk.dim("Dry run - no videos generated"));
        console.log();
        console.log(chalk.bold(`${gapsNeedingAI.length} gap(s) need AI video generation:`));
        for (const analysis of gapsNeedingAI) {
          console.log(`  - ${formatTime(analysis.gap.start)} - ${formatTime(analysis.gap.end)} (${analysis.remainingGap.toFixed(2)}s)`);
        }
        process.exit(0);
      }

      // Get Kling API key
      const apiKey = await getApiKey("KLING_API_KEY", "Kling", undefined);
      if (!apiKey) {
        console.error(chalk.red("Kling API key required for AI video generation."));
        console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        console.error(chalk.dim("Set KLING_API_KEY environment variable"));
        process.exit(1);
      }

      const kling = new KlingProvider();
      await kling.initialize({ apiKey });

      if (!kling.isConfigured()) {
        console.error(chalk.red("Invalid Kling API key format. Use ACCESS_KEY:SECRET_KEY"));
        process.exit(1);
      }

      // Determine output directory for generated videos
      const projectDir = dirname(filePath);
      const footageDir = options.dir
        ? resolve(process.cwd(), options.dir)
        : resolve(projectDir, "footage");

      // Create footage directory if needed
      if (!existsSync(footageDir)) {
        await mkdir(footageDir, { recursive: true });
      }

      console.log(chalk.bold.cyan("Generating AI Videos"));
      console.log(chalk.dim("─".repeat(60)));

      let generatedCount = 0;

      for (const analysis of gapsNeedingAI) {
        const { gap, remainingGap, gapStart } = analysis;

        console.log();
        console.log(chalk.yellow(`Processing gap: ${formatTime(gap.start)} - ${formatTime(gap.end)}`));

        // Find the clip before this gap to extract a frame
        const clipBefore = videoClips.find((c) =>
          Math.abs(c.startTime + c.duration - gap.start) < 0.1
        );

        if (!clipBefore) {
          console.log(chalk.red(`  No preceding clip found, skipping`));
          continue;
        }

        const sourceBefore = sources.find((s) => s.id === clipBefore.sourceId);
        if (!sourceBefore || sourceBefore.type !== "video") {
          console.log(chalk.red(`  Preceding clip is not a video, skipping`));
          continue;
        }

        // Extract last frame from preceding clip
        spinner.start("Extracting frame from preceding clip...");
        const frameOffset = clipBefore.sourceStartOffset + clipBefore.duration - 0.1; // 100ms before end
        const framePath = resolve(footageDir, `frame-${gap.start.toFixed(2)}.png`);

        try {
          await execAsync(
            `ffmpeg -i "${sourceBefore.url}" -ss ${frameOffset} -vframes 1 -f image2 -y "${framePath}"`
          );
        } catch (err) {
          spinner.fail(chalk.red("Failed to extract frame"));
          console.error(err);
          continue;
        }
        spinner.succeed("Frame extracted");

        // Upload frame to imgbb to get URL (Kling v2.5/v2.6 requires URL, not base64)
        spinner.start("Uploading frame to imgbb...");
        const imgbbApiKey = await getApiKey("IMGBB_API_KEY", "imgbb", undefined);
        if (!imgbbApiKey) {
          spinner.fail(chalk.red("IMGBB_API_KEY required for image hosting"));
          console.error(chalk.dim("Get a free API key at https://api.imgbb.com/"));
          continue;
        }

        const frameBuffer = await readFile(framePath);
        const frameBase64 = frameBuffer.toString("base64");

        let frameUrl: string;
        try {
          const formData = new FormData();
          formData.append("key", imgbbApiKey);
          formData.append("image", frameBase64);

          const imgbbResponse = await fetch("https://api.imgbb.com/1/upload", {
            method: "POST",
            body: formData,
          });

          const imgbbData = await imgbbResponse.json() as { success: boolean; data?: { url: string }; error?: { message: string } };
          if (!imgbbData.success || !imgbbData.data?.url) {
            throw new Error(imgbbData.error?.message || "Upload failed");
          }
          frameUrl = imgbbData.data.url;
        } catch (err) {
          spinner.fail(chalk.red("Failed to upload frame to imgbb"));
          console.error(err);
          continue;
        }
        spinner.succeed(`Frame uploaded: ${frameUrl}`);

        // Calculate how many seconds to generate
        // Kling can generate 5 or 10 second videos
        // For longer gaps, we may need multiple generations or video-extend
        const targetDuration = remainingGap;
        let generatedDuration = 0;
        const generatedVideos: string[] = [];

        // Generate initial video (up to 10 seconds)
        const initialDuration = Math.min(10, targetDuration);
        const klingDuration = initialDuration > 5 ? "10" : "5";

        spinner.start(`Generating ${klingDuration}s video with Kling...`);

        const prompt = options.prompt || "Continue the scene naturally with subtle motion";

        const result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage: frameUrl,
          duration: parseInt(klingDuration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(`Failed to start generation: ${result.error}`));
          continue;
        }

        spinner.text = `Generating video (task: ${result.id})...`;

        const finalResult = await kling.waitForCompletion(
          result.id,
          "image2video",
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000
        );

        if (finalResult.status !== "completed" || !finalResult.videoUrl || !finalResult.videoId) {
          spinner.fail(chalk.red(`Generation failed: ${finalResult.error || "Unknown error"}`));
          continue;
        }

        // Download the generated video
        const videoFileName = `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}.mp4`;
        const videoPath = resolve(footageDir, videoFileName);

        spinner.text = "Downloading generated video...";
        let currentVideoUrl = finalResult.videoUrl;
        const response = await fetch(currentVideoUrl);
        const videoBuffer = Buffer.from(await response.arrayBuffer());
        await writeFile(videoPath, videoBuffer);

        generatedDuration = finalResult.duration || parseInt(klingDuration);
        generatedVideos.push(videoPath);
        let currentVideoId = finalResult.videoId;

        spinner.succeed(chalk.green(`Generated: ${videoFileName} (${generatedDuration}s)`));

        // If we need more duration, generate additional videos using image-to-video
        // (video-extend often fails, so we use a more reliable approach)
        let segmentIndex = 1;
        while (generatedDuration < targetDuration - 1) {
          const remainingNeeded = targetDuration - generatedDuration;
          const segmentDuration = remainingNeeded > 5 ? "10" : "5";

          spinner.start(`Generating additional ${segmentDuration}s segment...`);

          // Extract last frame from current video
          const lastFramePath = resolve(footageDir, `frame-extend-${gap.start.toFixed(2)}-${segmentIndex}.png`);
          try {
            // Get video duration first
            const { stdout: durationOut } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
            );
            const videoDur = parseFloat(durationOut.trim()) || generatedDuration;
            const lastFrameTime = Math.max(0, videoDur - 0.1);

            await execAsync(
              `ffmpeg -i "${videoPath}" -ss ${lastFrameTime} -vframes 1 -f image2 -y "${lastFramePath}"`
            );
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to extract frame for continuation"));
            break;
          }

          // Upload to imgbb
          const extFrameBuffer = await readFile(lastFramePath);
          const extFrameBase64 = extFrameBuffer.toString("base64");

          let extFrameUrl: string;
          try {
            const formData = new FormData();
            formData.append("key", imgbbApiKey);
            formData.append("image", extFrameBase64);

            const imgbbResp = await fetch("https://api.imgbb.com/1/upload", {
              method: "POST",
              body: formData,
            });

            const imgbbData = await imgbbResp.json() as { success: boolean; data?: { url: string }; error?: { message: string } };
            if (!imgbbData.success || !imgbbData.data?.url) {
              throw new Error(imgbbData.error?.message || "Upload failed");
            }
            extFrameUrl = imgbbData.data.url;
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to upload continuation frame"));
            break;
          }

          // Generate next segment
          const segResult = await kling.generateVideo(prompt, {
            prompt,
            referenceImage: extFrameUrl,
            duration: parseInt(segmentDuration) as 5 | 10,
            aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
            mode: options.mode as "std" | "pro",
          });

          if (segResult.status === "failed") {
            spinner.fail(chalk.yellow(`Segment generation failed: ${segResult.error}`));
            break;
          }

          const segFinalResult = await kling.waitForCompletion(
            segResult.id,
            "image2video",
            (status) => {
              spinner.text = `Generating segment... ${status.status}`;
            },
            600000
          );

          if (segFinalResult.status !== "completed" || !segFinalResult.videoUrl) {
            spinner.fail(chalk.yellow(`Segment generation failed: ${segFinalResult.error || "Unknown error"}`));
            break;
          }

          // Download new segment
          const segVideoPath = resolve(footageDir, `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-seg${segmentIndex}.mp4`);
          const segResponse = await fetch(segFinalResult.videoUrl);
          const segVideoBuffer = Buffer.from(await segResponse.arrayBuffer());
          await writeFile(segVideoPath, segVideoBuffer);

          // Concatenate videos
          const concatListPath = resolve(footageDir, `concat-${gap.start.toFixed(2)}.txt`);
          const concatList = generatedVideos.map(v => `file '${v}'`).join("\n") + `\nfile '${segVideoPath}'`;
          await writeFile(concatListPath, concatList);

          const concatOutputPath = resolve(footageDir, `gap-fill-${gap.start.toFixed(2)}-${gap.end.toFixed(2)}-merged.mp4`);
          try {
            await execAsync(
              `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${concatOutputPath}"`
            );
            // Replace main video with concatenated version
            await execAsync(`mv "${concatOutputPath}" "${videoPath}"`);
          } catch (err) {
            spinner.fail(chalk.yellow("Failed to concatenate videos"));
            break;
          }

          generatedVideos.push(segVideoPath);
          generatedDuration += segFinalResult.duration || parseInt(segmentDuration);
          segmentIndex++;

          spinner.succeed(chalk.green(`Added segment, total: ${generatedDuration.toFixed(1)}s`));
        }

        // Add the generated video to the project
        const actualGapStart = gapStart;
        const actualGapDuration = Math.min(remainingGap, generatedDuration);

        // Get video info for source
        let videoDuration = generatedDuration;
        try {
          const { stdout } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
          );
          videoDuration = parseFloat(stdout.trim()) || generatedDuration;
        } catch {
          // Use estimated duration
        }

        // Add source
        const newSource = project.addSource({
          name: videoFileName,
          type: "video",
          url: videoPath,
          duration: videoDuration,
        });

        // Add clip
        project.addClip({
          sourceId: newSource.id,
          trackId: videoClips[0].trackId,
          startTime: actualGapStart,
          duration: actualGapDuration,
          sourceStartOffset: 0,
          sourceEndOffset: actualGapDuration,
        });

        generatedCount++;
        console.log(chalk.green(`  Added to timeline: ${formatTime(actualGapStart)} - ${formatTime(actualGapStart + actualGapDuration)}`));
      }

      console.log();

      if (generatedCount > 0) {
        // Save project
        const outputPath = options.output
          ? resolve(process.cwd(), options.output)
          : filePath;

        await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2));

        console.log(chalk.bold.green(`✔ Filled ${generatedCount} gap(s) with AI-generated video`));
        console.log(chalk.dim(`Project saved: ${outputPath}`));
      } else {
        console.log(chalk.yellow("No gaps were filled"));
      }

      console.log();
    } catch (error) {
      console.error(chalk.red("Fill gaps failed"));
      console.error(error);
      process.exit(1);
    }
  });
}
