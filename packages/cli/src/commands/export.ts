import { Command } from "commander";
import { readFile, access, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";

const execAsync = promisify(exec);

/**
 * Resolve project file path - handles both file paths and directory paths
 * If path is a directory, looks for project.vibe.json inside
 */
async function resolveProjectPath(inputPath: string): Promise<string> {
  const filePath = resolve(process.cwd(), inputPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist or other error - let readFile handle it
  }

  return filePath;
}

/**
 * Get the duration of a media file using ffprobe
 * For images, returns a default duration since they have no inherent time
 */
export async function getMediaDuration(
  filePath: string,
  mediaType: "video" | "audio" | "image",
  defaultImageDuration: number = 5
): Promise<number> {
  if (mediaType === "image") {
    return defaultImageDuration;
  }

  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? defaultImageDuration : duration;
  } catch {
    return defaultImageDuration;
  }
}

/**
 * Export result for programmatic usage
 */
export interface ExportResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

/**
 * Export options
 */
export interface ExportOptions {
  preset?: "draft" | "standard" | "high" | "ultra";
  format?: "mp4" | "webm" | "mov";
  overwrite?: boolean;
}

/**
 * Reusable export function for programmatic usage
 */
export async function runExport(
  projectPath: string,
  outputPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const { preset = "standard", format = "mp4", overwrite = false } = options;

  try {
    // Check if FFmpeg is installed
    const ffmpegPath = await findFFmpeg();
    if (!ffmpegPath) {
      return {
        success: false,
        message: "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
      };
    }

    // Load project
    const filePath = await resolveProjectPath(projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const summary = project.getSummary();

    if (summary.clipCount === 0) {
      return {
        success: false,
        message: "Project has no clips to export",
      };
    }

    // Determine output path
    const finalOutputPath = resolve(process.cwd(), outputPath);

    // Get preset settings
    const presetSettings = getPresetSettings(preset, summary.aspectRatio);

    // Get clips sorted by start time
    const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
    const sources = project.getSources();

    // Verify source files exist
    for (const clip of clips) {
      const source = sources.find((s) => s.id === clip.sourceId);
      if (source) {
        try {
          await access(source.url);
        } catch {
          return {
            success: false,
            message: `Source file not found: ${source.url}`,
          };
        }
      }
    }

    // Build FFmpeg command
    const ffmpegArgs = buildFFmpegArgs(clips, sources, presetSettings, finalOutputPath, { overwrite, format });

    // Run FFmpeg
    await runFFmpegProcess(ffmpegPath, ffmpegArgs, () => {});

    return {
      success: true,
      message: `Exported: ${outputPath}`,
      outputPath: finalOutputPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Export failed: ${errorMessage}`,
    };
  }
}

export const exportCommand = new Command("export")
  .description("Export project to video file")
  .argument("<project>", "Project file path")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format (mp4, webm, mov)", "mp4")
  .option(
    "-p, --preset <preset>",
    "Quality preset (draft, standard, high, ultra)",
    "standard"
  )
  .option("-y, --overwrite", "Overwrite output file if exists", false)
  .action(async (projectPath: string, options) => {
    const spinner = ora("Checking FFmpeg...").start();

    try {
      // Check if FFmpeg is installed
      const ffmpegPath = await findFFmpeg();
      if (!ffmpegPath) {
        spinner.fail(chalk.red("FFmpeg not found"));
        console.error();
        console.error(chalk.yellow("Please install FFmpeg:"));
        console.error(chalk.dim("  macOS:   brew install ffmpeg"));
        console.error(chalk.dim("  Ubuntu:  sudo apt install ffmpeg"));
        console.error(chalk.dim("  Windows: winget install ffmpeg"));
        process.exit(1);
      }

      // Load project
      spinner.text = "Loading project...";
      const filePath = await resolveProjectPath(projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const summary = project.getSummary();

      if (summary.clipCount === 0) {
        spinner.fail(chalk.red("Project has no clips to export"));
        process.exit(1);
      }

      // Determine output path
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : resolve(
            process.cwd(),
            `${basename(projectPath, ".vibe.json")}.${options.format}`
          );

      // Get preset settings
      const presetSettings = getPresetSettings(options.preset, summary.aspectRatio);

      // Get clips sorted by start time
      const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
      const sources = project.getSources();

      // Verify source files exist
      spinner.text = "Verifying source files...";
      for (const clip of clips) {
        const source = sources.find((s) => s.id === clip.sourceId);
        if (source) {
          try {
            await access(source.url);
          } catch {
            spinner.fail(chalk.red(`Source file not found: ${source.url}`));
            process.exit(1);
          }
        }
      }

      // Build FFmpeg command
      spinner.text = "Building export command...";
      const ffmpegArgs = buildFFmpegArgs(clips, sources, presetSettings, outputPath, options);

      if (process.env.DEBUG) {
        console.log("\nFFmpeg command:");
        console.log("ffmpeg", ffmpegArgs.join(" "));
        console.log();
      }

      // Run FFmpeg
      spinner.text = "Encoding...";

      await runFFmpegProcess(ffmpegPath, ffmpegArgs, (progress) => {
        spinner.text = `Encoding... ${progress}%`;
      });

      spinner.succeed(chalk.green(`Exported: ${outputPath}`));

      console.log();
      console.log(chalk.dim("  Duration:"), `${summary.duration.toFixed(1)}s`);
      console.log(chalk.dim("  Clips:"), summary.clipCount);
      console.log(chalk.dim("  Format:"), options.format);
      console.log(chalk.dim("  Preset:"), options.preset);
      console.log(chalk.dim("  Resolution:"), presetSettings.resolution);
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Export failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  });

/**
 * Find FFmpeg executable
 */
async function findFFmpeg(): Promise<string | null> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync("which ffmpeg || where ffmpeg 2>/dev/null");
    return stdout.trim().split("\n")[0];
  } catch {
    return null;
  }
}

/**
 * Build FFmpeg arguments for export
 */
function buildFFmpegArgs(
  clips: ReturnType<Project["getClips"]>,
  sources: ReturnType<Project["getSources"]>,
  presetSettings: PresetSettings,
  outputPath: string,
  options: { overwrite?: boolean; format?: string }
): string[] {
  const args: string[] = [];

  // Overwrite flag first
  if (options.overwrite) {
    args.push("-y");
  }

  // Add input files
  const sourceMap = new Map<string, number>();
  let inputIndex = 0;

  for (const clip of clips) {
    const source = sources.find((s) => s.id === clip.sourceId);
    if (source && !sourceMap.has(source.id)) {
      // Add -loop 1 before image inputs to create a continuous video stream
      if (source.type === "image") {
        args.push("-loop", "1");
      }
      args.push("-i", source.url);
      sourceMap.set(source.id, inputIndex);
      inputIndex++;
    }
  }

  // Build filter complex
  const filterParts: string[] = [];
  const videoStreams: string[] = [];
  const audioStreams: string[] = [];

  // Separate clips by track type for proper timeline-based export
  // Get track info to determine clip types
  const videoClips = clips.filter((clip) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    return source && (source.type === "image" || source.type === "video");
  });

  // Only include explicit audio clips (from audio sources on audio tracks)
  // Video sources on video tracks should NOT contribute to audio concat
  // This avoids mixing voiceover with embedded video audio
  const audioClips = clips.filter((clip) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    return source && source.type === "audio";
  });

  // Get target resolution for scaling (all clips must match for concat)
  const [targetWidth, targetHeight] = presetSettings.resolution.split("x").map(Number);

  // Process video clips
  videoClips.forEach((clip, clipIdx) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    if (!source) return;

    const srcIdx = sourceMap.get(source.id);
    if (srcIdx === undefined) return;

    // Video filter chain - images need different handling than video
    let videoFilter: string;
    if (source.type === "image") {
      // Images: trim from 0 to clip duration (no source offset since images are looped)
      videoFilter = `[${srcIdx}:v]trim=start=0:end=${clip.duration},setpts=PTS-STARTPTS`;
    } else {
      // Video: use source offsets
      const trimStart = clip.sourceStartOffset;
      const trimEnd = clip.sourceStartOffset + clip.duration;
      videoFilter = `[${srcIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS`;
    }

    // Scale to target resolution for concat compatibility (force same size, pad if needed)
    videoFilter += `,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    // Apply effects
    for (const effect of clip.effects || []) {
      if (effect.type === "fadeIn") {
        videoFilter += `,fade=t=in:st=0:d=${effect.duration}`;
      } else if (effect.type === "fadeOut") {
        const fadeStart = clip.duration - effect.duration;
        videoFilter += `,fade=t=out:st=${fadeStart}:d=${effect.duration}`;
      }
    }

    videoFilter += `[v${clipIdx}]`;
    filterParts.push(videoFilter);
    videoStreams.push(`[v${clipIdx}]`);
  });

  // Process audio clips
  audioClips.forEach((clip, clipIdx) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    if (!source) return;

    const srcIdx = sourceMap.get(source.id);
    if (srcIdx === undefined) return;

    const audioTrimStart = clip.sourceStartOffset;
    const audioTrimEnd = clip.sourceStartOffset + clip.duration;
    let audioFilter = `[${srcIdx}:a]atrim=start=${audioTrimStart}:end=${audioTrimEnd},asetpts=PTS-STARTPTS`;

    // Apply audio effects
    for (const effect of clip.effects || []) {
      if (effect.type === "fadeIn") {
        audioFilter += `,afade=t=in:st=0:d=${effect.duration}`;
      } else if (effect.type === "fadeOut") {
        const fadeStart = clip.duration - effect.duration;
        audioFilter += `,afade=t=out:st=${fadeStart}:d=${effect.duration}`;
      }
    }

    audioFilter += `[a${clipIdx}]`;
    filterParts.push(audioFilter);
    audioStreams.push(`[a${clipIdx}]`);
  });

  // Concatenate video clips
  if (videoStreams.length > 1) {
    filterParts.push(
      `${videoStreams.join("")}concat=n=${videoStreams.length}:v=1:a=0[outv]`
    );
  } else if (videoStreams.length === 1) {
    // Single video clip - just copy
    filterParts.push(`${videoStreams[0]}copy[outv]`);
  }

  // Concatenate or mix audio clips
  if (audioStreams.length > 1) {
    filterParts.push(
      `${audioStreams.join("")}concat=n=${audioStreams.length}:v=0:a=1[outa]`
    );
  } else if (audioStreams.length === 1) {
    // Single audio clip - just copy
    filterParts.push(`${audioStreams[0]}acopy[outa]`);
  }

  // Add filter complex
  args.push("-filter_complex", filterParts.join(";"));

  // Map outputs
  args.push("-map", "[outv]");
  if (audioStreams.length > 0) {
    args.push("-map", "[outa]");
  }

  // Add encoding settings
  args.push(...presetSettings.ffmpegArgs);

  // Output file
  args.push(outputPath);

  return args;
}

/**
 * Run FFmpeg with progress reporting
 */
function runFFmpegProcess(
  ffmpegPath: string,
  args: string[],
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let duration = 0;
    let stderr = "";

    ffmpeg.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;

      // Parse duration
      const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const [, hours, minutes, seconds] = durationMatch;
        duration =
          parseInt(hours) * 3600 +
          parseInt(minutes) * 60 +
          parseFloat(seconds);
      }

      // Parse progress
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && duration > 0) {
        const [, hours, minutes, seconds] = timeMatch;
        const currentTime =
          parseInt(hours) * 3600 +
          parseInt(minutes) * 60 +
          parseFloat(seconds);
        const percent = Math.min(100, Math.round((currentTime / duration) * 100));
        onProgress(percent);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract error message
        const errorMatch = stderr.match(/Error.*$/m);
        const errorMsg = errorMatch ? errorMatch[0] : `FFmpeg exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

interface PresetSettings {
  resolution: string;
  videoBitrate: string;
  audioBitrate: string;
  ffmpegArgs: string[];
}

function getPresetSettings(
  preset: string,
  aspectRatio: string
): PresetSettings {
  const presets: Record<string, PresetSettings> = {
    draft: {
      resolution: "640x360",
      videoBitrate: "1M",
      audioBitrate: "128k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
      ],
    },
    standard: {
      resolution: "1280x720",
      videoBitrate: "4M",
      audioBitrate: "192k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
      ],
    },
    high: {
      resolution: "1920x1080",
      videoBitrate: "8M",
      audioBitrate: "256k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "256k",
      ],
    },
    ultra: {
      resolution: "3840x2160",
      videoBitrate: "20M",
      audioBitrate: "320k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "15",
        "-c:a", "aac",
        "-b:a", "320k",
      ],
    },
  };

  // Adjust resolution for aspect ratio
  const settings = { ...presets[preset] || presets.standard };

  if (aspectRatio === "9:16") {
    // Vertical video
    const [w, h] = settings.resolution.split("x");
    settings.resolution = `${h}x${w}`;
  } else if (aspectRatio === "1:1") {
    // Square video
    const h = settings.resolution.split("x")[1];
    settings.resolution = `${h}x${h}`;
  }

  return settings;
}
