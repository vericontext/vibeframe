/**
 * @module generate/image
 * @description `vibe generate image` (alias `img`) — multi-provider image
 * generation. OpenAI gpt-image-2, Gemini Nano Banana, Grok, Runway. Split
 * out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import {
  GeminiProvider,
  GrokProvider,
  getProvidersFor,
} from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import {
  isJsonMode,
  outputResult,
  log,
  exitWithError,
  apiError,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { resolveProvider } from "../../utils/provider-resolver.js";
import { executeOpenAIImageGenerate } from "../_shared/openai-image.js";

export function registerImageCommand(parent: Command): void {
  parent
    .command("image")
    .alias("img")
    .description("Generate image using AI (Gemini, OpenAI gpt-image, Grok, or Runway)")
    .argument("[prompt]", "Image description prompt (interactive if omitted)")
    .option("-p, --provider <provider>", "Provider: openai (default when OPENAI_API_KEY set), gemini, grok, runway")
    .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY)")
    .option("-o, --output <path>", "Output file path (downloads image)")
    .option("-s, --size <size>", "Image size (openai: 1024x1024, 1536x1024, 1024x1536)", "1024x1024")
    .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 3:4, 4:3, etc.)", "1:1")
    // `-q` shorthand intentionally omitted: collides with global `vibe -q,--quiet`,
    // which previously ate the value silently and dropped the prompt positional.
    .option("--quality <quality>", "Quality: standard, hd (openai only)", "standard")
    .option("--style <style>", "Style: vivid, natural (openai only)", "vivid")
    .option("-n, --count <n>", "Number of images to generate", "1")
    .option("-m, --model <model>", "Model. Gemini: flash, 3.1-flash, latest, pro. OpenAI: 1.5 (default), 2 (gpt-image-2)")
    .option("--dry-run", "Preview parameters without executing")
    .addHelpText("after", `
Examples:
  $ vibe generate image "a sunset over the ocean" -o sunset.png
  $ vibe gen img "logo design" -o logo.png -p openai
  $ vibe gen img "landscape photo" -o wide.png -r 16:9
  $ vibe gen img "portrait" -o portrait.png -p gemini -m pro
  $ vibe gen img "product shot" --dry-run --json`)
    .action(async (prompt: string | undefined, options) => {
      try {
        // Interactive prompt if no argument provided
        if (!prompt) {
          if (hasTTY()) {
            prompt = await promptText(chalk.cyan("What would you like to generate? "));
            if (!prompt?.trim()) {
              exitWithError(usageError("Prompt is required."));
            }
          } else {
            exitWithError(
              usageError(
                "Prompt argument is required.",
                "Usage: vibe generate image <prompt>",
              ),
            );
          }
        }
        rejectControlChars(prompt);
        if (options.output) {
          validateOutputPath(options.output);
        }

        // Resolve provider:
        //  - explicit -p flag wins (validated, then key-presence checked)
        //  - no flag → image registry priority list (openai > gemini > grok)
        //  - if no keys at all → keep gemini as last-resort default so the
        //    later requireApiKey() prints a friendly Gemini-specific message
        //
        // The registry (`@vibeframe/ai-providers`) is the source of truth for
        // image-kind providers. `runway` is accepted by the CLI as an image
        // variant but isn't part of the auto-resolver; everything else flows
        // from the registry, so adding a new image provider auto-propagates.
        const imageRegistry = getProvidersFor("image");
        const validProviders = [...imageRegistry.map((p) => p.name), "runway"];
        const providerEnvMap: Record<string, string> = Object.fromEntries(
          imageRegistry
            .filter((p): p is typeof p & { envVar: string } => p.envVar !== null)
            .map((p) => [p.name, p.envVar]),
        );
        const envKeyMap: Record<string, string> = {
          ...providerEnvMap,
          runway: "RUNWAY_API_SECRET",
        };
        const providerNameMap: Record<string, string> = {
          ...Object.fromEntries(imageRegistry.map((p) => [p.name, p.label])),
          gemini: "Google",
          grok: "xAI Grok",
          runway: "Runway",
        };
        let provider: string;
        if (options.provider) {
          provider = options.provider.toLowerCase();
          if (!validProviders.includes(provider)) {
            exitWithError(
              usageError(
                `Invalid provider: ${provider}`,
                `Available providers: ${imageRegistry.map((p) => p.name).join(", ")}, runway`,
              ),
            );
          }
          // Explicit choice's key missing → fall back via resolver
          if (
            providerEnvMap[provider] &&
            !hasApiKey(providerEnvMap[provider]) &&
            !options.apiKey
          ) {
            const resolved = resolveProvider("image");
            if (resolved) {
              log(chalk.dim(`  ${provider} key not found. Using ${resolved.label} instead.`));
              provider = resolved.name;
            }
          }
        } else {
          const resolved = resolveProvider("image");
          provider = resolved?.name ?? "gemini";
        }

        // Dry-run check
        if (options.dryRun) {
          outputResult({
            dryRun: true,
            command: "generate image",
            params: {
              prompt,
              provider,
              model: options.model,
              ratio: options.ratio,
              size: options.size,
              quality: options.quality,
              count: options.count,
              output: options.output,
            },
          });
          return;
        }

        const envKey = envKeyMap[provider];
        const providerName = providerNameMap[provider];

        const apiKey = await requireApiKey(envKey, providerName, options.apiKey);

        const spinner = ora(`Generating image with ${providerName}...`).start();

        if (provider === "openai") {
          const { result, modelLabel } = await executeOpenAIImageGenerate(
            prompt,
            options,
            { apiKey },
          );

          if (!result.success || !result.images) {
            spinner.fail(result.error || "Image generation failed");
            exitWithError(apiError(result.error || "Image generation failed", true));
          }

          spinner.succeed(
            chalk.green(`Generated ${result.images.length} image(s) with OpenAI ${modelLabel}`),
          );

          if (isJsonMode()) {
            const outputPath = options.output
              ? resolve(process.cwd(), options.output)
              : undefined;
            if (outputPath && result.images.length > 0) {
              const img = result.images[0];
              let buffer: Buffer;
              if (img.url) {
                const response = await fetch(img.url);
                buffer = Buffer.from(await response.arrayBuffer());
              } else if (img.base64) {
                buffer = Buffer.from(img.base64, "base64");
              } else {
                throw new Error("No image data available");
              }
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, buffer);
            }
            outputResult({
              success: true,
              provider: "openai",
              images: result.images.map((img) => ({
                url: img.url,
                revisedPrompt: img.revisedPrompt,
              })),
              outputPath,
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generated Images"));
          console.log(chalk.dim("─".repeat(60)));

          for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            console.log();
            if (img.url) {
              console.log(`${chalk.yellow(`[${i + 1}]`)} ${img.url}`);
            } else if (img.base64) {
              console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image data)`);
            }
            if (img.revisedPrompt) {
              console.log(chalk.dim(`    Revised: ${img.revisedPrompt.slice(0, 100)}...`));
            }
          }
          console.log();

          // Save if output specified
          if (options.output && result.images.length > 0) {
            const img = result.images[0];
            const saveSpinner = ora("Saving image...").start();
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
            } catch (err) {
              saveSpinner.fail(
                chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`),
              );
            }
          }
        } else if (provider === "gemini") {
          // Validate model name
          const validGeminiModels = ["flash", "3.1-flash", "latest", "pro"];
          if (options.model && !validGeminiModels.includes(options.model)) {
            console.warn(
              chalk.yellow(
                `Unknown model "${options.model}", using flash. Valid: ${validGeminiModels.join(", ")}`,
              ),
            );
            options.model = "flash";
          }

          // Validate aspect ratio
          const validRatios = [
            "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5",
            "5:4", "8:1", "9:16", "16:9", "21:9",
          ];
          if (options.ratio && !validRatios.includes(options.ratio)) {
            exitWithError(
              usageError(`Invalid ratio "${options.ratio}". Valid: ${validRatios.join(", ")}`),
            );
          }

          const gemini = new GeminiProvider();
          await gemini.initialize({ apiKey });

          const geminiModelNames: Record<string, string> = {
            flash: "Nano Banana",
            "3.1-flash": "Nano Banana 2",
            latest: "Nano Banana 2",
            pro: "Nano Banana Pro",
          };
          const modelLabel = geminiModelNames[options.model] || "Nano Banana";

          let result = await gemini.generateImage(prompt, {
            model: options.model,
            aspectRatio: options.ratio as
              | "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1"
              | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
          });

          // Auto-fallback: if latest/3.1-flash fails, retry with flash
          let usedLabel = modelLabel;
          const fallbackModels = ["latest", "3.1-flash"];
          if (!result.success && options.model && fallbackModels.includes(options.model)) {
            spinner.text = `${chalk.dim(result.error || "Failed")} — retrying with Nano Banana (flash)...`;
            result = await gemini.generateImage(prompt, {
              model: "flash",
              aspectRatio: options.ratio as
                | "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1"
                | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
            });
            usedLabel = "Nano Banana (fallback)";
          }

          if (!result.success || !result.images) {
            spinner.fail(result.error || "Image generation failed");
            exitWithError(apiError(result.error || "Image generation failed", true));
          }

          spinner.succeed(
            chalk.green(`Generated ${result.images.length} image(s) with Gemini (${usedLabel})`),
          );

          if (isJsonMode()) {
            const outputPath = options.output
              ? resolve(process.cwd(), options.output)
              : undefined;
            if (outputPath && result.images.length > 0) {
              const img = result.images[0];
              const buffer = Buffer.from(img.base64, "base64");
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, buffer);
            }
            outputResult({
              success: true,
              provider: "gemini",
              images: result.images.map((img: { mimeType?: string }) => ({
                mimeType: img.mimeType,
              })),
              outputPath,
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generated Images"));
          console.log(chalk.dim("─".repeat(60)));

          for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            console.log();
            console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image, ${img.mimeType})`);
          }
          console.log();

          // Save if output specified
          if (options.output && result.images.length > 0) {
            const saveSpinner = ora("Saving image...").start();
            try {
              const img = result.images[0];
              const buffer = Buffer.from(img.base64, "base64");
              const outputPath = resolve(process.cwd(), options.output);
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, buffer);
              saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
            } catch (err) {
              saveSpinner.fail(
                chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`),
              );
            }
          } else {
            console.log(chalk.yellow("Use -o to save the generated image to a file"));
          }
        } else if (provider === "grok") {
          const grok = new GrokProvider();
          await grok.initialize({ apiKey });

          // Validate aspect ratio for Grok
          const validGrokRatios = [
            "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2",
            "19.5:9", "9:19.5", "20:9", "9:20", "auto",
          ];
          if (options.ratio && !validGrokRatios.includes(options.ratio)) {
            console.warn(
              chalk.yellow(
                `Unknown ratio "${options.ratio}" for Grok, using 1:1. Valid: ${validGrokRatios.join(", ")}`,
              ),
            );
            options.ratio = "1:1";
          }

          const result = await grok.generateImage(prompt, {
            aspectRatio: options.ratio || "1:1",
            n: parseInt(options.count),
          });

          if (!result.success || !result.images) {
            spinner.fail(result.error || "Image generation failed");
            exitWithError(apiError(result.error || "Image generation failed", true));
          }

          spinner.succeed(
            chalk.green(`Generated ${result.images.length} image(s) with xAI Grok`),
          );

          if (isJsonMode()) {
            const outputPath = options.output
              ? resolve(process.cwd(), options.output)
              : undefined;
            if (outputPath && result.images.length > 0) {
              const img = result.images[0];
              let buffer: Buffer;
              if (img.url) {
                const response = await fetch(img.url);
                buffer = Buffer.from(await response.arrayBuffer());
              } else if (img.base64) {
                buffer = Buffer.from(img.base64, "base64");
              } else {
                throw new Error("No image data available");
              }
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, buffer);
            }
            outputResult({
              success: true,
              provider: "grok",
              images: result.images.map((img) => ({ url: img.url })),
              outputPath,
            });
            return;
          }

          console.log();
          console.log(chalk.bold.cyan("Generated Images"));
          console.log(chalk.dim("─".repeat(60)));

          for (let i = 0; i < result.images.length; i++) {
            const img = result.images[i];
            console.log();
            if (img.url) {
              console.log(`${chalk.yellow(`[${i + 1}]`)} ${img.url}`);
            } else if (img.base64) {
              console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image data)`);
            }
          }
          console.log();

          // Save if output specified
          if (options.output && result.images.length > 0) {
            const img = result.images[0];
            const saveSpinner = ora("Saving image...").start();
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
            } catch (err) {
              saveSpinner.fail(
                chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`),
              );
            }
          }
        } else if (provider === "runway") {
          const { spawn } = await import("child_process");
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          const scriptPath = resolve(
            __dirname,
            "../../../../.claude/skills/runway-video/scripts/image.py",
          );

          if (!options.output) {
            spinner.fail("Output path required for Runway");
            exitWithError(usageError("Output path required for Runway. Use -o option."));
          }

          const outputPath = resolve(process.cwd(), options.output);
          const args = [scriptPath, prompt, "-o", outputPath, "-r", options.ratio || "16:9"];

          spinner.text = "Generating image with Runway (gemini_2.5_flash)...";

          await new Promise<void>((resolvePromise, reject) => {
            const proc = spawn("python3", args, {
              env: { ...process.env, RUNWAY_API_SECRET: apiKey },
              stdio: ["ignore", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (data) => {
              stdout += data.toString();
            });

            proc.stderr.on("data", (data) => {
              stderr += data.toString();
            });

            proc.on("close", (code) => {
              if (code === 0) {
                if (isJsonMode()) {
                  outputResult({
                    success: true,
                    provider: "runway",
                    images: [{ format: "file" }],
                    outputPath,
                  });
                } else {
                  spinner.succeed(chalk.green("Generated image with Runway"));
                  console.log(chalk.dim(stdout.trim()));
                }
                resolvePromise();
              } else {
                spinner.fail(chalk.red("Runway image generation failed"));
                console.error(chalk.red(stderr || stdout));
                reject(new Error("Runway generation failed"));
              }
            });

            proc.on("error", (err) => {
              spinner.fail(chalk.red("Failed to run Runway script"));
              reject(err);
            });
          });
        }
      } catch (error) {
        exitWithError(apiError(`Image generation failed: ${(error as Error).message}`));
      }
    });
}
