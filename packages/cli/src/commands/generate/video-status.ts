/**
 * @module generate/video-status
 * @description `vibe generate video-status` (hidden) — check Grok/Runway/
 * Kling video generation status, optionally wait + download. Split out of
 * `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import {
  GrokProvider,
  RunwayProvider,
  KlingProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import {
  isJsonMode,
  outputSuccess,
  exitWithError,
  apiError,
  usageError,
} from "../output.js";
import { downloadVideo } from "../ai-helpers.js";

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return chalk.green(status);
    case "processing":
    case "running":
    case "in_progress":
      return chalk.yellow(status);
    case "failed":
    case "error":
      return chalk.red(status);
    default:
      return chalk.gray(status);
  }
}

export function registerVideoStatusCommand(parent: Command): void {
  parent
    .command("video-status", { hidden: true })
    .description("Check video generation status (Grok, Runway, or Kling)")
    .argument("<task-id>", "Task ID from video generation")
    .option("-p, --provider <provider>", "Provider: grok, runway, kling", "grok")
    .option("-k, --api-key <key>", "API key (or set XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY env)")
    .option("-t, --type <type>", "Task type: text2video or image2video (Kling only)", "text2video")
    .option("-w, --wait", "Wait for completion")
    .option("-o, --output <path>", "Download video when complete")
    .action(async (taskId: string, options) => {
      const startedAt = Date.now();
      try {
        const provider = (options.provider || "grok").toLowerCase();

        if (provider === "grok") {
          const apiKey = await requireApiKey("XAI_API_KEY", "xAI", options.apiKey);

          const spinner = ora("Checking status...").start();

          const grok = new GrokProvider();
          await grok.initialize({ apiKey });

          let result = await grok.getGenerationStatus(taskId);

          if (options.wait && result.status !== "completed" && result.status !== "failed") {
            spinner.text = "Waiting for completion...";
            result = await grok.waitForCompletion(taskId, (status) => {
              spinner.text = `Generating... ${status.status}`;
            });
          }

          spinner.stop();

          if (isJsonMode()) {
            let outputPath: string | undefined;
            if (options.output && result.videoUrl) {
              const buffer = await downloadVideo(result.videoUrl);
              outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
            }
            outputSuccess({
              command: "generate video-status",
              startedAt,
              data: {
                taskId,
                provider: "grok",
                status: result.status,
                videoUrl: result.videoUrl,
                error: result.error,
                outputPath,
              },
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generation Status"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Task ID: ${taskId}`);
          console.log(`Provider: Grok Imagine`);
          console.log(`Status: ${getStatusColor(result.status)}`);
          if (result.videoUrl) {
            console.log(`Video URL: ${result.videoUrl}`);
          }
          if (result.error) {
            console.log(`Error: ${chalk.red(result.error)}`);
          }
          console.log();

          if (options.output && result.videoUrl) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(result.videoUrl);
              const outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
              downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              downloadSpinner.fail(
                chalk.red(
                  `Failed to download video: ${err instanceof Error ? err.message : err}`,
                ),
              );
            }
          }
        } else if (provider === "runway") {
          const apiKey = await requireApiKey(
            "RUNWAY_API_SECRET",
            "Runway",
            options.apiKey,
          );

          const spinner = ora("Checking status...").start();

          const runway = new RunwayProvider();
          await runway.initialize({ apiKey });

          let result = await runway.getGenerationStatus(taskId);

          if (
            options.wait &&
            result.status !== "completed" &&
            result.status !== "failed" &&
            result.status !== "cancelled"
          ) {
            spinner.text = "Waiting for completion...";
            result = await runway.waitForCompletion(taskId, (status) => {
              if (status.progress !== undefined) {
                spinner.text = `Generating... ${status.progress}%`;
              }
            });
          }

          spinner.stop();

          if (isJsonMode()) {
            let outputPath: string | undefined;
            if (options.output && result.videoUrl) {
              const buffer = await downloadVideo(result.videoUrl, apiKey);
              outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
            }
            outputSuccess({
              command: "generate video-status",
              startedAt,
              data: {
                taskId,
                provider: "runway",
                status: result.status,
                videoUrl: result.videoUrl,
                progress: result.progress,
                error: result.error,
                outputPath,
              },
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generation Status"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Task ID: ${taskId}`);
          console.log(`Provider: Runway`);
          console.log(`Status: ${getStatusColor(result.status)}`);
          if (result.progress !== undefined) {
            console.log(`Progress: ${result.progress}%`);
          }
          if (result.videoUrl) {
            console.log(`Video URL: ${result.videoUrl}`);
          }
          if (result.error) {
            console.log(`Error: ${chalk.red(result.error)}`);
          }
          console.log();

          if (options.output && result.videoUrl) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(result.videoUrl, apiKey);
              const outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
              downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              downloadSpinner.fail(
                chalk.red(
                  `Failed to download video: ${err instanceof Error ? err.message : err}`,
                ),
              );
            }
          }
        } else if (provider === "kling") {
          const apiKey = await requireApiKey("KLING_API_KEY", "Kling", options.apiKey);

          const spinner = ora("Checking status...").start();

          const kling = new KlingProvider();
          await kling.initialize({ apiKey });

          const taskType = options.type as "text2video" | "image2video";
          let result = await kling.getGenerationStatus(taskId, taskType);

          if (
            options.wait &&
            result.status !== "completed" &&
            result.status !== "failed" &&
            result.status !== "cancelled"
          ) {
            spinner.text = "Waiting for completion...";
            result = await kling.waitForCompletion(taskId, taskType, (status) => {
              spinner.text = `Generating... ${status.status}`;
            });
          }

          spinner.stop();

          if (isJsonMode()) {
            let outputPath: string | undefined;
            if (options.output && result.videoUrl) {
              const buffer = await downloadVideo(result.videoUrl, apiKey);
              outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
            }
            outputSuccess({
              command: "generate video-status",
              startedAt,
              data: {
                taskId,
                provider: "kling",
                status: result.status,
                videoUrl: result.videoUrl,
                duration: result.duration,
                error: result.error,
                outputPath,
              },
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generation Status"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Task ID: ${taskId}`);
          console.log(`Provider: Kling`);
          console.log(`Type: ${taskType}`);
          console.log(`Status: ${getStatusColor(result.status)}`);
          if (result.videoUrl) {
            console.log(`Video URL: ${result.videoUrl}`);
          }
          if (result.duration) {
            console.log(`Duration: ${result.duration}s`);
          }
          if (result.error) {
            console.log(`Error: ${chalk.red(result.error)}`);
          }
          console.log();

          if (options.output && result.videoUrl) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(result.videoUrl, apiKey);
              const outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
              downloadSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              downloadSpinner.fail(
                chalk.red(
                  `Failed to download video: ${err instanceof Error ? err.message : err}`,
                ),
              );
            }
          }
        } else {
          exitWithError(
            usageError(`Invalid provider: ${provider}. Use grok, runway, or kling.`),
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Failed to get status: ${msg}`, true));
      }
    });
}
