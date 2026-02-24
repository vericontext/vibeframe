/**
 * @module ai-broll
 * @description B-Roll Matcher command. Matches B-roll footage to narration
 * content using Whisper transcription and Claude Vision analysis.
 *
 * ## Commands: vibe ai b-roll
 * ## Dependencies: Whisper, Claude
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerBrollCommand(aiCommand).
 * @see MODELS.md for AI model configuration
 */

import { type Command } from "commander";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import {
  WhisperProvider,
  ClaudeProvider,
  type BrollClipInfo,
  type BrollMatch,
  type BrollMatchResult,
} from "@vibeframe/ai-providers";
import { Project } from "../engine/index.js";
import { getApiKey } from "../utils/api-key.js";
import { formatTime } from "./ai-helpers.js";

const execAsync = promisify(exec);

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Check if a file path looks like an audio or video file
 */
function isAudioOrVideoFile(path: string): boolean {
  const mediaExtensions = [
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac",
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
  ];
  const ext = extname(path).toLowerCase();
  return mediaExtensions.includes(ext);
}

/**
 * Discover B-roll video files from paths or directory
 */
async function discoverBrollFiles(
  paths?: string,
  directory?: string
): Promise<string[]> {
  const files: string[] = [];
  const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];

  if (paths) {
    const pathList = paths.split(",").map((p) => resolve(process.cwd(), p.trim()));
    for (const path of pathList) {
      if (existsSync(path)) {
        files.push(path);
      }
    }
  }

  if (directory) {
    const dir = resolve(process.cwd(), directory);
    if (existsSync(dir)) {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const ext = extname(entry).toLowerCase();
        if (videoExtensions.includes(ext)) {
          files.push(resolve(dir, entry));
        }
      }
    }
  }

  return files;
}

/**
 * Extract a key frame from video as base64 JPEG
 */
async function extractKeyFrame(videoPath: string, timestamp: number): Promise<string> {
  const tempPath = `/tmp/vibe_frame_${Date.now()}.jpg`;
  await execAsync(
    `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${tempPath}" -y`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const buffer = await readFile(tempPath);
  await execAsync(`rm "${tempPath}"`).catch(() => {});
  return buffer.toString("base64");
}

// ── B-Roll Matcher command ──────────────────────────────────────────────────

export function registerBrollCommand(ai: Command): void {
  ai
    .command("b-roll")
    .description("Match B-roll footage to narration content")
    .argument("<narration>", "Narration audio file or script text")
    .option("-b, --broll <paths>", "B-roll video files (comma-separated)")
    .option("--broll-dir <dir>", "Directory containing B-roll files")
    .option("-o, --output <path>", "Output project file", "broll-matched.vibe.json")
    .option("-t, --threshold <value>", "Match confidence threshold (0-1)", "0.6")
    .option("-l, --language <lang>", "Language code for transcription (e.g., en, ko)")
    .option("-f, --file", "Treat narration as file path (script file)")
    .option("--analyze-only", "Only analyze, don't create project")
    .action(async (narration: string, options) => {
      try {
        // Validate B-roll input
        if (!options.broll && !options.brollDir) {
          console.error(chalk.red("B-roll files required. Use -b or --broll-dir"));
          process.exit(1);
        }

        // Check API keys
        const openaiApiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
        if (!openaiApiKey) {
          console.error(chalk.red("OpenAI API key required for Whisper transcription."));
          console.error(chalk.dim("Set OPENAI_API_KEY environment variable"));
          process.exit(1);
        }

        const claudeApiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic");
        if (!claudeApiKey) {
          console.error(chalk.red("Anthropic API key required for B-roll analysis."));
          console.error(chalk.dim("Set ANTHROPIC_API_KEY environment variable"));
          process.exit(1);
        }

        // Check FFmpeg availability
        try {
          execSync("ffmpeg -version", { stdio: "ignore" });
        } catch {
          console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("🎬 B-Roll Matcher Pipeline"));
        console.log(chalk.dim("─".repeat(60)));
        console.log();

        // Step 1: Discover B-roll files
        const discoverSpinner = ora("🎥 Discovering B-roll files...").start();
        const brollFiles = await discoverBrollFiles(options.broll, options.brollDir);

        if (brollFiles.length === 0) {
          discoverSpinner.fail(chalk.red("No B-roll video files found"));
          process.exit(1);
        }

        discoverSpinner.succeed(chalk.green(`Found ${brollFiles.length} B-roll file(s)`));

        // Step 2: Parse narration (audio file or script text)
        const narrationSpinner = ora("📝 Processing narration...").start();

        let narrationSegments: Array<{ startTime: number; endTime: number; text: string }> = [];
        let totalDuration = 0;
        let narrationFile = "";

        const isScriptFile = options.file;
        const isAudioFile = !isScriptFile && isAudioOrVideoFile(narration);

        if (isAudioFile) {
          // Transcribe audio with Whisper
          narrationFile = resolve(process.cwd(), narration);
          if (!existsSync(narrationFile)) {
            narrationSpinner.fail(chalk.red(`Narration file not found: ${narrationFile}`));
            process.exit(1);
          }

          narrationSpinner.text = "📝 Transcribing narration with Whisper...";

          const whisper = new WhisperProvider();
          await whisper.initialize({ apiKey: openaiApiKey });

          // Extract audio if it's a video file
          let audioPath = narrationFile;
          let tempAudioPath: string | null = null;

          const ext = extname(narrationFile).toLowerCase();
          const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
          if (videoExtensions.includes(ext)) {
            narrationSpinner.text = "📝 Extracting audio from video...";
            tempAudioPath = `/tmp/vibe_broll_audio_${Date.now()}.wav`;
            await execAsync(
              `ffmpeg -i "${narrationFile}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${tempAudioPath}" -y`,
              { maxBuffer: 50 * 1024 * 1024 }
            );
            audioPath = tempAudioPath;
          }

          const audioBuffer = await readFile(audioPath);
          const audioBlob = new Blob([audioBuffer]);

          narrationSpinner.text = "📝 Transcribing with Whisper...";
          const transcriptResult = await whisper.transcribe(audioBlob, options.language);

          // Cleanup temp file
          if (tempAudioPath && existsSync(tempAudioPath)) {
            await execAsync(`rm "${tempAudioPath}"`).catch(() => {});
          }

          if (transcriptResult.status === "failed" || !transcriptResult.segments) {
            narrationSpinner.fail(chalk.red(`Transcription failed: ${transcriptResult.error}`));
            process.exit(1);
          }

          narrationSegments = transcriptResult.segments.map((seg) => ({
            startTime: seg.startTime,
            endTime: seg.endTime,
            text: seg.text,
          }));

          totalDuration = transcriptResult.segments.length > 0
            ? transcriptResult.segments[transcriptResult.segments.length - 1].endTime
            : 0;
        } else {
          // Use script text (direct or from file)
          let scriptContent = narration;
          if (isScriptFile) {
            const scriptPath = resolve(process.cwd(), narration);
            if (!existsSync(scriptPath)) {
              narrationSpinner.fail(chalk.red(`Script file not found: ${scriptPath}`));
              process.exit(1);
            }
            scriptContent = await readFile(scriptPath, "utf-8");
            narrationFile = scriptPath;
          } else {
            narrationFile = "text-input";
          }

          // Split script into segments (by paragraph or sentence)
          const paragraphs = scriptContent
            .split(/\n\n+/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);

          // Estimate timing (rough: ~150 words per minute)
          let currentTime = 0;
          narrationSegments = paragraphs.map((text) => {
            const wordCount = text.split(/\s+/).length;
            const duration = Math.max((wordCount / 150) * 60, 3); // Min 3 seconds per segment
            const segment = {
              startTime: currentTime,
              endTime: currentTime + duration,
              text,
            };
            currentTime += duration;
            return segment;
          });

          totalDuration = currentTime;
        }

        narrationSpinner.succeed(chalk.green(`Processed ${narrationSegments.length} narration segments (${formatTime(totalDuration)} total)`));

        // Step 3: Analyze B-roll clips with Claude Vision
        const brollSpinner = ora("🎥 Analyzing B-roll content with Claude Vision...").start();

        const claude = new ClaudeProvider();
        await claude.initialize({ apiKey: claudeApiKey });

        const brollClips: BrollClipInfo[] = [];

        for (let i = 0; i < brollFiles.length; i++) {
          const filePath = brollFiles[i];
          const fileName = basename(filePath);
          brollSpinner.text = `🎥 Analyzing B-roll ${i + 1}/${brollFiles.length}: ${fileName}`;

          try {
            // Get video duration
            const { stdout: durationOut } = await execAsync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
            );
            const duration = parseFloat(durationOut.trim());

            // Extract a key frame (middle of video)
            const frameTime = Math.min(duration / 2, 5);
            const frameBase64 = await extractKeyFrame(filePath, frameTime);

            // Analyze with Claude Vision
            const analysis = await claude.analyzeBrollContent(frameBase64, fileName, "image/jpeg");

            brollClips.push({
              id: `broll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              filePath,
              duration,
              description: analysis.description,
              tags: analysis.tags,
            });
          } catch (error) {
            console.log(chalk.yellow(`\n  ⚠ Could not analyze ${fileName}: ${error}`));
          }
        }

        brollSpinner.succeed(chalk.green(`Analyzed ${brollClips.length} B-roll clips`));

        // Display analyzed B-roll
        for (const clip of brollClips) {
          console.log(chalk.dim(`  → ${basename(clip.filePath)}: "${clip.description}"`));
          console.log(chalk.dim(`    [${clip.tags.join(", ")}]`));
        }
        console.log();

        // Step 4: Analyze narration for visual requirements
        const visualSpinner = ora("🔍 Analyzing narration for visual needs...").start();

        const analyzedNarration = await claude.analyzeNarrationForVisuals(narrationSegments);

        visualSpinner.succeed(chalk.green("Narration analysis complete"));

        // Step 5: Match B-roll to narration
        const matchSpinner = ora("🔗 Matching B-roll to narration...").start();

        const matches = await claude.matchBrollToNarration(analyzedNarration, brollClips);

        const threshold = parseFloat(options.threshold);
        const filteredMatches = matches.filter((m) => m.confidence >= threshold);

        // Remove duplicate assignments (keep highest confidence for each segment)
        const uniqueMatches: BrollMatch[] = [];
        const matchedSegments = new Set<number>();

        // Sort by confidence descending
        filteredMatches.sort((a, b) => b.confidence - a.confidence);

        for (const match of filteredMatches) {
          if (!matchedSegments.has(match.narrationSegmentIndex)) {
            matchedSegments.add(match.narrationSegmentIndex);
            uniqueMatches.push(match);
          }
        }

        // Sort back by segment index
        uniqueMatches.sort((a, b) => a.narrationSegmentIndex - b.narrationSegmentIndex);

        const coverage = (uniqueMatches.length / narrationSegments.length) * 100;
        matchSpinner.succeed(chalk.green(`Found ${uniqueMatches.length} matches (${coverage.toFixed(0)}% coverage)`));

        // Find unmatched segments
        const unmatchedSegments: number[] = [];
        for (let i = 0; i < narrationSegments.length; i++) {
          if (!matchedSegments.has(i)) {
            unmatchedSegments.push(i);
          }
        }

        // Display match summary
        console.log();
        console.log(chalk.bold.cyan("📊 Match Summary"));
        console.log(chalk.dim("─".repeat(60)));

        for (const match of uniqueMatches) {
          const segment = analyzedNarration[match.narrationSegmentIndex];
          const clip = brollClips.find((c) => c.id === match.brollClipId);
          const startFormatted = formatTime(segment.startTime);
          const endFormatted = formatTime(segment.endTime);
          const confidencePercent = (match.confidence * 100).toFixed(0);

          console.log();
          console.log(`  ${chalk.yellow(`Segment ${match.narrationSegmentIndex + 1}`)} [${startFormatted} - ${endFormatted}]`);
          console.log(`    ${chalk.dim(truncate(segment.text, 60))}`);
          console.log(`    ${chalk.green("→")} ${basename(clip?.filePath || "unknown")} ${chalk.dim(`(${confidencePercent}%)`)}`);
          console.log(`    ${chalk.dim(match.reason)}`);
        }

        if (unmatchedSegments.length > 0) {
          console.log();
          console.log(chalk.yellow(`  ⚠ ${unmatchedSegments.length} unmatched segment(s): [${unmatchedSegments.map((i) => i + 1).join(", ")}]`));
        }

        console.log();
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Total: ${chalk.bold(uniqueMatches.length)}/${narrationSegments.length} segments matched, ${chalk.bold(coverage.toFixed(0))}% coverage`);
        console.log();

        // Prepare result object
        const result: BrollMatchResult = {
          narrationFile,
          totalDuration,
          brollClips,
          narrationSegments: analyzedNarration,
          matches: uniqueMatches,
          unmatchedSegments,
        };

        // Step 6: Create project (unless analyze-only)
        if (!options.analyzeOnly) {
          const projectSpinner = ora("📦 Creating project...").start();

          const project = new Project("B-Roll Matched Project");

          // Add B-roll sources
          const sourceMap = new Map<string, string>();
          for (const clip of brollClips) {
            const source = project.addSource({
              name: basename(clip.filePath),
              url: clip.filePath,
              type: "video",
              duration: clip.duration,
            });
            sourceMap.set(clip.id, source.id);
          }

          // Add narration audio source if it's an audio file
          let narrationSourceId: string | null = null;
          if (isAudioFile && narrationFile && existsSync(narrationFile)) {
            const narrationSource = project.addSource({
              name: basename(narrationFile),
              url: narrationFile,
              type: "audio",
              duration: totalDuration,
            });
            narrationSourceId = narrationSource.id;
          }

          // Get tracks
          const videoTrack = project.getTracks().find((t) => t.type === "video");
          const audioTrack = project.getTracks().find((t) => t.type === "audio");
          if (!videoTrack) {
            projectSpinner.fail(chalk.red("Failed to create project"));
            process.exit(1);
          }

          // Add narration audio clip to audio track
          if (narrationSourceId && audioTrack) {
            project.addClip({
              sourceId: narrationSourceId,
              trackId: audioTrack.id,
              startTime: 0,
              duration: totalDuration,
              sourceStartOffset: 0,
              sourceEndOffset: totalDuration,
            });
          }

          // Add clips for each match
          for (const match of uniqueMatches) {
            const segment = analyzedNarration[match.narrationSegmentIndex];
            const sourceId = sourceMap.get(match.brollClipId);
            const clip = brollClips.find((c) => c.id === match.brollClipId);

            if (!sourceId || !clip) continue;

            const clipDuration = Math.min(
              match.suggestedDuration || segment.endTime - segment.startTime,
              clip.duration - match.suggestedStartOffset
            );

            project.addClip({
              sourceId,
              trackId: videoTrack.id,
              startTime: segment.startTime,
              duration: clipDuration,
              sourceStartOffset: match.suggestedStartOffset,
              sourceEndOffset: match.suggestedStartOffset + clipDuration,
            });
          }

          const outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

          projectSpinner.succeed(chalk.green(`Created project: ${outputPath}`));

          // Save JSON result alongside project
          const jsonOutputPath = outputPath.replace(/\.vibe\.json$/, "-analysis.json");
          await writeFile(jsonOutputPath, JSON.stringify(result, null, 2), "utf-8");
          console.log(chalk.dim(`  → Analysis saved: ${jsonOutputPath}`));
        }

        console.log();
        console.log(chalk.bold.green("✅ B-Roll matching complete!"));
        console.log();
        console.log(chalk.dim("Next steps:"));
        if (!options.analyzeOnly) {
          console.log(chalk.dim(`  vibe project info ${options.output}`));
          console.log(chalk.dim(`  vibe export ${options.output} -o final.mp4`));
        }
        if (unmatchedSegments.length > 0) {
          console.log(chalk.dim("  Consider adding more B-roll clips for unmatched segments"));
        }
        console.log();
      } catch (error) {
        console.error(chalk.red("B-Roll matching failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
