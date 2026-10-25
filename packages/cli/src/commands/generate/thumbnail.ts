/**
 * @module generate/thumbnail
 * @description `vibe generate thumbnail` — OpenAI image generation OR
 * best-frame extraction from video via Gemini analysis.
 */

import type { Command } from "commander";
import { resolve, basename, extname } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { GEMINI_TEXT_MODEL_HELP } from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import { commandExists } from "../../utils/exec-safe.js";
import {
  failureFromError,
  spinner as createSpinner,
  isJsonMode,
  outputSuccess,
  exitWithError,
  apiError,
  notFoundError,
  generalError,
  providerFailure,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { defaultOutputPath } from "../_shared/default-output.js";
import { executeImageGenerate, executeThumbnailBestFrame } from "../ai-image.js";
import { estimateImageCostUsd } from "../_shared/image-cost.js";

type ThumbnailStyle = "youtube" | "instagram" | "tiktok" | "twitter";

/** Prompt hint and OpenAI size for each platform style. */
const THUMBNAIL_STYLES: Record<ThumbnailStyle, { hint: string; size: string }> = {
  youtube: { hint: "YouTube thumbnail style, bold text overlay area, vibrant colors, high contrast, attention-grabbing", size: "1536x1024" },
  instagram: { hint: "Instagram post style, clean aesthetic, lifestyle photography feel, square format optimized", size: "1024x1024" },
  tiktok: { hint: "TikTok cover style, vertical format, trendy, dynamic, youth-oriented", size: "1024x1536" },
  twitter: { hint: "Twitter/X card style, professional, clean, horizontal format", size: "1536x1024" },
};

// Best-frame mode delegates to `executeThumbnailBestFrame`; generation mode
// is `executeImageGenerate` on OpenAI, the same executor `generate image` uses.

export function registerThumbnailCommand(parent: Command): void {
  parent
    .command("thumbnail")
    .description("Generate video thumbnail (OpenAI image) or extract best frame from video (Gemini)")
    .argument("[description]", "Thumbnail description (for image generation)")
    .option("-k, --api-key <key>", "API key (OpenAI for generation, Google for best-frame)")
    .option("-o, --output <path>", "Output file path (default: thumbnail.png or the next free thumbnail-N.png; <video>-thumbnail.png with --best-frame)")
    .option("--style <style>", "Platform style: youtube, instagram, tiktok, twitter")
    .option("--best-frame <video>", "Extract best thumbnail frame from video using Gemini AI")
    .option("--prompt <prompt>", "Custom prompt for best-frame analysis")
    .option("--model <model>", `Gemini model: ${GEMINI_TEXT_MODEL_HELP}`, "flash")
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

          const spinner = createSpinner("Analyzing video for best frame...").start();

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

        // Generation mode: create the thumbnail with OpenAI image generation
        if (!description) {
          exitWithError(
            usageError(
              "Description required for thumbnail generation.",
              "Usage: vibe generate thumbnail <description> or vibe generate thumbnail --best-frame <video>",
            ),
          );
        }
        const style = options.style as ThumbnailStyle | undefined;
        if (style && !THUMBNAIL_STYLES[style]) {
          exitWithError(usageError(`Invalid --style: ${style}`, `Must be one of: ${Object.keys(THUMBNAIL_STYLES).join(", ")}`));
        }

        const size = style ? THUMBNAIL_STYLES[style].size : "1536x1024";
        const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
        const spinner = isJsonMode() ? null : createSpinner("Generating thumbnail...").start();
        const result = await executeImageGenerate({
          prompt: `Create a video thumbnail: ${description}. Style: ${style ? THUMBNAIL_STYLES[style].hint : "professional video thumbnail"}. No text in the image.`,
          provider: "openai",
          size,
          quality: "high",
          output: options.output ?? defaultOutputPath("thumbnail.png"),
          apiKey,
        });
        if (!result.success || !result.images) {
          spinner?.fail(result.error ?? "Thumbnail generation failed");
          exitWithError(providerFailure(result.error ?? "Thumbnail generation failed", result.errorKind));
        }

        const cost = estimateImageCostUsd("openai", undefined, result.images.length, undefined, size);
        if (isJsonMode()) {
          outputSuccess({
            command: "generate thumbnail",
            startedAt,
            costUsd: cost.costUsd,
            warnings: cost.warnings,
            data: { provider: "openai", model: result.model, outputPath: result.outputPath },
          });
          return;
        }

        spinner?.succeed(chalk.green("Thumbnail generated"));
        const revisedPrompt = result.images[0]?.revisedPrompt;
        if (revisedPrompt) console.log(chalk.dim(`  Revised prompt: ${revisedPrompt.slice(0, 100)}`));
        if (result.outputPath) console.log(chalk.green(`Saved to: ${result.outputPath}`));
      } catch (error) {
        exitWithError(failureFromError(error, "Thumbnail generation failed", { retryable: true }));
      }
    });
}
