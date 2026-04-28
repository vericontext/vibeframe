/**
 * @module generate/video-extend
 * @description `vibe generate video-extend` (hidden) — extend video duration
 * via Kling or Veo (Gemini). Split out of `generate.ts` in v0.69 (Plan G
 * Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import {
  GeminiProvider,
  KlingProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import {
  isJsonMode,
  outputResult,
  exitWithError,
  apiError,
  authError,
  usageError,
} from "../output.js";
import { validateOutputPath } from "../validate.js";
import { downloadVideo } from "../ai-helpers.js";

export function registerVideoExtendCommand(parent: Command): void {
  parent
    .command("video-extend", { hidden: true })
    .description("Extend video duration (Kling by video ID, Veo by operation name)")
    .argument("<id>", "Kling video ID or Veo operation name")
    .option("-p, --provider <provider>", "Provider: kling, veo", "kling")
    .option("-k, --api-key <key>", "API key (KLING_API_KEY or GOOGLE_API_KEY)")
    .option("-o, --output <path>", "Output file path")
    .option("--prompt <text>", "Continuation prompt")
    .option("-d, --duration <sec>", "Duration: 5 or 10 (Kling), 4/6/8 (Veo)", "5")
    .option("-n, --negative <prompt>", "Negative prompt (what to avoid, Kling only)")
    .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast", "3.1")
    .option("--no-wait", "Start extension and return task ID without waiting")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (id: string, options) => {
      try {
        const provider = (options.provider || "kling").toLowerCase();
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputResult({
            dryRun: true,
            command: "generate video-extend",
            params: {
              id,
              provider,
              prompt: options.prompt,
              duration: options.duration,
              negative: options.negative,
              veoModel: options.veoModel,
            },
          });
          return;
        }

        if (provider === "kling") {
          const apiKey = await requireApiKey("KLING_API_KEY", "Kling", options.apiKey);

          const spinner = ora("Initializing Kling AI...").start();

          const kling = new KlingProvider();
          await kling.initialize({ apiKey });

          if (!kling.isConfigured()) {
            spinner.fail("Invalid API key format");
            exitWithError(authError("KLING_API_KEY", "Kling"));
          }

          spinner.text = "Starting video extension...";

          const result = await kling.extendVideo(id, {
            prompt: options.prompt,
            negativePrompt: options.negative,
            duration: options.duration as "5" | "10",
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start extension");
            exitWithError(apiError(result.error || "Failed to start extension", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Video Extension Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: Kling`);
          console.log(`Task ID: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Extension started"));
            console.log();
            console.log(chalk.dim("Check status with:"));
            console.log(chalk.dim(`  vibe generate video-status ${result.id} -p kling`));
            console.log();
            return;
          }

          spinner.text = "Extending video (this may take 2-5 minutes)...";

          const finalResult = await kling.waitForExtendCompletion(
            result.id,
            (status) => {
              spinner.text = `Extending video... ${status.status}`;
            },
            600000,
          );

          if (finalResult.status !== "completed") {
            spinner.fail(finalResult.error || "Extension failed");
            exitWithError(apiError(finalResult.error || "Extension failed", true));
          }

          spinner.succeed(chalk.green("Video extended"));

          if (isJsonMode()) {
            let outputPath: string | undefined;
            if (options.output && finalResult.videoUrl) {
              const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
              outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
            }
            outputResult({
              success: true,
              provider: "kling",
              taskId: result.id,
              videoUrl: finalResult.videoUrl,
              duration: finalResult.duration,
              outputPath,
            });
            return;
          }

          console.log();
          if (finalResult.videoUrl) {
            console.log(`Video URL: ${finalResult.videoUrl}`);
          }
          if (finalResult.duration) {
            console.log(`Duration: ${finalResult.duration}s`);
          }
          console.log();

          if (options.output && finalResult.videoUrl) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
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
        } else if (provider === "veo") {
          const apiKey = await requireApiKey("GOOGLE_API_KEY", "Google", options.apiKey);

          const spinner = ora("Initializing Veo...").start();

          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey });

          const veoModelMap: Record<string, string> = {
            "3.0": "veo-3.0-generate-preview",
            "3.1": "veo-3.1-generate-preview",
            "3.1-fast": "veo-3.1-fast-generate-preview",
          };
          const veoModel = veoModelMap[options.veoModel] || "veo-3.1-generate-preview";

          spinner.text = "Starting video extension...";

          const result = await gemini.extendVideo(id, options.prompt, {
            duration: parseInt(options.duration) as 4 | 6 | 8,
            model: veoModel as
              | "veo-3.0-generate-preview"
              | "veo-3.1-generate-preview"
              | "veo-3.1-fast-generate-preview",
          });

          if (result.status === "failed") {
            spinner.fail(result.error || "Failed to start extension");
            exitWithError(apiError(result.error || "Failed to start extension", true));
          }

          console.log();
          console.log(chalk.bold.cyan("Veo Video Extension Started"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Provider: Veo`);
          console.log(`Operation: ${chalk.bold(result.id)}`);

          if (!options.wait) {
            spinner.succeed(chalk.green("Extension started"));
            console.log();
            console.log(chalk.dim("Check status or wait with:"));
            console.log(chalk.dim(`  vibe generate video-extend ${result.id} -p veo`));
            console.log();
            return;
          }

          spinner.text = "Extending video (this may take 1-3 minutes)...";
          const finalResult = await gemini.waitForVideoCompletion(
            result.id,
            (status) => {
              spinner.text = `Extending video... ${status.status}`;
            },
            300000,
          );

          if (finalResult.status !== "completed") {
            spinner.fail(finalResult.error || "Extension failed");
            exitWithError(apiError(finalResult.error || "Extension failed", true));
          }

          spinner.succeed(chalk.green("Video extended"));

          if (isJsonMode()) {
            let outputPath: string | undefined;
            if (options.output && finalResult.videoUrl) {
              const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
              outputPath = resolve(process.cwd(), options.output);
              await writeFile(outputPath, buffer);
            }
            outputResult({
              success: true,
              provider: "veo",
              taskId: result.id,
              videoUrl: finalResult.videoUrl,
              duration: finalResult.duration,
              outputPath,
            });
            return;
          }

          console.log();
          if (finalResult.videoUrl) {
            console.log(`Video URL: ${finalResult.videoUrl}`);
          }
          console.log();

          if (options.output && finalResult.videoUrl) {
            const downloadSpinner = ora("Downloading video...").start();
            try {
              const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
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
            usageError(`Invalid provider: ${provider}. Video extend supports: kling, veo`),
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Video extension failed: ${msg}`, true));
      }
    });
}
