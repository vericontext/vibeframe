import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";

import {
  executeSceneRender,
  type SceneRenderResult,
  type RenderFormat,
  type RenderFps,
  type RenderQuality,
} from "./_shared/scene-render.js";
import { exitWithError, generalError, isJsonMode, isQuietMode, outputSuccess, usageError } from "./output.js";

const VALID_FPS: RenderFps[] = [24, 30, 60];
const VALID_QUALITIES: RenderQuality[] = ["draft", "standard", "high"];
const VALID_FORMATS: RenderFormat[] = ["mp4", "webm", "mov"];

/** Cheap-by-default knobs — a preview trades fidelity for speed/cost. */
const PREVIEW_FPS: RenderFps = 24;
const PREVIEW_QUALITY: RenderQuality = "draft";
const PREVIEW_OUTPUT = "preview.mp4";

export const previewCommand = new Command("preview")
  .description("Cheap draft render for a quick visual check before the full `vibe render`")
  .argument("[project-dir]", "Video project directory", ".")
  .option("-o, --output <path>", `Output file (default: ${PREVIEW_OUTPUT} in the project dir)`)
  .option("--root <file>", "Root composition file", "index.html")
  .option("--beat <id>", "Preview only one storyboard beat using a temporary root")
  .option("--fps <n>", `Frames per second: ${VALID_FPS.join("|")}`, String(PREVIEW_FPS))
  .option("--quality <q>", `Quality preset: ${VALID_QUALITIES.join("|")}`, PREVIEW_QUALITY)
  .option("--format <f>", `Output container: ${VALID_FORMATS.join("|")}`, "mp4")
  .option("--workers <n>", "Capture workers (1-16, default 1)", "1")
  .option("--open", "Open the preview in the OS default app after render")
  .option("--reveal", "Reveal the preview in Finder/file manager after render")
  .option("--dry-run", "Preview parameters without rendering")
  .addHelpText("after", `
A preview forces low-fps draft quality (≈${PREVIEW_FPS}fps / ${PREVIEW_QUALITY}) so you
can eyeball motion, layout, and timing far cheaper than a full render. It writes a
stable ${PREVIEW_OUTPUT} (overwritten each run) and leaves your real renders/ output
untouched. Resolution is fixed by the composition; quality + fps are the cheap levers.

Examples:
  $ vibe preview my-video
  $ vibe preview my-video --beat hook
  $ vibe preview my-video --fps 30   # override the cheap default`)
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const fps = parseFps(String(options.fps));
    const quality = parseQuality(String(options.quality));
    const format = parseFormat(String(options.format));
    const workers = parseWorkers(String(options.workers));
    const output = options.output ?? PREVIEW_OUTPUT;

    const params = {
      projectDir,
      root: options.root,
      beatId: options.beat,
      output,
      fps,
      quality,
      format,
      workers,
      openAfterRender: Boolean(options.open),
      revealInFinder: Boolean(options.reveal),
    };

    if (options.dryRun) {
      if (!isJsonMode() && !isQuietMode()) {
        printPreviewDryRun(projectDirArg, params);
        return;
      }
      outputSuccess({
        command: "preview",
        startedAt,
        dryRun: true,
        data: { params },
      });
      return;
    }

    const spinner = isJsonMode() || isQuietMode() ? null : ora("Rendering preview...").start();
    const result = await executeSceneRender({
      projectDir,
      root: options.root,
      beatId: options.beat,
      output,
      fps,
      quality,
      format,
      workers,
      openAfterRender: Boolean(options.open),
      revealInFinder: Boolean(options.reveal),
      onProgress: (pct, stage) => {
        if (spinner) spinner.text = `Preview [${Math.round(pct * 100)}%] ${stage}`;
      },
    });

    if (!result.success) {
      spinner?.fail("Preview failed");
      if (isJsonMode()) {
        outputSuccess({ command: "preview", startedAt, data: { ...result } });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "Preview failed"));
    }

    if (isJsonMode() || isQuietMode()) {
      outputSuccess({ command: "preview", startedAt, data: { ...result } });
      return;
    }

    printPreviewResult(spinner, result);
  });

type PreviewDryRunParams = {
  projectDir: string;
  root: unknown;
  beatId?: string;
  output: unknown;
  fps: RenderFps;
  quality: RenderQuality;
  format: RenderFormat;
  workers: number;
  openAfterRender: boolean;
  revealInFinder: boolean;
};

function printPreviewDryRun(projectDirArg: string, params: PreviewDryRunParams): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Preview - dry run"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:       ${chalk.bold(projectDirArg)}`);
  console.log(`  Root:          ${chalk.bold(String(params.root))}`);
  if (params.beatId) console.log(`  Beat:          ${chalk.bold(params.beatId)}`);
  console.log(`  Output:        ${chalk.bold(String(params.output))}`);
  console.log(`  Format:        ${chalk.bold(params.format)}`);
  console.log(`  Quality/FPS:   ${chalk.bold(`${params.quality} / ${params.fps}`)} ${chalk.dim("(draft preview)")}`);
  console.log(`  Workers:       ${chalk.bold(String(params.workers))}`);
  if (params.openAfterRender) console.log(`  Open:          ${chalk.bold("yes")}`);
  if (params.revealInFinder) console.log(`  Reveal:        ${chalk.bold("yes")}`);
  console.log();
  console.log(chalk.dim("No browser capture, FFmpeg mux, or video files were created."));
}

function printPreviewResult(spinner: ReturnType<typeof ora> | null, result: SceneRenderResult): void {
  spinner?.succeed(chalk.green(`Preview complete: ${result.outputPath}`));
  console.log();
  console.log(chalk.bold.cyan("Preview"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  File:      ${chalk.bold(result.absoluteOutputPath ?? result.outputPath)}`);
  if (result.beat) console.log(`  Beat:      ${result.beat}`);
  if (result.root) console.log(`  Root:      ${result.root}`);
  console.log(`  Format:    ${result.format ?? "mp4"}`);
  console.log(`  Quality:   ${result.quality ?? PREVIEW_QUALITY} ${chalk.dim("(draft)")}`);
  console.log(`  FPS:       ${result.fps ?? PREVIEW_FPS}`);
  if (result.totalFrames !== undefined) console.log(`  Frames:    ${result.framesRendered ?? result.totalFrames}/${result.totalFrames}`);
  if (result.durationMs !== undefined) console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(2)}s`);
  if (result.audioCount !== undefined) {
    const audio = result.audioCount > 0
      ? `${result.audioCount} track${result.audioCount === 1 ? "" : "s"} muxed`
      : "silent";
    console.log(`  Audio:     ${audio}`);
  }
  if (result.audioMuxWarning) console.log(chalk.yellow(`  Warning:   ${result.audioMuxWarning}`));
  if (result.openCommand) console.log(`  Open:      ${chalk.dim(result.openCommand)}`);
  if (result.revealCommand) console.log(`  Reveal:    ${chalk.dim(result.revealCommand)}`);
  if (result.opened) console.log(chalk.green("  Opened:    yes"));
  if (result.revealed) console.log(chalk.green("  Revealed:  yes"));
  if (result.openError) console.log(chalk.yellow(`  Open warn: ${result.openError}`));
  if (result.revealError) console.log(chalk.yellow(`  Reveal warn: ${result.revealError}`));
  console.log();
  console.log(chalk.dim("Looks right? Run `vibe render` for the full-quality output."));
}

function parseFps(value: string): RenderFps {
  const n = Number.parseInt(value, 10);
  if (!VALID_FPS.includes(n as RenderFps)) {
    exitWithError(usageError(`Invalid --fps: ${value}`, `Valid: ${VALID_FPS.join(", ")}`));
  }
  return n as RenderFps;
}

function parseQuality(value: string): RenderQuality {
  if (!VALID_QUALITIES.includes(value as RenderQuality)) {
    exitWithError(usageError(`Invalid --quality: ${value}`, `Valid: ${VALID_QUALITIES.join(", ")}`));
  }
  return value as RenderQuality;
}

function parseFormat(value: string): RenderFormat {
  if (!VALID_FORMATS.includes(value as RenderFormat)) {
    exitWithError(usageError(`Invalid --format: ${value}`, `Valid: ${VALID_FORMATS.join(", ")}`));
  }
  return value as RenderFormat;
}

function parseWorkers(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 16) {
    exitWithError(usageError(`Invalid --workers: ${value}`, "Must be an integer between 1 and 16"));
  }
  return n;
}
