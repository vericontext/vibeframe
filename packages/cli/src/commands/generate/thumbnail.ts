/**
 * @module generate/thumbnail
 * @description `vibe generate thumbnail` — DALL-E generation OR
 * best-frame extraction from video via Gemini analysis. Split out of
 * `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve, dirname, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { OpenAIImageProvider } from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import { commandExists } from "../../utils/exec-safe.js";
import {
  isJsonMode,
  outputSuccess,
  exitWithError,
  apiError,
  notFoundError,
  generalError,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { executeThumbnailBestFrame } from "../ai-image.js";

// (No standalone executeThumbnail library function — the CLI delegates to
// `executeThumbnailBestFrame` in `../ai-image.ts` for the best-frame mode
// and to `OpenAIImageProvider.generateThumbnail` directly for DALL-E mode.)

export function registerThumbnailCommand(parent: Command): void {
  parent
    .command("thumbnail")
    .description("Generate video thumbnail (DALL-E) or extract best frame from video (Gemini)")
    .argument("[description]", "Thumbnail description (for DALL-E generation)")
    .option("-k, --api-key <key>", "API key (OpenAI for generation, Google for best-frame)")
    .option("-o, --output <path>", "Output file path")
    .option("-s, --style <style>", "Platform style: youtube, instagram, tiktok, twitter")
    .option("--best-frame <video>", "Extract best thumbnail frame from video using Gemini AI")
    .option("--prompt <prompt>", "Custom prompt for best-frame analysis")
    .option("--model <model>", "Gemini model: flash, latest, pro (default: flash)", "flash")
    .action(async (description: string | undefined, options) => {
      const startedAt = Date.now();
      try {
        if (description) rejectControlChars(description);
        if (options.output) {
          validateOutputPath(options.output);
        }

        // Best-frame mode: analyze video with Gemini and extract frame
        if (options.bestFrame) {
          const absVideoPath = resolve(process.cwd(), options.bestFrame);
          if (!existsSync(absVideoPath)) {
            exitWithError(notFoundError(absVideoPath));
          }

          if (!commandExists("ffmpeg")) {
            exitWithError(
              generalError(
                "FFmpeg not found",
                "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
              ),
            );
          }

          const apiKey = await requireApiKey("GOOGLE_API_KEY", "Google", options.apiKey);

          const name = basename(options.bestFrame, extname(options.bestFrame));
          const outputPath = options.output || `${name}-thumbnail.png`;

          const spinner = ora("Analyzing video for best frame...").start();

          const result = await executeThumbnailBestFrame({
            videoPath: absVideoPath,
            outputPath: resolve(process.cwd(), outputPath),
            prompt: options.prompt,
            model: options.model,
            apiKey,
          });

          if (!result.success) {
            spinner.fail(result.error || "Best frame extraction failed");
            exitWithError(apiError(result.error || "Best frame extraction failed", true));
          }

          spinner.succeed(chalk.green("Best frame extracted"));

          if (isJsonMode()) {
            outputSuccess({
              command: "generate thumbnail",
              startedAt,
              data: {
                timestamp: result.timestamp,
                reason: result.reason,
                outputPath: result.outputPath,
              },
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Best Frame Result"));
          console.log(chalk.dim("─".repeat(60)));
          console.log(`Timestamp: ${chalk.bold(result.timestamp!.toFixed(2))}s`);
          if (result.reason) console.log(`Reason: ${chalk.dim(result.reason)}`);
          console.log(`Output: ${chalk.green(result.outputPath!)}`);
          console.log();
          return;
        }

        // Generation mode: create thumbnail with DALL-E
        if (!description) {
          exitWithError(
            usageError(
              "Description required for thumbnail generation.",
              "Usage: vibe generate thumbnail <description> or vibe generate thumbnail --best-frame <video>",
            ),
          );
        }

        const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);

        const spinner = ora("Generating thumbnail...").start();

        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });

        const result = await openaiImage.generateThumbnail(description, options.style);

        if (!result.success || !result.images) {
          spinner.fail(result.error || "Thumbnail generation failed");
          exitWithError(apiError(result.error || "Thumbnail generation failed", true));
        }

        spinner.succeed(chalk.green("Thumbnail generated"));

        const img = result.images[0];

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output) {
            let buffer: Buffer;
            if (img.url) {
              const response = await fetch(img.url);
              buffer = Buffer.from(await response.arrayBuffer());
            } else if (img.base64) {
              buffer = Buffer.from(img.base64, "base64");
            } else {
              throw new Error("No image data available");
            }
            outputPath = resolve(process.cwd(), options.output);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, buffer);
          }
          outputSuccess({
            command: "generate thumbnail",
            startedAt,
            data: { imageUrl: img.url, outputPath },
          });
          return;
        }

        console.log();
        console.log(chalk.bold.cyan("Generated Thumbnail"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`URL: ${img.url}`);
        if (img.revisedPrompt) {
          console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
        }
        console.log();

        // Save if output specified
        if (options.output) {
          const saveSpinner = ora("Saving thumbnail...").start();
          try {
            let buffer: Buffer;
            if (img.url) {
              const response = await fetch(img.url);
              buffer = Buffer.from(await response.arrayBuffer());
            } else if (img.base64) {
              buffer = Buffer.from(img.base64, "base64");
            } else {
              throw new Error("No image data available");
            }
            const outputPath = resolve(process.cwd(), options.output);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch {
            saveSpinner.fail(chalk.red("Failed to save thumbnail"));
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Thumbnail generation failed: ${msg}`, true));
      }
    });
}
