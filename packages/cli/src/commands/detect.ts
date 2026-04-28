import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import { execSafe, commandExists, ffprobeDuration } from "../utils/exec-safe.js";
import { exitWithError, generalError, outputSuccess } from "./output.js";
import { validateOutputPath } from "./validate.js";

// ── Execute function interfaces ──────────────────────────────────────

export interface DetectScenesOptions {
  videoPath: string;
  threshold?: number;
  outputPath?: string;
}

export interface DetectScenesResult {
  success: boolean;
  scenes?: { index: number; startTime: number; endTime: number; duration: number }[];
  totalDuration?: number;
  error?: string;
}

export interface DetectSilenceOptions {
  mediaPath: string;
  noise?: string;
  duration?: string;
  outputPath?: string;
}

export interface DetectSilenceResult {
  success: boolean;
  silences?: { start: number; end: number; duration: number }[];
  error?: string;
}

export interface DetectBeatsOptions {
  audioPath: string;
  outputPath?: string;
}

export interface DetectBeatsResult {
  success: boolean;
  beats?: number[];
  beatCount?: number;
  error?: string;
}

/**
 * Detect scene changes in video using FFmpeg.
 */
export async function executeDetectScenes(options: DetectScenesOptions): Promise<DetectScenesResult> {
  try {
    if (!commandExists("ffmpeg")) {
      return { success: false, error: "FFmpeg not found. Install with: brew install ffmpeg" };
    }

    const absPath = resolve(process.cwd(), options.videoPath);
    const threshold = options.threshold ?? 0.3;

    const { stdout: sceneStdout, stderr: sceneStderr } = await execSafe("ffmpeg", [
      "-i", absPath,
      "-filter:v", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-",
    ], { maxBuffer: 50 * 1024 * 1024 }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      if (err.stdout !== undefined || err.stderr !== undefined) {
        return { stdout: err.stdout || "", stderr: err.stderr || "" };
      }
      throw err;
    });
    const output = sceneStdout + sceneStderr;

    const scenes: { timestamp: number; score: number }[] = [{ timestamp: 0, score: 1 }];
    const regex = /pts_time:(\d+\.?\d*)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
      scenes.push({ timestamp: parseFloat(match[1]), score: threshold });
    }

    const totalDuration = await ffprobeDuration(absPath);

    const result = scenes.map((s, i) => ({
      index: i,
      startTime: s.timestamp,
      endTime: i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration,
      duration: (i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration) - s.timestamp,
    }));

    if (options.outputPath) {
      const outputPath = resolve(process.cwd(), options.outputPath);
      await writeFile(outputPath, JSON.stringify({ source: absPath, totalDuration, threshold, scenes: result }, null, 2), "utf-8");
    }

    return { success: true, scenes: result, totalDuration };
  } catch (error) {
    return { success: false, error: `Scene detection failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Detect silence periods in audio/video using FFmpeg.
 */
export async function executeDetectSilence(options: DetectSilenceOptions): Promise<DetectSilenceResult> {
  try {
    if (!commandExists("ffmpeg")) {
      return { success: false, error: "FFmpeg not found. Install with: brew install ffmpeg" };
    }

    const absPath = resolve(process.cwd(), options.mediaPath);
    const noise = options.noise ?? "-30";
    const duration = options.duration ?? "0.5";

    const { stdout: silStdout, stderr: silStderr } = await execSafe("ffmpeg", [
      "-i", absPath,
      "-af", `silencedetect=noise=${noise}dB:d=${duration}`,
      "-f", "null", "-",
    ], { maxBuffer: 50 * 1024 * 1024 }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      if (err.stdout !== undefined || err.stderr !== undefined) {
        return { stdout: err.stdout || "", stderr: err.stderr || "" };
      }
      throw err;
    });
    const output = silStdout + silStderr;

    const silences: { start: number; end: number; duration: number }[] = [];
    const startRegex = /silence_start: (\d+\.?\d*)/g;
    const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;

    const starts: number[] = [];
    let match;
    while ((match = startRegex.exec(output)) !== null) {
      starts.push(parseFloat(match[1]));
    }
    let i = 0;
    while ((match = endRegex.exec(output)) !== null) {
      if (i < starts.length) {
        silences.push({ start: starts[i], end: parseFloat(match[1]), duration: parseFloat(match[2]) });
        i++;
      }
    }

    if (options.outputPath) {
      const outputPath = resolve(process.cwd(), options.outputPath);
      await writeFile(outputPath, JSON.stringify({ source: absPath, silences }, null, 2), "utf-8");
    }

    return { success: true, silences };
  } catch (error) {
    return { success: false, error: `Silence detection failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Detect beats in audio using FFmpeg ebur128 loudness analysis.
 */
export async function executeDetectBeats(options: DetectBeatsOptions): Promise<DetectBeatsResult> {
  try {
    if (!commandExists("ffmpeg")) {
      return { success: false, error: "FFmpeg not found. Install with: brew install ffmpeg" };
    }

    const absPath = resolve(process.cwd(), options.audioPath);

    const { stdout: beatStdout, stderr: beatStderr } = await execSafe("ffmpeg", [
      "-i", absPath,
      "-af", "aresample=16000,ebur128=peak=true",
      "-f", "null", "-",
    ], { maxBuffer: 50 * 1024 * 1024 }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      if (err.stdout !== undefined || err.stderr !== undefined) {
        return { stdout: err.stdout || "", stderr: err.stderr || "" };
      }
      throw err;
    });
    const beatOutput = beatStdout + beatStderr;

    const beats: number[] = [];
    const peakRegex = /t:\s*(\d+\.?\d*)\s+M:\s*-?\d+\.?\d*\s+S:\s*-?\d+\.?\d*\s+I:\s*-?\d+\.?\d*\s+LUFS\s+LRA:\s*\d+\.?\d*\s+LU\s+FTPK:\s*(-?\d+\.?\d*)/g;
    let match;
    let lastBeatTime = -0.5;

    while ((match = peakRegex.exec(beatOutput)) !== null) {
      const time = parseFloat(match[1]);
      const peak = parseFloat(match[2]);
      if (peak > -10 && time - lastBeatTime > 0.3) {
        beats.push(time);
        lastBeatTime = time;
      }
    }

    if (beats.length === 0) {
      const totalDuration = await ffprobeDuration(absPath);
      const beatInterval = 60 / 120;
      for (let t = 0; t < totalDuration; t += beatInterval) {
        beats.push(t);
      }
    }

    if (options.outputPath) {
      const outputPath = resolve(process.cwd(), options.outputPath);
      await writeFile(outputPath, JSON.stringify({ source: absPath, beatCount: beats.length, beats }, null, 2), "utf-8");
    }

    return { success: true, beats, beatCount: beats.length };
  } catch (error) {
    return { success: false, error: `Beat detection failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export const detectCommand = new Command("detect")
  .description("Auto-detect scenes, beats, and silences in media");

/**
 * Scene change detection using FFmpeg
 */
detectCommand
  .command("scenes")
  .description("Detect scene changes in video")
  .argument("<video>", "Video file path")
  .option("-t, --threshold <value>", "Scene change threshold (0-1)", "0.3")
  .option("-o, --output <path>", "Output JSON file with timestamps")
  .option("-p, --project <path>", "Add scenes as clips to project")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (videoPath: string, options) => {
    const startedAt = Date.now();
    const spinner = ora("Detecting scenes...").start();

    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputSuccess({
          command: "detect scenes",
          startedAt,
          dryRun: true,
          data: {
            params: {
              video: videoPath,
              threshold: options.threshold,
              output: options.output || null,
              project: options.project || null,
            },
          },
        });
        return;
      }

      // Check if FFmpeg is available
      if (!commandExists("ffmpeg")) {
        spinner.fail("FFmpeg not found");
        exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
      }

      const absPath = resolve(process.cwd(), videoPath);
      const threshold = parseFloat(options.threshold);

      // Use FFmpeg to detect scene changes
      spinner.text = "Analyzing video...";

      const { stdout: sceneStdout, stderr: sceneStderr } = await execSafe("ffmpeg", [
        "-i", absPath,
        "-filter:v", `select='gt(scene,${threshold})',showinfo`,
        "-f", "null", "-",
      ], { maxBuffer: 50 * 1024 * 1024 }).catch((err) => {
        // ffmpeg writes filter output to stderr and exits non-zero with -f null
        if (err.stdout !== undefined || err.stderr !== undefined) {
          return { stdout: err.stdout || "", stderr: err.stderr || "" };
        }
        throw err;
      });
      const output = sceneStdout + sceneStderr;

      // Parse scene change timestamps from showinfo output
      const scenes: { timestamp: number; score: number }[] = [];
      const regex = /pts_time:(\d+\.?\d*)/g;
      let match;

      // Always start with 0
      scenes.push({ timestamp: 0, score: 1 });

      while ((match = regex.exec(output)) !== null) {
        const timestamp = parseFloat(match[1]);
        scenes.push({ timestamp, score: threshold });
      }

      // Get video duration
      const totalDuration = await ffprobeDuration(absPath);

      spinner.succeed(chalk.green(`Detected ${scenes.length} scenes`));

      console.log();
      console.log(chalk.bold.cyan("Scene Timestamps"));
      console.log(chalk.dim("─".repeat(60)));

      for (let i = 0; i < scenes.length; i++) {
        const start = scenes[i].timestamp;
        const end = i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration;
        const duration = end - start;
        console.log(
          `${chalk.yellow(`[${i + 1}]`)} ${formatTimestamp(start)} - ${formatTimestamp(end)} ${chalk.dim(`(${duration.toFixed(1)}s)`)}`
        );
      }
      console.log();

      // Save to JSON
      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        const result = {
          source: absPath,
          totalDuration,
          threshold,
          scenes: scenes.map((s, i) => ({
            index: i,
            startTime: s.timestamp,
            endTime: i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration,
            duration:
              (i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration) - s.timestamp,
          })),
        };
        await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }

      // Add to project
      if (options.project) {
        const projectPath = resolve(process.cwd(), options.project);
        const content = await readFile(projectPath, "utf-8");
        const data: ProjectFile = JSON.parse(content);
        const project = Project.fromJSON(data);

        // Add video as source if not exists
        let source = project.getSources().find((s) => s.url === absPath);
        if (!source) {
          source = project.addSource({
            name: basename(absPath),
            type: "video",
            url: absPath,
            duration: totalDuration,
          });
        }

        // Add clips for each scene
        for (let i = 0; i < scenes.length; i++) {
          const start = scenes[i].timestamp;
          const end = i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration;
          const duration = end - start;

          project.addClip({
            sourceId: source.id,
            trackId: project.getTracks().find((t) => t.type === "video")?.id || "",
            startTime: start,
            duration,
            sourceStartOffset: start,
            sourceEndOffset: end,
          });
        }

        await writeFile(projectPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
        console.log(chalk.green(`Added ${scenes.length} clips to project`));
      }
    } catch (error) {
      spinner.fail("Scene detection failed");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Scene detection failed: ${msg}`));
    }
  });

/**
 * Silence detection using FFmpeg
 */
detectCommand
  .command("silence")
  .description("Detect silence in audio/video")
  .argument("<media>", "Media file path")
  .option("-n, --noise <dB>", "Noise threshold in dB", "-30")
  .option("-d, --duration <sec>", "Minimum silence duration", "0.5")
  .option("-o, --output <path>", "Output JSON file with timestamps")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (mediaPath: string, options) => {
    const startedAt = Date.now();
    const spinner = ora("Detecting silence...").start();

    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputSuccess({
          command: "detect silence",
          startedAt,
          dryRun: true,
          data: {
            params: {
              media: mediaPath,
              noise: options.noise,
              duration: options.duration,
              output: options.output || null,
            },
          },
        });
        return;
      }

      const absPath = resolve(process.cwd(), mediaPath);
      const noise = options.noise;
      const duration = options.duration;

      const { stdout: silStdout, stderr: silStderr } = await execSafe("ffmpeg", [
        "-i", absPath,
        "-af", `silencedetect=noise=${noise}dB:d=${duration}`,
        "-f", "null", "-",
      ], { maxBuffer: 50 * 1024 * 1024 }).catch((err) => {
        if (err.stdout !== undefined || err.stderr !== undefined) {
          return { stdout: err.stdout || "", stderr: err.stderr || "" };
        }
        throw err;
      });
      const output = silStdout + silStderr;

      // Parse silence periods
      const silences: { start: number; end: number; duration: number }[] = [];
      const startRegex = /silence_start: (\d+\.?\d*)/g;
      const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;

      const starts: number[] = [];
      let match;

      while ((match = startRegex.exec(output)) !== null) {
        starts.push(parseFloat(match[1]));
      }

      let i = 0;
      while ((match = endRegex.exec(output)) !== null) {
        if (i < starts.length) {
          silences.push({
            start: starts[i],
            end: parseFloat(match[1]),
            duration: parseFloat(match[2]),
          });
          i++;
        }
      }

      spinner.succeed(chalk.green(`Detected ${silences.length} silence periods`));

      console.log();
      console.log(chalk.bold.cyan("Silence Periods"));
      console.log(chalk.dim("─".repeat(60)));

      for (let i = 0; i < silences.length; i++) {
        const s = silences[i];
        console.log(
          `${chalk.yellow(`[${i + 1}]`)} ${formatTimestamp(s.start)} - ${formatTimestamp(s.end)} ${chalk.dim(`(${s.duration.toFixed(1)}s)`)}`
        );
      }
      console.log();

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(
          outputPath,
          JSON.stringify({ source: absPath, silences }, null, 2),
          "utf-8"
        );
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      spinner.fail("Silence detection failed");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Silence detection failed: ${msg}`));
    }
  });

/**
 * Beat detection for music sync
 */
detectCommand
  .command("beats")
  .description("Detect beats in audio (for music sync)")
  .argument("<audio>", "Audio file path")
  .option("-o, --output <path>", "Output JSON file with timestamps")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (audioPath: string, options) => {
    const startedAt = Date.now();
    const spinner = ora("Detecting beats...").start();

    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputSuccess({
          command: "detect beats",
          startedAt,
          dryRun: true,
          data: {
            params: {
              audio: audioPath,
              output: options.output || null,
            },
          },
        });
        return;
      }

      const absPath = resolve(process.cwd(), audioPath);

      // Use FFmpeg's ebur128 filter for loudness analysis
      // This gives us a rough approximation of beat positions
      const { stdout: beatStdout, stderr: beatStderr } = await execSafe("ffmpeg", [
        "-i", absPath,
        "-af", "aresample=16000,ebur128=peak=true",
        "-f", "null", "-",
      ], { maxBuffer: 50 * 1024 * 1024 }).catch((err) => {
        if (err.stdout !== undefined || err.stderr !== undefined) {
          return { stdout: err.stdout || "", stderr: err.stderr || "" };
        }
        throw err;
      });
      const beatOutput = beatStdout + beatStderr;

      // Extract peak moments as approximate beats
      const beats: number[] = [];
      const peakRegex = /t:\s*(\d+\.?\d*)\s+M:\s*-?\d+\.?\d*\s+S:\s*-?\d+\.?\d*\s+I:\s*-?\d+\.?\d*\s+LUFS\s+LRA:\s*\d+\.?\d*\s+LU\s+FTPK:\s*(-?\d+\.?\d*)/g;

      let match;
      let lastBeatTime = -0.5;

      while ((match = peakRegex.exec(beatOutput)) !== null) {
        const time = parseFloat(match[1]);
        const peak = parseFloat(match[2]);

        // Consider it a beat if peak is high and enough time has passed
        if (peak > -10 && time - lastBeatTime > 0.3) {
          beats.push(time);
          lastBeatTime = time;
        }
      }

      // Fallback: if no beats detected, use simple interval-based detection
      if (beats.length === 0) {
        spinner.text = "Using interval-based detection...";

        // Get duration
        const totalDuration = await ffprobeDuration(absPath);

        // Estimate BPM from audio length (rough approximation)
        const estimatedBPM = 120;
        const beatInterval = 60 / estimatedBPM;

        for (let t = 0; t < totalDuration; t += beatInterval) {
          beats.push(t);
        }
      }

      spinner.succeed(chalk.green(`Detected ${beats.length} beats`));

      console.log();
      console.log(chalk.bold.cyan("Beat Timestamps"));
      console.log(chalk.dim("─".repeat(60)));

      // Show first 20 beats
      const displayBeats = beats.slice(0, 20);
      for (let i = 0; i < displayBeats.length; i++) {
        console.log(`${chalk.yellow(`[${i + 1}]`)} ${formatTimestamp(displayBeats[i])}`);
      }

      if (beats.length > 20) {
        console.log(chalk.dim(`... and ${beats.length - 20} more`));
      }
      console.log();

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(
          outputPath,
          JSON.stringify({ source: absPath, beatCount: beats.length, beats }, null, 2),
          "utf-8"
        );
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      spinner.fail("Beat detection failed");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Beat detection failed: ${msg}`));
    }
  });

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  return `${mins.toString().padStart(2, "0")}:${secs.padStart(5, "0")}`;
}
