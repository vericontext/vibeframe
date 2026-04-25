/**
 * @module ai-image
 * @description Image generation and editing commands for the VibeFrame CLI.
 *
 * ## Commands: vibe ai image, vibe ai thumbnail, vibe ai background,
 *             vibe ai gemini, vibe ai gemini-edit
 * ## Dependencies: OpenAI, Gemini, FFmpeg
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerImageCommands(aiCommand).
 * @see MODELS.md for AI model configuration
 */

import { type Command } from 'commander';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  GeminiProvider,
  OpenAIImageProvider,
} from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';
import { execSafe, commandExists } from '../utils/exec-safe.js';
import { exitWithError, authError, notFoundError, apiError, usageError, generalError, outputResult } from './output.js';
import { validateOutputPath } from "./validate.js";

function _registerImageCommands(aiCommand: Command): void {

aiCommand
  .command("image")
  .description("Generate image using AI (Gemini or DALL-E)")
  .argument("<prompt>", "Image description prompt")
  .option("-p, --provider <provider>", "Provider: gemini, openai, runway (dalle is deprecated)", "gemini")
  .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --size <size>", "Image size (openai: 1024x1024, 1536x1024, 1024x1536)", "1024x1024")
  .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 3:4, 4:3, etc.)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard, hd (openai only)", "standard")
  .option("--style <style>", "Style: vivid, natural (openai only)", "vivid")
  .option("-n, --count <n>", "Number of images to generate", "1")
  .option("-m, --model <model>", "Model. Gemini: flash, 3.1-flash, latest, pro. OpenAI: 1.5 (default), 2 (gpt-image-2)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      const provider = options.provider.toLowerCase();
      const validProviders = ["openai", "dalle", "gemini", "runway"];
      if (!validProviders.includes(provider)) {
        exitWithError(usageError(`Invalid provider: ${provider}`, "Available providers: openai, gemini, runway"));
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai image", params: { prompt, provider, output: options.output, size: options.size, ratio: options.ratio, quality: options.quality, style: options.style, count: options.count, model: options.model } });
        return;
      }

      // Show deprecation warning for "dalle"
      if (provider === "dalle") {
        console.log(chalk.yellow('Warning: "dalle" is deprecated. Use "openai" instead.'));
      }

      // Get API key based on provider
      const envKeyMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        dalle: "OPENAI_API_KEY", // backward compatibility
        gemini: "GOOGLE_API_KEY",
        runway: "RUNWAY_API_SECRET",
      };
      const providerNameMap: Record<string, string> = {
        openai: "OpenAI",
        dalle: "OpenAI", // backward compatibility
        gemini: "Google",
        runway: "Runway",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];

      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        exitWithError(authError(envKey, providerName));
      }

      const spinner = ora(`Generating image with ${providerName}...`).start();

      if (provider === "dalle" || provider === "openai") {
        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });

        const modelAlias = options.model;
        const openaiModel =
          modelAlias === "2" || modelAlias === "gpt-image-2"
            ? "gpt-image-2"
            : undefined;

        const result = await openaiImage.generateImage(prompt, {
          model: openaiModel,
          size: options.size,
          quality: options.quality,
          style: options.style,
          n: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail("Image generation failed");
          exitWithError(apiError(result.error || "Image generation failed", true));
        }

        const modelLabel = openaiModel === "gpt-image-2" ? "GPT Image 2" : "GPT Image 1.5";
        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with OpenAI ${modelLabel}`));

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
              // Download from URL
              const response = await fetch(img.url);
              buffer = Buffer.from(await response.arrayBuffer());
            } else if (img.base64) {
              // Decode base64
              buffer = Buffer.from(img.base64, "base64");
            } else {
              throw new Error("No image data available");
            }
            const outputPath = resolve(process.cwd(), options.output);
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else if (provider === "gemini") {
        // Validate model name
        const validGeminiModels = ["flash", "3.1-flash", "latest", "pro"];
        if (options.model && !validGeminiModels.includes(options.model)) {
          console.warn(chalk.yellow(`Unknown model "${options.model}", using flash. Valid: ${validGeminiModels.join(", ")}`));
          options.model = "flash";
        }

        // Validate aspect ratio
        const validRatios = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
        if (options.ratio && !validRatios.includes(options.ratio)) {
          exitWithError(usageError(`Invalid ratio "${options.ratio}". Valid: ${validRatios.join(", ")}`));
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
          aspectRatio: options.ratio as "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
        });

        // Auto-fallback: if latest/3.1-flash fails, retry with flash
        let usedLabel = modelLabel;
        const fallbackModels = ["latest", "3.1-flash"];
        if (!result.success && options.model && fallbackModels.includes(options.model)) {
          spinner.text = `${chalk.dim(result.error || "Failed")} — retrying with Nano Banana (flash)...`;
          result = await gemini.generateImage(prompt, {
            model: "flash",
            aspectRatio: options.ratio as "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9",
          });
          usedLabel = "Nano Banana (fallback)";
        }

        if (!result.success || !result.images) {
          spinner.fail("Image generation failed");
          exitWithError(apiError(result.error || "Image generation failed", true));
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Gemini (${usedLabel})`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        // Gemini returns base64, we need to save or display
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
            saveSpinner.fail(chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      } else if (provider === "runway") {
        // Use Runway's Gemini model for text-to-image (no reference needed)
        const { spawn } = await import("child_process");
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const scriptPath = resolve(__dirname, "../../../../.claude/skills/runway-video/scripts/image.py");

        if (!options.output) {
          spinner.fail("Output path required");
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
              spinner.succeed(chalk.green("Generated image with Runway"));
              console.log(chalk.dim(stdout.trim()));
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
      exitWithError(apiError(`Image generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("thumbnail")
  .description("Generate video thumbnail (DALL-E) or extract best frame from video (Gemini)")
  .argument("[description]", "Thumbnail description (for DALL-E generation)")
  .option("-k, --api-key <key>", "API key (OpenAI for generation, Google for best-frame)")
  .option("-o, --output <path>", "Output file path")
  .option("-s, --style <style>", "Platform style: youtube, instagram, tiktok, twitter")
  .option("--best-frame <video>", "Extract best thumbnail frame from video using Gemini AI")
  .option("--prompt <prompt>", "Custom prompt for best-frame analysis")
  .option("--model <model>", "Gemini model: flash, latest, pro (default: flash)", "flash")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (description: string | undefined, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai thumbnail", params: { description, output: options.output, style: options.style, bestFrame: options.bestFrame, prompt: options.prompt, model: options.model } });
        return;
      }

      // Best-frame mode: analyze video with Gemini and extract frame
      if (options.bestFrame) {
        const absVideoPath = resolve(process.cwd(), options.bestFrame);
        if (!existsSync(absVideoPath)) {
          exitWithError(notFoundError(absVideoPath));
        }

        if (!commandExists("ffmpeg")) {
          exitWithError(generalError("FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details."));
        }

        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
        if (!apiKey) {
          exitWithError(authError("GOOGLE_API_KEY", "Google"));
        }

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
          spinner.fail("Best frame extraction failed");
          exitWithError(apiError(result.error || "Best frame extraction failed", true));
        }

        spinner.succeed(chalk.green("Best frame extracted"));

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
        exitWithError(usageError("Description required for thumbnail generation.", "Usage: vibe ai thumbnail <description> or vibe ai thumbnail --best-frame <video>"));
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
      }

      const spinner = ora("Generating thumbnail...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateThumbnail(description, options.style);

      if (!result.success || !result.images) {
        spinner.fail("Thumbnail generation failed");
        exitWithError(apiError(result.error || "Thumbnail generation failed", true));
      }

      spinner.succeed(chalk.green("Thumbnail generated"));

      const img = result.images[0];
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
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save thumbnail"));
        }
      }
    } catch (error) {
      exitWithError(apiError(`Thumbnail generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("background")
  .description("Generate video background using DALL-E")
  .argument("<description>", "Background description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (description: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai background", params: { description, output: options.output, aspect: options.aspect } });
        return;
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("OPENAI_API_KEY", "OpenAI"));
      }

      const spinner = ora("Generating background...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateBackground(description, options.aspect);

      if (!result.success || !result.images) {
        spinner.fail("Background generation failed");
        exitWithError(apiError(result.error || "Background generation failed", true));
      }

      spinner.succeed(chalk.green("Background generated"));

      const img = result.images[0];
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
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save background"));
        }
      }
    } catch (error) {
      exitWithError(apiError(`Background generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });
// Gemini (Nano Banana) commands
aiCommand
  .command("gemini")
  .description("Generate image using Gemini (Nano Banana)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: flash (fast), 3.1-flash / latest (Nano Banana 2), pro (professional, 4K)", "flash")
  .option("-r, --ratio <ratio>", "Aspect ratio: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 4:3, 3:4, 21:9, etc.", "1:1")
  .option("-s, --size <resolution>", "Resolution: 512px, 1K, 2K, 4K")
  .option("--grounding", "Enable Google Search grounding (Pro only)")
  .option("--thinking <level>", "Enable thinking mode: minimal or high")
  .option("--image-search", "Enable Image Search grounding (3.1 Flash only)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai gemini", params: { prompt, output: options.output, model: options.model, ratio: options.ratio, size: options.size, grounding: options.grounding, thinking: options.thinking, imageSearch: options.imageSearch } });
        return;
      }

      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("GOOGLE_API_KEY", "Google"));
      }

      const modelNames: Record<string, string> = {
        flash: "gemini-2.5-flash-image",
        "3.1-flash": "gemini-3.1-flash-image-preview",
        latest: "gemini-3.1-flash-image-preview",
        pro: "gemini-3-pro-image-preview",
      };
      const modelName = modelNames[options.model] || modelNames.flash;
      const spinner = ora(`Generating image with ${modelName}...`).start();

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      let result = await gemini.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
        grounding: options.grounding,
        thinkingConfig: options.thinking ? { thinkingLevel: options.thinking } : undefined,
        imageSearchGrounding: options.imageSearch,
      });

      // Auto-fallback: if latest/3.1-flash fails, retry with flash
      const fallbackModels = ["latest", "3.1-flash"];
      if (!result.success && fallbackModels.includes(options.model)) {
        spinner.text = `${chalk.dim(result.error || `${modelName} failed`)} — retrying with flash...`;
        result = await gemini.generateImage(prompt, {
          model: "flash",
          aspectRatio: options.ratio,
          resolution: options.size,
        });
      }

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail("Image generation failed");
        exitWithError(apiError(result.error || "Image generation failed", true));
      }

      spinner.succeed(chalk.green("Image generated"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      exitWithError(apiError(`Image generation failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

aiCommand
  .command("gemini-edit")
  .description("Edit image(s) using Gemini (Nano Banana)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash (max 3 images), 3.1-flash / latest (max 3 images), pro (max 14 images)", "flash")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (args: string[], options) => {
    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Last argument is the prompt, rest are image paths
      if (args.length < 2) {
        exitWithError(usageError("Need at least one image and a prompt"));
      }

      const prompt = args[args.length - 1];
      const imagePaths = args.slice(0, -1);

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "ai gemini-edit", params: { images: imagePaths, prompt, output: options.output, model: options.model, ratio: options.ratio, size: options.size } });
        return;
      }

      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        exitWithError(authError("GOOGLE_API_KEY", "Google"));
      }

      const spinner = ora(`Reading ${imagePaths.length} image(s)...`).start();

      // Load all images
      const imageBuffers: Buffer[] = [];
      for (const imagePath of imagePaths) {
        const absPath = resolve(process.cwd(), imagePath);
        const buffer = await readFile(absPath);
        imageBuffers.push(buffer);
      }

      const editModelNames: Record<string, string> = {
        flash: "gemini-2.5-flash-image",
        "3.1-flash": "gemini-3.1-flash-image-preview",
        latest: "gemini-3.1-flash-image-preview",
        pro: "gemini-3-pro-image-preview",
      };
      const editModelName = editModelNames[options.model] || editModelNames.flash;
      spinner.text = `Editing with ${editModelName}...`;

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      let result = await gemini.editImage(imageBuffers, prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
      });

      // Auto-fallback: if latest/3.1-flash fails, retry with flash
      const fallbackModels = ["latest", "3.1-flash"];
      if (!result.success && fallbackModels.includes(options.model)) {
        spinner.text = `${chalk.dim(result.error || `${editModelName} failed`)} — retrying with flash...`;
        result = await gemini.editImage(imageBuffers, prompt, {
          model: "flash",
          aspectRatio: options.ratio,
          resolution: options.size,
        });
      }

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail("Image editing failed");
        exitWithError(apiError(result.error || "Image editing failed", true));
      }

      spinner.succeed(chalk.green("Image edited"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      exitWithError(apiError(`Image editing failed: ${error instanceof Error ? error.message : String(error)}`, true));
    }
  });

}

// ── Exported execute functions ─────────────────────────────────────────────


// ============================================================================
// Image Generation
// ============================================================================

export interface ImageGenerateOptions {
  prompt: string;
  provider?: "openai" | "gemini" | "grok";
  output?: string;
  size?: string;
  ratio?: string;
  quality?: string;
  style?: string;
  count?: number;
  model?: string;
  apiKey?: string;
}

export interface ImageGenerateResult {
  success: boolean;
  outputPath?: string;
  images?: Array<{ url?: string; base64?: string; mimeType?: string; revisedPrompt?: string }>;
  provider?: string;
  model?: string;
  error?: string;
}

export async function executeImageGenerate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
  const {
    prompt,
    provider = "gemini",
    output,
    size = "1024x1024",
    ratio = "1:1",
    quality = "standard",
    style = "vivid",
    count = 1,
    model,
    apiKey,
  } = options;

  try {
    if (provider === "openai") {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) return { success: false, error: "OPENAI_API_KEY required" };

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey: key });

      const result = await openaiImage.generateImage(prompt, {
        size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined,
        quality: quality as "standard" | "hd" | undefined,
        style: style as "vivid" | "natural" | undefined,
        n: count,
      });

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      // Save first image if output specified
      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        let buffer: Buffer;
        if (img.url) {
          const response = await fetch(img.url);
          buffer = Buffer.from(await response.arrayBuffer());
        } else if (img.base64) {
          buffer = Buffer.from(img.base64, "base64");
        } else {
          return { success: false, error: "No image data available" };
        }
        outputPath = resolve(process.cwd(), output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ url: img.url, base64: img.base64, revisedPrompt: img.revisedPrompt })),
        provider: "openai",
      };
    } else if (provider === "gemini") {
      const key = apiKey || process.env.GOOGLE_API_KEY;
      if (!key) return { success: false, error: "GOOGLE_API_KEY required" };

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: key });

      // Map "latest" to "3.1-flash" for type safety
      const modelMap: Record<string, string> = { latest: "3.1-flash" };
      const mappedModel = model ? (modelMap[model] || model) : undefined;

      let result = await gemini.generateImage(prompt, {
        model: mappedModel as "flash" | "3.1-flash" | "pro" | undefined,
        aspectRatio: ratio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
      });

      // Auto-fallback
      const fallbackModels = ["3.1-flash"];
      if (!result.success && mappedModel && fallbackModels.includes(mappedModel)) {
        result = await gemini.generateImage(prompt, {
          model: "flash",
          aspectRatio: ratio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
        });
      }

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      // Save first image if output specified
      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        if (img.base64) {
          outputPath = resolve(process.cwd(), output);
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, Buffer.from(img.base64, "base64"));
        }
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ base64: img.base64, mimeType: img.mimeType })),
        provider: "gemini",
        model: result.model,
      };
    } else if (provider === "grok") {
      const key = apiKey || process.env.XAI_API_KEY;
      if (!key) return { success: false, error: "XAI_API_KEY required" };

      // Grok image generation uses OpenAI-compatible API
      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey: key, baseUrl: "https://api.x.ai/v1" });

      const result = await openaiImage.generateImage(prompt, {
        size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto" | undefined,
        n: count,
      });

      if (!result.success || !result.images) {
        return { success: false, error: result.error || "Image generation failed" };
      }

      let outputPath: string | undefined;
      if (output && result.images.length > 0) {
        const img = result.images[0];
        let buffer: Buffer;
        if (img.url) {
          const response = await fetch(img.url);
          buffer = Buffer.from(await response.arrayBuffer());
        } else if (img.base64) {
          buffer = Buffer.from(img.base64, "base64");
        } else {
          return { success: false, error: "No image data available" };
        }
        outputPath = resolve(process.cwd(), output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, buffer);
      }

      return {
        success: true,
        outputPath,
        images: result.images.map(img => ({ url: img.url, base64: img.base64, revisedPrompt: img.revisedPrompt })),
        provider: "grok",
      };
    }

    return { success: false, error: `Unsupported provider: ${provider}` };
  } catch (error) {
    return { success: false, error: `Image generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Gemini Image Edit
// ============================================================================

export interface GeminiEditOptions {
  imagePaths: string[];
  prompt: string;
  output?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  apiKey?: string;
}

export interface GeminiEditResult {
  success: boolean;
  outputPath?: string;
  model?: string;
  error?: string;
}

export async function executeGeminiEdit(options: GeminiEditOptions): Promise<GeminiEditResult> {
  const {
    imagePaths,
    prompt,
    output = "edited.png",
    model = "flash",
    ratio,
    resolution,
    apiKey,
  } = options;

  try {
    const key = apiKey || process.env.GOOGLE_API_KEY;
    if (!key) return { success: false, error: "GOOGLE_API_KEY required" };

    // Load all images
    const imageBuffers: Buffer[] = [];
    for (const imagePath of imagePaths) {
      const absPath = resolve(process.cwd(), imagePath);
      if (!existsSync(absPath)) {
        return { success: false, error: `Image not found: ${absPath}` };
      }
      const buffer = await readFile(absPath);
      imageBuffers.push(buffer);
    }

    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: key });

    type GeminiAspectRatio = "1:1" | "1:4" | "1:8" | "2:3" | "3:2" | "3:4" | "4:1" | "4:3" | "4:5" | "5:4" | "8:1" | "9:16" | "16:9" | "21:9";
    type GeminiRes = "512px" | "1K" | "2K" | "4K";

    let result = await gemini.editImage(imageBuffers, prompt, {
      model: model as "flash" | "3.1-flash" | "pro" | undefined,
      aspectRatio: ratio as GeminiAspectRatio | undefined,
      resolution: resolution as GeminiRes | undefined,
    });

    // Auto-fallback
    const fallbackModels = ["latest", "3.1-flash"];
    if (!result.success && fallbackModels.includes(model)) {
      result = await gemini.editImage(imageBuffers, prompt, {
        model: "flash",
        aspectRatio: ratio as GeminiAspectRatio | undefined,
        resolution: resolution as GeminiRes | undefined,
      });
    }

    if (!result.success || !result.images || result.images.length === 0) {
      return { success: false, error: result.error || "Image editing failed" };
    }

    // Save output
    const img = result.images[0];
    let outputPath: string | undefined;
    if (img.base64) {
      outputPath = resolve(process.cwd(), output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from(img.base64, "base64"));
    }

    return {
      success: true,
      outputPath,
      model: result.model,
    };
  } catch (error) {
    return { success: false, error: `Image editing failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Thumbnail Best Frame
// ============================================================================

export interface ThumbnailBestFrameOptions {
  videoPath: string;
  outputPath: string;
  prompt?: string;
  model?: string;
  apiKey?: string;
}

export interface ThumbnailBestFrameResult {
  success: boolean;
  outputPath?: string;
  timestamp?: number;
  reason?: string;
  error?: string;
}

export async function executeThumbnailBestFrame(options: ThumbnailBestFrameOptions): Promise<ThumbnailBestFrameResult> {
  const {
    videoPath,
    outputPath,
    prompt,
    model = "flash",
    apiKey,
  } = options;

  if (!existsSync(videoPath)) {
    return { success: false, error: `Video not found: ${videoPath}` };
  }

  if (!commandExists("ffmpeg")) {
    return { success: false, error: "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). Run `vibe doctor` for details." };
  }

  const googleKey = apiKey || process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return { success: false, error: "Google API key required for Gemini video analysis. Run 'vibe setup' or set GOOGLE_API_KEY in .env" };
  }

  try {
    const gemini = new GeminiProvider();
    await gemini.initialize({ apiKey: googleKey });

    const videoData = await readFile(videoPath);

    const analysisPrompt = prompt ||
      "Analyze this video and find the single best frame for a thumbnail. " +
      "Look for frames that are visually striking, well-composed, emotionally engaging, " +
      "and representative of the video content. Avoid blurry frames, transitions, or dark scenes. " +
      "Return ONLY a JSON object: {\"timestamp\": <seconds as number>, \"reason\": \"<brief explanation>\"}";

    const modelMap: Record<string, string> = {
      flash: "gemini-3-flash-preview",
      latest: "gemini-2.5-flash",
      "flash-2.5": "gemini-2.5-flash", // backward compat
      pro: "gemini-2.5-pro",
    };
    const modelId = modelMap[model] || "gemini-3-flash-preview";

    const result = await gemini.analyzeVideo(videoData, analysisPrompt, {
      model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
      fps: 1,
    });

    if (!result.success || !result.response) {
      return { success: false, error: result.error || "Gemini analysis failed" };
    }

    // Parse timestamp from response
    const jsonMatch = result.response.match(/\{[\s\S]*?"timestamp"\s*:\s*([\d.]+)[\s\S]*?\}/);
    if (!jsonMatch) {
      return { success: false, error: `Could not parse timestamp from Gemini response: ${result.response.slice(0, 200)}` };
    }

    const timestamp = parseFloat(jsonMatch[1]);
    let reason: string | undefined;
    const reasonMatch = result.response.match(/"reason"\s*:\s*"([^"]+)"/);
    if (reasonMatch) {
      reason = reasonMatch[1];
    }

    // Extract frame with FFmpeg
    await execSafe("ffmpeg", ["-ss", String(timestamp), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath, "-y"], { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

    if (!existsSync(outputPath)) {
      return { success: false, error: "FFmpeg failed to extract frame" };
    }

    return {
      success: true,
      outputPath,
      timestamp,
      reason,
    };
  } catch (error) {
    return {
      success: false,
      error: `Best frame extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}


/**
 * Register all image sub-commands on the given parent command.
 * Called from ai.ts: registerImageCommands(aiCommand)
 */
export function registerImageCommands(aiCommand: Command): void {
  _registerImageCommands(aiCommand);
}
