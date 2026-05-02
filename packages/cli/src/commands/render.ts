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

export const renderCommand = new Command("render")
  .description("Render a VibeFrame video project to MP4/WebM/MOV")
  .argument("[project-dir]", "Video project directory", ".")
  .option("-o, --out <path>", "Output file (default: renders/<name>-<timestamp>.<format>)")
  .option("--root <file>", "Root composition file", "index.html")
  .option("--beat <id>", "Render only one storyboard beat using a temporary root")
  .option("--fps <n>", `Frames per second: ${VALID_FPS.join("|")}`, "30")
  .option("--quality <q>", `Quality preset: ${VALID_QUALITIES.join("|")}`, "standard")
  .option("--format <f>", `Output container: ${VALID_FORMATS.join("|")}`, "mp4")
  .option("--workers <n>", "Capture workers (1-16, default 1)", "1")
  .option("--dry-run", "Preview parameters without rendering")
  .addHelpText("after", `
Examples:
  $ vibe render my-video
  $ vibe render my-video -o renders/final.mp4 --quality high

Alias note: this is the project-level entrypoint for \`vibe scene render\`.`)
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const fps = parseFps(String(options.fps));
    const quality = parseQuality(String(options.quality));
    const format = parseFormat(String(options.format));
    const workers = parseWorkers(String(options.workers));

    const params = {
      projectDir,
      root: options.root,
      beatId: options.beat,
      output: options.out,
      fps,
      quality,
      format,
      workers,
    };

    if (options.dryRun) {
      if (!isJsonMode() && !isQuietMode()) {
        printRenderDryRun(projectDirArg, params);
        return;
      }
      outputSuccess({
        command: "render",
        startedAt,
        dryRun: true,
        data: { params },
      });
      return;
    }

    const spinner = isJsonMode() || isQuietMode() ? null : ora("Rendering video project...").start();
    const result = await executeSceneRender({
      projectDir,
      root: options.root,
      beatId: options.beat,
      output: options.out,
      fps,
      quality,
      format,
      workers,
      onProgress: (pct, stage) => {
        if (spinner) spinner.text = `Rendering [${Math.round(pct * 100)}%] ${stage}`;
      },
    });

    if (!result.success) {
      spinner?.fail("Render failed");
      if (isJsonMode()) {
        outputSuccess({ command: "render", startedAt, data: { ...result } });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "Render failed"));
    }

    if (isJsonMode() || isQuietMode()) {
      outputSuccess({ command: "render", startedAt, data: { ...result } });
      return;
    }

    printRenderResult(spinner, result);
  });

type RenderDryRunParams = {
  projectDir: string;
  root: unknown;
  beatId?: string;
  output: unknown;
  fps: RenderFps;
  quality: RenderQuality;
  format: RenderFormat;
  workers: number;
};

function printRenderDryRun(projectDirArg: string, params: RenderDryRunParams): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Render - dry run"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:       ${chalk.bold(projectDirArg)}`);
  console.log(`  Root:          ${chalk.bold(String(params.root))}`);
  if (params.beatId) console.log(`  Beat:          ${chalk.bold(params.beatId)}`);
  console.log(`  Output:        ${chalk.bold(String(params.output ?? `renders/<name>-<timestamp>.${params.format}`))}`);
  console.log(`  Format:        ${chalk.bold(params.format)}`);
  console.log(`  Quality/FPS:   ${chalk.bold(`${params.quality} / ${params.fps}`)}`);
  console.log(`  Workers:       ${chalk.bold(String(params.workers))}`);
  console.log();
  console.log(chalk.dim("No browser capture, FFmpeg mux, or video files were created."));
}

function printRenderResult(spinner: ReturnType<typeof ora> | null, result: SceneRenderResult): void {
  spinner?.succeed(chalk.green(`Render complete: ${result.outputPath}`));
  console.log();
  console.log(chalk.bold.cyan("Output"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  File:      ${chalk.bold(result.outputPath)}`);
  if (result.beat) console.log(`  Beat:      ${result.beat}`);
  if (result.root) console.log(`  Root:      ${result.root}`);
  console.log(`  Format:    ${result.format ?? "mp4"}`);
  console.log(`  Quality:   ${result.quality ?? "standard"}`);
  console.log(`  FPS:       ${result.fps ?? 30}`);
  if (result.totalFrames !== undefined) console.log(`  Frames:    ${result.framesRendered ?? result.totalFrames}/${result.totalFrames}`);
  if (result.durationMs !== undefined) console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(2)}s`);
  if (result.audioCount !== undefined) {
    const audio = result.audioCount > 0
      ? `${result.audioCount} track${result.audioCount === 1 ? "" : "s"} muxed`
      : "silent";
    console.log(`  Audio:     ${audio}`);
  }
  if (result.audioMuxWarning) console.log(chalk.yellow(`  Warning:   ${result.audioMuxWarning}`));
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
