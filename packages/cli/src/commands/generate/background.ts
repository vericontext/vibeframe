/**
 * @module generate/background
 * @description `vibe generate background` — OpenAI gpt-image-2 backdrop
 * generation. Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve, dirname } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { OpenAIImageProvider } from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import { isJsonMode, outputResult, exitWithError, apiError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";

// ── Library: executeBackground ──────────────────────────────────────────

export interface ExecuteBackgroundOptions {
  description: string;
  aspect?: "16:9" | "9:16" | "1:1" | string;
  output?: string;
  apiKey?: string;
}
export interface ExecuteBackgroundResult {
  success: boolean;
  imageUrl?: string;
  outputPath?: string;
  base64?: string;
  revisedPrompt?: string;
  error?: string;
}

export async function executeBackground(
  options: ExecuteBackgroundOptions,
): Promise<ExecuteBackgroundResult> {
  try {
    const apiKey =
      options.apiKey ??
      (hasApiKey("OPENAI_API_KEY")
        ? ((await getApiKeyFromConfig("openai")) || process.env.OPENAI_API_KEY!)
        : null);
    if (!apiKey)
      return { success: false, error: "OPENAI_API_KEY required for background generation" };

    const openaiImage = new OpenAIImageProvider();
    await openaiImage.initialize({ apiKey });

    const aspect: "16:9" | "9:16" | "1:1" =
      options.aspect === "9:16" || options.aspect === "1:1" ? options.aspect : "16:9";
    const result = await openaiImage.generateBackground(options.description, aspect);
    if (!result.success || !result.images || result.images.length === 0) {
      return { success: false, error: result.error || "Background generation failed" };
    }

    const img = result.images[0];

    let outputPath: string | undefined;
    if (options.output) {
      let buffer: Buffer;
      if (img.url) {
        buffer = Buffer.from(await (await fetch(img.url)).arrayBuffer());
      } else if (img.base64) {
        buffer = Buffer.from(img.base64, "base64");
      } else {
        return { success: false, error: "Provider returned no image data" };
      }
      outputPath = resolve(process.cwd(), options.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, buffer);
    }

    return {
      success: true,
      imageUrl: img.url,
      outputPath,
      base64: img.base64,
      revisedPrompt: img.revisedPrompt,
    };
  } catch (error) {
    return {
      success: false,
      error: `Background generation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate background ───────────────────────────────────────

export function registerBackgroundCommand(parent: Command): void {
  parent
    .command("background")
    .description("Generate video background using DALL-E")
    .argument("<description>", "Background description")
    .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
    .option("-o, --output <path>", "Output file path (downloads image)")
    .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (description: string, options) => {
      try {
        rejectControlChars(description);
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputResult({
            dryRun: true,
            command: "generate background",
            params: { description, aspect: options.aspect, output: options.output },
          });
          return;
        }

        const apiKey = await requireApiKey(
          "OPENAI_API_KEY",
          "OpenAI",
          options.apiKey,
        );

        const spinner = ora("Generating background...").start();

        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });

        const result = await openaiImage.generateBackground(description, options.aspect);

        if (!result.success || !result.images) {
          spinner.fail(result.error || "Background generation failed");
          exitWithError(apiError(result.error || "Background generation failed", true));
        }

        spinner.succeed(chalk.green("Background generated"));

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
          outputResult({ success: true, imageUrl: img.url, outputPath });
          return;
        }

        console.log();
        console.log(chalk.bold.cyan("Generated Background"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Image: ${img.url || "(base64 data)"}`);
        if (img.revisedPrompt) {
          console.log(chalk.dim(`Prompt: ${img.revisedPrompt.slice(0, 100)}...`));
        }
        console.log();

        // Save if output specified
        if (options.output) {
          const saveSpinner = ora("Saving background...").start();
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
            saveSpinner.fail(chalk.red("Failed to save background"));
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Background generation failed: ${msg}`, true));
      }
    });
}
