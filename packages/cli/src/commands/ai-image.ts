/**
 * ai-image.ts — Image generation and editing commands for the VibeFrame CLI.
 *
 * Commands: image, thumbnail, background,
 *           sd, sd-upscale, sd-remove-bg, sd-img2img, sd-replace, sd-outpaint,
 *           gemini, gemini-edit
 *
 * Extracted from ai.ts as part of modularisation.
 * ai.ts calls registerImageCommands(aiCommand).
 */

import { type Command } from 'commander';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import {
  GeminiProvider,
  OpenAIImageProvider,
  StabilityProvider,
  RunwayProvider,
  openaiImageProvider,
  stabilityProvider,
} from '@vibeframe/ai-providers';
import { getApiKey } from '../utils/api-key.js';
import { getVideoDuration } from '../utils/audio.js';

const execAsync = promisify(exec);

function _registerImageCommands(aiCommand: Command): void {

aiCommand
  .command("image")
  .description("Generate image using AI (Gemini, DALL-E, or Stability)")
  .argument("<prompt>", "Image description prompt")
  .option("-p, --provider <provider>", "Provider: gemini, openai, stability, runway (dalle is deprecated)", "gemini")
  .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY, STABILITY_API_KEY)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --size <size>", "Image size (openai: 1024x1024, 1536x1024, 1024x1536)", "1024x1024")
  .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 16:9, 9:16, 3:4, 4:3)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard, hd (openai only)", "standard")
  .option("--style <style>", "Style: vivid, natural (openai only)", "vivid")
  .option("-n, --count <n>", "Number of images to generate", "1")
  .action(async (prompt: string, options) => {
    try {
      let provider = options.provider.toLowerCase();
      const validProviders = ["openai", "dalle", "gemini", "stability", "runway"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: openai, gemini, stability, runway`));
        process.exit(1);
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
        stability: "STABILITY_API_KEY",
        runway: "RUNWAY_API_SECRET",
      };
      const providerNameMap: Record<string, string> = {
        openai: "OpenAI",
        dalle: "OpenAI", // backward compatibility
        gemini: "Google",
        stability: "Stability",
        runway: "Runway",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];

      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      const spinner = ora(`Generating image with ${providerName}...`).start();

      if (provider === "dalle" || provider === "openai") {
        const openaiImage = new OpenAIImageProvider();
        await openaiImage.initialize({ apiKey });

        const result = await openaiImage.generateImage(prompt, {
          size: options.size,
          quality: options.quality,
          style: options.style,
          n: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with OpenAI GPT Image 1.5`));

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
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        }
      } else if (provider === "gemini") {
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        const result = await gemini.generateImage(prompt, {
          aspectRatio: options.ratio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9",
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Gemini (Nano Banana)`));

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
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
          }
        } else {
          console.log(chalk.yellow("Use -o to save the generated image to a file"));
        }
      } else if (provider === "stability") {
        const stability = new StabilityProvider();
        await stability.initialize({ apiKey });

        // Map size to Stability aspect ratio
        const aspectRatioMap: Record<string, "16:9" | "1:1" | "9:16"> = {
          "1024x1024": "1:1",
          "1536x1024": "16:9",
          "1024x1536": "9:16",
        };

        const result = await stability.generateImage(prompt, {
          aspectRatio: aspectRatioMap[options.size] || "1:1",
          count: parseInt(options.count),
        });

        if (!result.success || !result.images) {
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Stability AI`));

        console.log();
        console.log(chalk.bold.cyan("Generated Images"));
        console.log(chalk.dim("─".repeat(60)));

        for (let i = 0; i < result.images.length; i++) {
          console.log();
          console.log(`${chalk.yellow(`[${i + 1}]`)} (base64 image)`);
        }
        console.log();

        // Save if output specified
        if (options.output && result.images.length > 0) {
          const saveSpinner = ora("Saving image...").start();
          try {
            const img = result.images[0];
            if (!img.base64) {
              saveSpinner.fail(chalk.red("No image data returned"));
              process.exit(1);
            }
            const buffer = Buffer.from(img.base64, "base64");
            const outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
            saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
          } catch (err) {
            saveSpinner.fail(chalk.red("Failed to save image"));
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
          spinner.fail(chalk.red("Output path required for Runway. Use -o option."));
          process.exit(1);
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
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
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
  .option("--model <model>", "Gemini model: flash, flash-2.5, pro (default: flash)", "flash")
  .action(async (description: string | undefined, options) => {
    try {
      // Best-frame mode: analyze video with Gemini and extract frame
      if (options.bestFrame) {
        const absVideoPath = resolve(process.cwd(), options.bestFrame);
        if (!existsSync(absVideoPath)) {
          console.error(chalk.red(`Video not found: ${absVideoPath}`));
          process.exit(1);
        }

        try {
          execSync("ffmpeg -version", { stdio: "ignore" });
        } catch {
          console.error(chalk.red("FFmpeg not found. Please install FFmpeg."));
          process.exit(1);
        }

        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Google API key required for Gemini video analysis."));
          console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY"));
          process.exit(1);
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
          spinner.fail(chalk.red(result.error || "Best frame extraction failed"));
          process.exit(1);
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
        console.error(chalk.red("Description required for thumbnail generation."));
        console.error(chalk.dim("Usage: vibe ai thumbnail <description> or vibe ai thumbnail --best-frame <video>"));
        process.exit(1);
      }

      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating thumbnail...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateThumbnail(description, options.style);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Thumbnail generation failed"));
        process.exit(1);
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
          await writeFile(outputPath, buffer);
          saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save thumbnail"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Thumbnail generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("background")
  .description("Generate video background using DALL-E")
  .argument("<description>", "Background description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
  .action(async (description: string, options) => {
    try {
      const apiKey = await getApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("OpenAI API key required. Use --api-key or set OPENAI_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating background...").start();

      const openaiImage = new OpenAIImageProvider();
      await openaiImage.initialize({ apiKey });

      const result = await openaiImage.generateBackground(description, options.aspect);

      if (!result.success || !result.images) {
        spinner.fail(chalk.red(result.error || "Background generation failed"));
        process.exit(1);
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
          await writeFile(outputPath, buffer);
          saveSpinner.succeed(chalk.green(`Saved to: ${outputPath}`));
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save background"));
        }
      }
    } catch (error) {
      console.error(chalk.red("Background generation failed"));
      console.error(error);
      process.exit(1);
    }
  });
aiCommand
  .command("sd")
  .description("Generate image using Stable Diffusion (Stability AI)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: sd3.5-large, sd3.5-medium, stable-image-ultra", "sd3.5-large")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 1:1, 9:16, 21:9, etc.", "1:1")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("--style <preset>", "Style preset: photographic, anime, digital-art, cinematic, etc.")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required."));
        console.error(chalk.dim("Use --api-key or set STABILITY_API_KEY environment variable"));
        process.exit(1);
      }

      const spinner = ora("Generating image with Stable Diffusion...").start();

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        stylePreset: options.style,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image generated"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }

      // Save the image
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-upscale")
  .description("Upscale image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "upscaled.png")
  .option("-t, --type <type>", "Upscale type: fast, conservative, creative", "fast")
  .option("-c, --creativity <value>", "Creativity (0-0.35, for creative upscale)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Upscaling image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.upscaleImage(imageBuffer, {
        type: options.type as "fast" | "conservative" | "creative",
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Upscale failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image upscaled"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Upscale failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-remove-bg")
  .description("Remove background from image using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "no-bg.png")
  .option("-f, --format <format>", "Output format: png, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Removing background...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.removeBackground(imageBuffer, options.format as "png" | "webp");

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Background removal failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Background removed"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Background removal failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-img2img")
  .description("Transform image using Stable Diffusion (image-to-image)")
  .argument("<image>", "Input image file path")
  .argument("<prompt>", "Text prompt describing the transformation")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "transformed.png")
  .option("-t, --strength <value>", "Transformation strength (0-1)", "0.35")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, prompt: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Transforming image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.imageToImage(imageBuffer, prompt, {
        strength: parseFloat(options.strength),
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Transformation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image transformed"));

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Transformation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-replace")
  .description("Search and replace objects in image using Stability AI")
  .argument("<image>", "Input image file path")
  .argument("<search>", "What to search for in the image")
  .argument("<replace>", "What to replace it with")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "replaced.png")
  .option("-n, --negative <prompt>", "Negative prompt (what to avoid)")
  .option("-s, --seed <number>", "Random seed for reproducibility")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, search: string, replace: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Replacing objects...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.searchAndReplace(imageBuffer, search, replace, {
        negativePrompt: options.negative,
        seed: options.seed ? parseInt(options.seed) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Search and replace failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Objects replaced"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Search and replace failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("sd-outpaint")
  .description("Extend image canvas (outpainting) using Stability AI")
  .argument("<image>", "Input image file path")
  .option("-k, --api-key <key>", "Stability AI API key (or set STABILITY_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "outpainted.png")
  .option("--left <pixels>", "Pixels to extend on the left (0-2000)")
  .option("--right <pixels>", "Pixels to extend on the right (0-2000)")
  .option("--up <pixels>", "Pixels to extend upward (0-2000)")
  .option("--down <pixels>", "Pixels to extend downward (0-2000)")
  .option("-p, --prompt <text>", "Prompt for the extended area")
  .option("-c, --creativity <value>", "Creativity level (0-1, default: 0.5)")
  .option("-f, --format <format>", "Output format: png, jpeg, webp", "png")
  .action(async (imagePath: string, options) => {
    try {
      const apiKey = await getApiKey("STABILITY_API_KEY", "Stability AI", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Stability AI API key required"));
        process.exit(1);
      }

      const left = options.left ? parseInt(options.left) : 0;
      const right = options.right ? parseInt(options.right) : 0;
      const up = options.up ? parseInt(options.up) : 0;
      const down = options.down ? parseInt(options.down) : 0;

      if (left === 0 && right === 0 && up === 0 && down === 0) {
        console.error(chalk.red("At least one direction (--left, --right, --up, --down) must be specified"));
        process.exit(1);
      }

      const spinner = ora("Reading image...").start();

      const absPath = resolve(process.cwd(), imagePath);
      const imageBuffer = await readFile(absPath);

      spinner.text = "Extending image...";

      const stability = new StabilityProvider();
      await stability.initialize({ apiKey });

      const result = await stability.outpaint(imageBuffer, {
        left,
        right,
        up,
        down,
        prompt: options.prompt,
        creativity: options.creativity ? parseFloat(options.creativity) : undefined,
        outputFormat: options.format,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Outpainting failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image extended"));

      const img = result.images[0];
      if (img.seed) {
        console.log(chalk.dim(`Seed: ${img.seed}`));
      }
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Outpainting failed"));
      console.error(error);
      process.exit(1);
    }
  });

// Gemini (Nano Banana) commands
aiCommand
  .command("gemini")
  .description("Generate image using Gemini (Nano Banana)")
  .argument("<prompt>", "Text prompt describing the image")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "output.png")
  .option("-m, --model <model>", "Model: flash (fast), pro (professional, 4K)", "flash")
  .option("-r, --ratio <ratio>", "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, etc.", "1:1")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .option("--grounding", "Enable Google Search grounding (Pro only)")
  .action(async (prompt: string, options) => {
    try {
      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
        process.exit(1);
      }

      const modelName = options.model === "pro" ? "gemini-3-pro-image-preview" : "gemini-2.5-flash-image";
      const spinner = ora(`Generating image with ${modelName}...`).start();

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.generateImage(prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
        grounding: options.grounding,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image generated"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

aiCommand
  .command("gemini-edit")
  .description("Edit image(s) using Gemini (Nano Banana)")
  .argument("<images...>", "Input image file(s) followed by edit prompt")
  .option("-k, --api-key <key>", "Google API key (or set GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path", "edited.png")
  .option("-m, --model <model>", "Model: flash (max 3 images), pro (max 14 images)", "flash")
  .option("-r, --ratio <ratio>", "Output aspect ratio")
  .option("-s, --size <resolution>", "Resolution: 1K, 2K, 4K (Pro model only)")
  .action(async (args: string[], options) => {
    try {
      // Last argument is the prompt, rest are image paths
      if (args.length < 2) {
        console.error(chalk.red("Need at least one image and a prompt"));
        process.exit(1);
      }

      const prompt = args[args.length - 1];
      const imagePaths = args.slice(0, -1);

      const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Google API key required."));
        process.exit(1);
      }

      const spinner = ora(`Reading ${imagePaths.length} image(s)...`).start();

      // Load all images
      const imageBuffers: Buffer[] = [];
      for (const imagePath of imagePaths) {
        const absPath = resolve(process.cwd(), imagePath);
        const buffer = await readFile(absPath);
        imageBuffers.push(buffer);
      }

      const modelName = options.model === "pro" ? "gemini-3-pro-image-preview" : "gemini-2.5-flash-image";
      spinner.text = `Editing with ${modelName}...`;

      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey });

      const result = await gemini.editImage(imageBuffers, prompt, {
        model: options.model,
        aspectRatio: options.ratio,
        resolution: options.size,
      });

      if (!result.success || !result.images || result.images.length === 0) {
        spinner.fail(chalk.red(result.error || "Image editing failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Image edited"));

      if (result.model) {
        console.log(chalk.dim(`Model: ${result.model}`));
      }

      const img = result.images[0];
      if (img.base64) {
        const outputPath = resolve(process.cwd(), options.output);
        const buffer = Buffer.from(img.base64, "base64");
        await writeFile(outputPath, buffer);
        console.log(chalk.green(`Saved to: ${outputPath}`));
      }
    } catch (error) {
      console.error(chalk.red("Image editing failed"));
      console.error(error);
      process.exit(1);
    }
  });

}

// ── Exported execute functions ─────────────────────────────────────────────


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

  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
  } catch {
    return { success: false, error: "FFmpeg not found. Please install FFmpeg." };
  }

  const googleKey = apiKey || process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return { success: false, error: "Google API key required for Gemini video analysis." };
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
      "flash-2.5": "gemini-2.5-flash",
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
    await execAsync(
      `ffmpeg -ss ${timestamp} -i "${videoPath}" -frames:v 1 -q:v 2 "${outputPath}" -y`,
      { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
    );

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
