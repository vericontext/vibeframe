import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { executeMotion, type MotionCommandOptions } from "../ai-motion.js";
import { ffprobeDuration } from "../../utils/exec-safe.js";
import { renderLottieOverlay, type LottiePosition } from "./lottie-overlay.js";
import {
  failureFromError,
  spinner as createSpinner,
  apiError,
  generalError,
  isJsonMode,
  outputSuccess,
  usageError,
  exitWithError,
} from "../output.js";
import { validateOutputPath } from "../validate.js";

export type MotionOverlayUnderstand = "auto" | "off" | "required";
export type MotionOverlayPosition = LottiePosition;

export interface MotionOverlayOptions {
  videoPath: string;
  description?: string;
  asset?: string;
  output?: string;
  duration?: number;
  start?: number;
  style?: string;
  model?: MotionCommandOptions["model"];
  understand?: MotionOverlayUnderstand;
  understandingPrompt?: string;
  position?: MotionOverlayPosition;
  scale?: number;
  opacity?: number;
  loop?: boolean;
}

export interface MotionOverlayResult {
  success: boolean;
  outputPath?: string;
  codePath?: string;
  renderedPath?: string;
  provider?: "remotion" | "lottie";
  error?: string;
  /** How to fix a failure that a retry will not fix. */
  suggestion?: string;
  /** False for deterministic local failures (bad asset, missing Chrome/FFmpeg). */
  retryable?: boolean;
}

const VALID_POSITIONS: MotionOverlayPosition[] = [
  "full",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

function normalizeUnderstand(value: unknown): MotionOverlayUnderstand {
  return value === "off" || value === "required" || value === "auto" ? value : "auto";
}

function normalizePosition(value: unknown): MotionOverlayPosition {
  return VALID_POSITIONS.includes(value as MotionOverlayPosition)
    ? (value as MotionOverlayPosition)
    : "full";
}

function numberOption(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultOverlayOutput(videoPath: string): string {
  const absVideo = resolve(process.cwd(), videoPath);
  return absVideo.replace(/(\.[^.]+)$/, "-motion-overlay$1");
}

function assertValidRequest(options: MotionOverlayOptions): string | undefined {
  const hasDescription = !!options.description?.trim();
  const hasAsset = !!options.asset;
  if (hasDescription && hasAsset) return "Provide either a description or --asset, not both.";
  if (!hasDescription && !hasAsset) {
    return "Provide a motion description, or pass --asset <logo.json|logo.lottie>.";
  }
  if (hasAsset) {
    const ext = extname(options.asset!).toLowerCase();
    if (ext !== ".json" && ext !== ".lottie") {
      return "Lottie overlay asset must be a .json or .lottie file.";
    }
  }
  return undefined;
}

export async function executeMotionOverlay(
  options: MotionOverlayOptions
): Promise<MotionOverlayResult> {
  const validationError = assertValidRequest(options);
  if (validationError) return { success: false, error: validationError };

  const absVideo = resolve(process.cwd(), options.videoPath);
  if (!existsSync(absVideo)) return { success: false, error: `Video file not found: ${absVideo}` };

  const outputPath = options.output
    ? resolve(process.cwd(), options.output)
    : defaultOverlayOutput(options.videoPath);

  if (options.asset) {
    const absAsset = resolve(process.cwd(), options.asset);
    if (!existsSync(absAsset)) return { success: false, error: `Lottie asset not found: ${absAsset}` };

    const videoDuration = await ffprobeDuration(absVideo);
    const start = Math.max(0, options.start ?? 0);
    if (start >= videoDuration) {
      return { success: false, error: `--start ${start}s is past the end of the video (${videoDuration.toFixed(2)}s).` };
    }
    const remaining = videoDuration - start;
    const position = normalizePosition(options.position);
    await mkdir(dirname(outputPath), { recursive: true });
    const result = await renderLottieOverlay({
      videoPath: absVideo,
      assetPath: absAsset,
      outputPath,
      start,
      duration: Math.min(options.duration ?? remaining, remaining),
      position,
      scale: Math.max(0.01, Math.min(2, numberOption(options.scale, position === "full" ? 1 : 0.25))),
      opacity: Math.max(0, Math.min(1, numberOption(options.opacity, 1))),
      loop: options.loop ?? true,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "Lottie overlay failed", suggestion: result.suggestion, retryable: false };
    }
    return { success: true, outputPath, provider: "lottie" };
  }

  const duration = options.duration ?? (await ffprobeDuration(absVideo).catch(() => undefined));
  await mkdir(dirname(outputPath), { recursive: true });
  const result = await executeMotion({
    description: options.description!.trim(),
    video: absVideo,
    render: true,
    output: outputPath,
    duration,
    style: options.style,
    model: options.model,
    understand: normalizeUnderstand(options.understand),
    understandingPrompt: options.understandingPrompt,
  });

  if (!result.success) return { success: false, error: result.error ?? "Motion overlay failed" };
  return {
    success: true,
    outputPath: result.compositedPath ?? result.renderedPath,
    codePath: result.codePath,
    renderedPath: result.renderedPath,
    provider: "remotion",
  };
}

export function registerMotionOverlayCommand(parent: Command): void {
  parent
    .command("motion-overlay")
    .description("Apply designed motion graphics overlays to an existing video")
    .argument("<video>", "Video file path")
    .argument("[description]", "Motion overlay description (omit when using --asset)")
    .option("--asset <path>", "User-provided .json/.lottie animation to overlay")
    .option("-o, --output <path>", "Output video file path")
    .option("-d, --duration <sec>", "Overlay/render duration in seconds")
    .option("--start <sec>", "Overlay start time in seconds", "0")
    .option("--style <style>", "Style preset for generated overlays: minimal, corporate, playful, cinematic")
    .option("-m, --model <alias>", "LLM model for generated overlays: sonnet, opus, gemini, gemini-2.5-pro, gemini-3.1-pro", "sonnet")
    .option("--understand <mode>", "Analyze video before generated overlay: auto, off, required", "auto")
    .option("--understanding-prompt <text>", "Custom prompt for video understanding")
    .option("--position <position>", "Lottie position: full, center, top-left, top-right, bottom-left, bottom-right", "full")
    .option("--scale <number>", "Lottie overlay scale (0.01-2)")
    .option("--opacity <number>", "Lottie overlay opacity (0-1)", "1")
    .option("--loop", "Loop Lottie overlay", true)
    .option("--no-loop", "Do not loop Lottie overlay")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (videoPath: string, description: string | undefined, options) => {
      const startedAt = Date.now();
      try {
        if (options.output) validateOutputPath(options.output);

        const parsed: MotionOverlayOptions = {
          videoPath,
          description,
          asset: options.asset,
          output: options.output,
          duration: options.duration !== undefined ? Number(options.duration) : undefined,
          start: options.start !== undefined ? Number(options.start) : undefined,
          style: options.style,
          model: options.model,
          understand: normalizeUnderstand(options.understand),
          understandingPrompt: options.understandingPrompt,
          position: normalizePosition(options.position),
          scale: options.scale !== undefined ? Number(options.scale) : undefined,
          opacity: options.opacity !== undefined ? Number(options.opacity) : undefined,
          loop: options.loop,
        };

        const validationError = assertValidRequest(parsed);
        if (validationError) {
          exitWithError(usageError(validationError));
        }
        if (parsed.duration !== undefined && (!Number.isFinite(parsed.duration) || parsed.duration <= 0)) {
          exitWithError(usageError("Invalid --duration.", "Duration must be a positive number."));
        }
        if (parsed.start !== undefined && (!Number.isFinite(parsed.start) || parsed.start < 0)) {
          exitWithError(usageError("Invalid --start.", "Start time must be 0 or greater."));
        }
        if (parsed.scale !== undefined && (!Number.isFinite(parsed.scale) || parsed.scale <= 0 || parsed.scale > 2)) {
          exitWithError(usageError("Invalid --scale.", "Scale must be greater than 0 and no more than 2."));
        }
        if (parsed.opacity !== undefined && (!Number.isFinite(parsed.opacity) || parsed.opacity < 0 || parsed.opacity > 1)) {
          exitWithError(usageError("Invalid --opacity.", "Opacity must be between 0 and 1."));
        }

        if (options.dryRun) {
          outputSuccess({
            command: "edit motion-overlay",
            startedAt,
            dryRun: true,
            data: { params: parsed },
          });
          return;
        }

        const spinner = createSpinner(parsed.asset ? "Applying Lottie motion overlay..." : "Generating motion overlay...").start();
        const result = await executeMotionOverlay(parsed);
        if (!result.success) {
          spinner.fail(result.error ?? "Motion overlay failed");
          const message = result.error ?? "Motion overlay failed";
          exitWithError(result.retryable === false ? generalError(message, result.suggestion) : apiError(message, true));
        }

        spinner.succeed(chalk.green("Motion overlay applied"));

        if (isJsonMode()) {
          outputSuccess({
            command: "edit motion-overlay",
            startedAt,
            data: {
              outputPath: result.outputPath,
              codePath: result.codePath,
              renderedPath: result.renderedPath,
              provider: result.provider,
            },
          });
          return;
        }

        console.log();
        if (result.codePath) console.log(chalk.green(`  Code: ${result.codePath}`));
        if (result.outputPath) console.log(chalk.green(`  Output: ${result.outputPath}`));
        console.log();
      } catch (error) {
        exitWithError(failureFromError(error, undefined, { fallback: "general" }));
      }
    });
}
