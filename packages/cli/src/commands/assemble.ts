import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";

import { executeSceneAssemble, type SceneAssembleResult } from "./_shared/scene-assemble.js";
import {
  executeFootageAssemble,
  type FootageAssembleResult,
} from "./_shared/footage-assemble.js";
import type { RenderFormat } from "./_shared/scene-render.js";
import { exitWithError, generalError, isJsonMode, isQuietMode, outputSuccess, usageError } from "./output.js";

const VALID_FORMATS: RenderFormat[] = ["mp4", "webm", "mov"];
const DEFAULT_VIDEO = "preview.mp4";

export const assembleCommand = new Command("assemble")
  .description(
    "Mux a scene project's audio onto a rendered video, or crossfade-cut its generated clips (--footage)"
  )
  .argument("[project-dir]", "Video project directory", ".")
  .option("--video <path>", `Rendered video to add audio to (default: ${DEFAULT_VIDEO})`, DEFAULT_VIDEO)
  .option("--root <file>", "Root composition file", "index.html")
  .option("--format <f>", `Output container: ${VALID_FORMATS.join("|")}`, "mp4")
  .option("--footage", "Assemble assets/video-<beat>.mp4 clips into one cinematic cut (no HTML render)")
  .option("-o, --output <path>", "Footage-cut output path (default: renders/footage.mp4)")
  .option("--transition <sec>", "Footage crossfade length in seconds", "0.5")
  .option("--fade <sec>", "Footage fade-from/to-black length in seconds", "0.6")
  .option("--music <path>", 'Footage music bed: a file path or "none" (default: auto-detect assets/music*)')
  .option("--music-volume <v>", "Footage music-bed volume before ducking (0-1)", "0.35")
  .option("--dry-run", "Preview parameters without muxing")
  .addHelpText("after", `
The default assemble stage lays the project's <audio> elements onto a silent
video in one FFmpeg pass (-c:v copy, no re-encode). Pair it with \`vibe render
--silent\`:

  $ vibe render my-video --silent -o draft.mp4
  $ vibe assemble my-video --video draft.mp4

With --footage the project's generated clips become the picture: they are
crossfade-concatenated in beat order, narration is laid at computed offsets,
an optional music bed is ducked under it, and the head/tail fade to black -
one FFmpeg pass, no HTML composition or browser capture. Timing comes from
the real files (ffprobe), and assemble-report.json records every offset:

  $ vibe build my-video --stage assets --json     # clips + narration
  $ vibe assemble my-video --footage --json`)
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    if (options.footage) {
      await runFootageAssemble(projectDir, options, startedAt);
      return;
    }
    const format = parseFormat(String(options.format));
    const video = String(options.video ?? DEFAULT_VIDEO);

    const params = { projectDir, root: options.root, video, format };

    if (options.dryRun) {
      if (!isJsonMode() && !isQuietMode()) {
        printAssembleDryRun(projectDirArg, params);
        return;
      }
      outputSuccess({ command: "assemble", startedAt, dryRun: true, data: { params } });
      return;
    }

    const spinner = isJsonMode() || isQuietMode() ? null : ora("Assembling audio...").start();
    const result = await executeSceneAssemble({
      projectDir,
      root: options.root,
      videoPath: video,
      format,
      onProgress: (pct, stage) => {
        if (spinner) spinner.text = `Assembling [${Math.round(pct * 100)}%] ${stage}`;
      },
    });

    if (!result.success) {
      spinner?.fail("Assemble failed");
      if (isJsonMode()) {
        outputSuccess({ command: "assemble", startedAt, data: { ...result } });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "Assemble failed"));
    }

    if (isJsonMode() || isQuietMode()) {
      outputSuccess({ command: "assemble", startedAt, data: { ...result } });
      return;
    }

    printAssembleResult(spinner, result);
  });

async function runFootageAssemble(
  projectDir: string,
  options: Record<string, unknown>,
  startedAt: number
): Promise<void> {
  const transitionSec = parseSeconds("--transition", options.transition);
  const fadeSec = parseSeconds("--fade", options.fade);
  const musicVolume = parseSeconds("--music-volume", options.musicVolume);

  const spinner =
    isJsonMode() || isQuietMode() || options.dryRun ? null : ora("Assembling footage cut...").start();
  const result = await executeFootageAssemble({
    projectDir,
    output: options.output as string | undefined,
    transitionSec,
    fadeSec,
    music: options.music as string | undefined,
    musicVolume,
    dryRun: Boolean(options.dryRun),
  });

  if (!result.success) {
    spinner?.fail("Footage assemble failed");
    exitWithError(generalError(result.error ?? "Footage assemble failed", result.suggestion));
  }

  if (isJsonMode() || isQuietMode()) {
    outputSuccess({ command: "assemble", startedAt, dryRun: result.dryRun, data: { ...result } });
    return;
  }
  printFootageResult(spinner, result);
}

function printFootageResult(
  spinner: ReturnType<typeof ora> | null,
  result: FootageAssembleResult
): void {
  const report = result.report;
  if (result.dryRun) {
    console.log();
    console.log(chalk.bold.cyan("VibeFrame Assemble - footage dry run"));
  } else {
    spinner?.succeed(chalk.green(`Footage cut assembled: ${result.outputPath}`));
    console.log();
    console.log(chalk.bold.cyan("Footage cut"));
  }
  console.log(chalk.dim("-".repeat(60)));
  if (report) {
    console.log(`  Output:     ${chalk.bold(report.output)}`);
    console.log(`  Duration:   ${chalk.bold(`${report.totalDurationSec}s`)}`);
    console.log(`  Transition: ${report.transitionSec}s crossfade, ${report.fadeSec}s head/tail fade`);
    console.log(
      `  Music:      ${report.music ? `${report.music.path}${report.music.ducked ? " (ducked)" : ""}` : chalk.dim("none")}`
    );
    for (const beat of report.beats) {
      const narration = beat.narrationStartSec !== undefined ? ` nar@${beat.narrationStartSec}s` : "";
      const extended = beat.extendedSec > 0 ? chalk.yellow(` +${beat.extendedSec}s hold`) : "";
      console.log(
        `    ${beat.id.padEnd(12)} ${String(beat.startSec).padStart(7)}s  ${beat.segmentDurationSec}s${narration}${extended}`
      );
    }
    for (const warning of report.warnings) console.log(chalk.yellow(`  Warning: ${warning}`));
  }
  if (result.dryRun) {
    console.log();
    console.log(chalk.dim("No FFmpeg pass ran; nothing was written."));
  } else if (result.reportPath) {
    console.log(`  Report:     ${result.reportPath}`);
  }
}

function parseSeconds(flag: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0) {
    exitWithError(usageError(`Invalid ${flag}: ${String(value)}`, "Expected a non-negative number."));
  }
  return n;
}

type AssembleDryRunParams = {
  projectDir: string;
  root: unknown;
  video: string;
  format: RenderFormat;
};

function printAssembleDryRun(projectDirArg: string, params: AssembleDryRunParams): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Assemble - dry run"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:   ${chalk.bold(projectDirArg)}`);
  console.log(`  Root:      ${chalk.bold(String(params.root))}`);
  console.log(`  Video:     ${chalk.bold(params.video)}`);
  console.log(`  Format:    ${chalk.bold(params.format)}`);
  console.log();
  console.log(chalk.dim("No FFmpeg mux ran; the video was not modified."));
}

function printAssembleResult(spinner: ReturnType<typeof ora> | null, result: SceneAssembleResult): void {
  const summary =
    result.audioCount > 0
      ? result.audioMuxApplied
        ? `${result.audioCount} track${result.audioCount === 1 ? "" : "s"} muxed`
        : "mux skipped"
      : "no audio elements found";
  spinner?.succeed(chalk.green(`Assemble complete: ${summary}`));
  console.log();
  console.log(chalk.bold.cyan("Assemble"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Video:     ${chalk.bold(result.outputPath)}`);
  console.log(`  Audio:     ${result.audioCount} element${result.audioCount === 1 ? "" : "s"}`);
  console.log(`  Muxed:     ${result.audioMuxApplied ? chalk.green("yes") : chalk.dim("no")}`);
  if (result.audioMuxWarning) console.log(chalk.yellow(`  Warning:   ${result.audioMuxWarning}`));
}

function parseFormat(value: string): RenderFormat {
  if (!VALID_FORMATS.includes(value as RenderFormat)) {
    exitWithError(usageError(`Invalid --format: ${value}`, `Valid: ${VALID_FORMATS.join(", ")}`));
  }
  return value as RenderFormat;
}
