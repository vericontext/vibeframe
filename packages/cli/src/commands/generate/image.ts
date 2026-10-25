/**
 * @module generate/image
 * @description `vibe generate image` (alias `img`) — image generation on
 * OpenAI GPT Image, Gemini Nano Banana, or Grok Imagine. Validation,
 * provider choice, and the dry run live here; generation is
 * `executeImageGenerate`, the same executor the MCP tool and pipelines use.
 */

import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { findModel, getProvidersFor, modelAliases } from "@vibeframe/ai-providers";
import { requireApiKey, hasConfiguredApiKey } from "../../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import { checkModelLifecycle } from "../../utils/model-lifecycle.js";
import {
  isJsonMode,
  outputSuccess,
  printWarnings,
  exitWithError,
  providerFailure,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { defaultOutputPath } from "../_shared/default-output.js";
import { loadProviderDefaults, resolveProvider } from "../../utils/provider-resolver.js";
import { estimateImageCostUsd } from "../_shared/image-cost.js";
import { executeImageGenerate } from "../ai-image.js";
import { IMAGE_PROVIDER_ENV, IMAGE_PROVIDER_LABELS, imageModelLabel } from "../_shared/image-jobs.js";

export function registerImageCommand(parent: Command): void {
  parent
    .command("image")
    .alias("img")
    .description("Generate image using AI (OpenAI GPT Image, Gemini, or Grok)")
    .argument("[prompt]", "Image description prompt (interactive if omitted)")
    .option("-p, --provider <provider>", "Provider: openai (default when OPENAI_API_KEY set), gemini, grok")
    .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY, XAI_API_KEY)")
    .option("-o, --output <path>", "Output file path (default: image.png, or the next free image-N.png)")
    .option("-r, --ratio <ratio>", "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, ... (OpenAI maps it to its nearest size)", "1:1")
    .option("--size <size>", "Explicit OpenAI size: 1024x1024, 1536x1024, 1024x1536 (overrides --ratio)")
    // `-q` shorthand intentionally omitted: collides with global `vibe -q,--quiet`,
    // which previously ate the value silently and dropped the prompt positional.
    .option("--quality <quality>", "Quality: low, medium, high (OpenAI and Grok; standard/hd still accepted)")
    .option("--resolution <res>", "Gemini 1K/2K/4K (512px on 3.1 Flash, Lite 1K only) or Grok 1k/2k")
    .option("--count <n>", "Number of images to generate", "1")
    .option("-m, --model <model>", "Model. OpenAI: 2.5 (default), flare, 2. Gemini: flash (default), lite, pro. Grok: pro")
    .option("--dry-run", "Preview parameters without executing")
    .addHelpText(
      "after",
      `
Examples:
  $ vibe generate image "a sunset over the ocean" -o sunset.png
  $ vibe gen img "logo design" -o logo.png -p openai
  $ vibe gen img "landscape photo" -o wide.png -r 16:9
  $ vibe gen img "portrait" -o portrait.png -p gemini -m pro
  $ vibe gen img "product shot" --dry-run --json`
    )
    .action(async (prompt: string | undefined, options) => {
      const startedAt = Date.now();
      // Interactive prompt if no argument provided
      if (!prompt) {
        if (hasTTY()) {
          prompt = await promptText(chalk.cyan("What would you like to generate? "));
          if (!prompt?.trim()) exitWithError(usageError("Prompt is required."));
        } else {
          exitWithError(usageError("Prompt argument is required.", "Usage: vibe generate image <prompt>"));
        }
      }
      rejectControlChars(prompt);
      if (options.output) validateOutputPath(options.output);
      await loadProviderDefaults();

      // Validate before the dry run, so a plan never echoes values a real run would reject.
      const count = parseInt(options.count, 10);
      if (!Number.isFinite(count) || count < 1 || count > 10) {
        exitWithError(usageError(`Invalid --count: ${options.count}`, "Must be an integer between 1 and 10."));
      }
      if (options.ratio && !/^\d+:\d+$/.test(options.ratio)) {
        exitWithError(usageError(`Invalid --ratio "${options.ratio}". Use W:H, e.g. 16:9.`));
      }

      // Provider: an explicit -p wins and is never swapped for another paid
      // provider; otherwise the image registry's priority order.
      const imageRegistry = getProvidersFor("image");
      const validProviders = imageRegistry.map((p) => p.name).filter((name) => IMAGE_PROVIDER_ENV[name]);
      let provider: string;
      if (options.provider) {
        provider = String(options.provider).toLowerCase();
        if (!validProviders.includes(provider)) {
          exitWithError(usageError(`Invalid provider: ${provider}`, `Available providers: ${validProviders.join(", ")}`));
        }
      } else {
        provider = resolveProvider("image")?.name ?? "gemini";
      }

      const modelSpec = findModel(provider, "image", options.model);
      if (!modelSpec) {
        exitWithError(usageError(`Unknown ${provider} image model "${options.model}". Valid: ${modelAliases(provider, "image").join(", ")}.`));
      }
      const lifecycleWarnings = checkModelLifecycle(modelSpec);
      // A paid image is never dropped: without -o it goes to the first free
      // image.png, image-2.png, ... in the working directory.
      const output: string = options.output ?? defaultOutputPath("image.png", count);
      const params = {
        prompt,
        provider,
        model: modelSpec.id,
        ratio: options.ratio,
        size: options.size,
        quality: options.quality,
        resolution: options.resolution,
        count,
        output,
      };

      if (options.dryRun) {
        const estimate = estimateImageCostUsd(provider, options.model, count, options.resolution, options.size);
        if (!(await hasConfiguredApiKey(IMAGE_PROVIDER_ENV[provider], options.apiKey))) {
          lifecycleWarnings.push(
            `${IMAGE_PROVIDER_ENV[provider]} is not set; the real run will fail until it is (vibe setup).`
          );
        }
        outputSuccess({
          command: "generate image",
          startedAt,
          dryRun: true,
          costUsd: estimate.costUsd,
          warnings: [...lifecycleWarnings, ...estimate.warnings],
          data: { params },
        });
        return;
      }
      printWarnings(lifecycleWarnings);

      const label = IMAGE_PROVIDER_LABELS[provider] ?? provider;
      const apiKey = await requireApiKey(IMAGE_PROVIDER_ENV[provider], label, options.apiKey);
      const spinner = isJsonMode() ? null : ora(`Generating image with ${label} ${modelSpec.label}...`).start();
      const result = await executeImageGenerate({
        prompt,
        provider,
        model: options.model,
        ratio: options.ratio,
        size: options.size,
        quality: options.quality,
        resolution: options.resolution,
        count,
        output,
        apiKey,
      });
      if (!result.success || !result.images) {
        spinner?.fail(result.error ?? "Image generation failed");
        exitWithError(providerFailure(result.error ?? "Image generation failed", result.errorKind));
      }

      const modelId = result.model ?? modelSpec.id;
      const cost = estimateImageCostUsd(provider, options.model, result.images.length, options.resolution, options.size);
      if (isJsonMode()) {
        outputSuccess({
          command: "generate image",
          startedAt,
          costUsd: cost.costUsd,
          warnings: [...lifecycleWarnings, ...cost.warnings],
          data: {
            provider,
            model: imageModelLabel(provider, modelId),
            modelId,
            images: result.images.map((img) => ({ mimeType: img.mimeType, revisedPrompt: img.revisedPrompt })),
            outputPath: result.outputPath,
            outputPaths: result.outputPaths,
          },
        });
        return;
      }

      spinner?.succeed(chalk.green(`Generated ${result.images.length} image(s) with ${label} ${imageModelLabel(provider, modelId)}`));
      for (const [i, img] of result.images.entries()) {
        if (img.revisedPrompt) console.log(chalk.dim(`  [${i + 1}] Revised prompt: ${img.revisedPrompt.slice(0, 100)}`));
      }
      for (const path of result.outputPaths ?? []) console.log(chalk.green(`Saved to: ${path}`));
    });
}
