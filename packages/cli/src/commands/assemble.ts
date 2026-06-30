import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve } from "node:path";

import { executeSceneAssemble, type SceneAssembleResult } from "./_shared/scene-assemble.js";
import type { RenderFormat } from "./_shared/scene-render.js";
import { exitWithError, generalError, isJsonMode, isQuietMode, outputSuccess, usageError } from "./output.js";

const VALID_FORMATS: RenderFormat[] = ["mp4", "webm", "mov"];
const DEFAULT_VIDEO = "preview.mp4";

export const assembleCommand = new Command("assemble")
  .description("Mux a scene project's audio onto an already-rendered (silent) video")
  .argument("[project-dir]", "Video project directory", ".")
  .option("--video <path>", `Rendered video to add audio to (default: ${DEFAULT_VIDEO})`, DEFAULT_VIDEO)
  .option("--root <file>", "Root composition file", "index.html")
  .option("--format <f>", `Output container: ${VALID_FORMATS.join("|")}`, "mp4")
  .option("--dry-run", "Preview parameters without muxing")
  .addHelpText("after", `
The assemble stage lays the project's <audio> elements onto a silent video in
one FFmpeg pass (-c:v copy, no re-encode). Pair it with \`vibe render --silent\`:

  $ vibe render my-video --silent -o draft.mp4
  $ vibe assemble my-video --video draft.mp4

Plain \`vibe render\` already renders + assembles in one shot — use this only when
you want the two steps separated (e.g. swap the audio bed without re-rendering).`)
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
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
