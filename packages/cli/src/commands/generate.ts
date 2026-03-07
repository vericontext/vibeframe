/**
 * @module generate
 *
 * Top-level `vibe generate` command group for AI asset generation.
 *
 * Commands:
 *   generate image          - Generate image (Gemini, OpenAI, Stability, Runway)
 *   generate video          - Generate video (Kling, Runway, Veo, Grok)
 *   generate speech         - Text-to-speech (ElevenLabs)
 *   generate sound-effect   - Sound effects (ElevenLabs)
 *   generate music          - Music generation (Replicate MusicGen)
 *   generate music-status   - Check music generation status
 *   generate storyboard     - Script-to-storyboard (Claude)
 *   generate motion         - Motion graphics (Claude/Gemini + Remotion)
 *   generate thumbnail      - Thumbnail generation/extraction
 *   generate background     - AI background generation (OpenAI)
 *   generate video-status   - Check video generation status (Runway/Kling)
 *   generate video-cancel   - Cancel Runway video generation
 *   generate video-extend   - Extend video (Kling/Veo)
 *
 * @dependencies OpenAI, Gemini, Stability, Runway, Kling, ElevenLabs, Replicate, Claude, FFmpeg
 */

import { Command } from "commander";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  GeminiProvider,
  OpenAIImageProvider,
  StabilityProvider,
  KlingProvider,
  RunwayProvider,
  ElevenLabsProvider,
  ReplicateProvider,
  ClaudeProvider,
} from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { isJsonMode, outputResult, log, spinner as createSpinner } from "./output.js";
import { commandExists } from "../utils/exec-safe.js";
import { uploadToImgbb } from "./ai-script-pipeline.js";
import { downloadVideo, formatTime } from "./ai-helpers.js";
import { executeThumbnailBestFrame } from "./ai-image.js";
import { registerMotionCommand } from "./ai-motion.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Command group ────────────────────────────────────────────────────────────

export const generateCommand = new Command("generate").description(
  "Generate assets using AI (images, videos, speech, music, motion)"
);

// ============================================================================
// 1. Image
// ============================================================================

generateCommand
  .command("image")
  .description("Generate image using AI (Gemini, DALL-E, Stability, or Runway)")
  .argument("<prompt>", "Image description prompt")
  .option("-p, --provider <provider>", "Provider: gemini, openai, stability, runway (dalle is deprecated)", "gemini")
  .option("-k, --api-key <key>", "API key (or set env: OPENAI_API_KEY, GOOGLE_API_KEY, STABILITY_API_KEY)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-s, --size <size>", "Image size (openai: 1024x1024, 1536x1024, 1024x1536)", "1024x1024")
  .option("-r, --ratio <ratio>", "Aspect ratio (gemini: 1:1, 1:4, 1:8, 4:1, 8:1, 16:9, 9:16, 3:4, 4:3, etc.)", "1:1")
  .option("-q, --quality <quality>", "Quality: standard, hd (openai only)", "standard")
  .option("--style <style>", "Style: vivid, natural (openai only)", "vivid")
  .option("-n, --count <n>", "Number of images to generate", "1")
  .option("-m, --model <model>", "Gemini model: flash, 3.1-flash, latest (Nano Banana 2), pro (4K)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      const provider = options.provider.toLowerCase();
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

      // Dry-run check
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate image", params: { prompt, provider, model: options.model, ratio: options.ratio, size: options.size, quality: options.quality, count: options.count, output: options.output } });
        return;
      }

      // Get API key based on provider
      const envKeyMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        dalle: "OPENAI_API_KEY",
        gemini: "GOOGLE_API_KEY",
        stability: "STABILITY_API_KEY",
        runway: "RUNWAY_API_SECRET",
      };
      const providerNameMap: Record<string, string> = {
        openai: "OpenAI",
        dalle: "OpenAI",
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

        if (isJsonMode()) {
          const outputPath = options.output ? resolve(process.cwd(), options.output) : undefined;
          // Still save the file in JSON mode
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
          outputResult({ success: true, provider: "openai", images: result.images.map(img => ({ url: img.url, revisedPrompt: img.revisedPrompt })), outputPath });
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
          console.error(chalk.red(`Invalid ratio "${options.ratio}". Valid: ${validRatios.join(", ")}`));
          process.exit(1);
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
          spinner.fail(chalk.red(result.error || "Image generation failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with Gemini (${usedLabel})`));

        if (isJsonMode()) {
          const outputPath = options.output ? resolve(process.cwd(), options.output) : undefined;
          if (outputPath && result.images.length > 0) {
            const img = result.images[0];
            const buffer = Buffer.from(img.base64, "base64");
            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, provider: "gemini", images: result.images.map((img: { mimeType?: string }) => ({ mimeType: img.mimeType })), outputPath });
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
            saveSpinner.fail(chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`));
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

        if (isJsonMode()) {
          const outputPath = options.output ? resolve(process.cwd(), options.output) : undefined;
          if (outputPath && result.images.length > 0) {
            const img = result.images[0];
            if (img.base64) {
              const buffer = Buffer.from(img.base64, "base64");
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(outputPath, buffer);
            }
          }
          outputResult({ success: true, provider: "stability", images: result.images.map(() => ({ format: "base64" })), outputPath });
          return;
        }

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
              if (isJsonMode()) {
                outputResult({ success: true, provider: "runway", images: [{ format: "file" }], outputPath });
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
      console.error(chalk.red("Image generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 2. Video (merged: ai video + ai kling, unified via --provider)
// ============================================================================

generateCommand
  .command("video")
  .description("Generate video using AI (Kling, Runway, Veo, or Grok)")
  .argument("<prompt>", "Text prompt describing the video")
  .option("-p, --provider <provider>", "Provider: kling, runway, veo, grok", "kling")
  .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1", "16:9")
  .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
  .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling/Veo)")
  .option("--resolution <res>", "Video resolution: 720p, 1080p, 4k (Veo only)")
  .option("--last-frame <path>", "Last frame image for frame interpolation (Veo only)")
  .option("--ref-images <paths...>", "Reference images for character consistency (Veo 3.1 only, max 3)")
  .option("--person <mode>", "Person generation: allow_all, allow_adult (Veo only)")
  .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)", "3.1-fast")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      const provider = options.provider.toLowerCase();
      const validProviders = ["runway", "kling", "veo", "grok"];
      if (!validProviders.includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}`));
        console.error(chalk.dim(`Available providers: ${validProviders.join(", ")}`));
        process.exit(1);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate video", params: { prompt, provider, duration: options.duration, ratio: options.ratio, image: options.image, mode: options.mode, negative: options.negative, resolution: options.resolution, veoModel: options.veoModel } });
        return;
      }

      const envKeyMap: Record<string, string> = {
        runway: "RUNWAY_API_SECRET",
        kling: "KLING_API_KEY",
        veo: "GOOGLE_API_KEY",
        grok: "XAI_API_KEY",
      };
      const providerNameMap: Record<string, string> = {
        runway: "Runway",
        kling: "Kling",
        veo: "Veo",
        grok: "Grok",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];
      const apiKey = await getApiKey(envKey, providerName, options.apiKey);
      if (!apiKey) {
        console.error(chalk.red(`${providerName} API key required.`));
        if (provider === "kling") {
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
        }
        console.error(chalk.dim(`Use --api-key or set ${envKey} environment variable`));
        process.exit(1);
      }

      // Runway Gen-4 requires an input image
      if (provider === "runway" && !options.image) {
        console.error(chalk.red("Runway Gen-4 requires an input image. Use -i <image> to specify."));
        console.error(chalk.dim("Example: vibe generate video \"prompt\" -p runway -i image.png -o out.mp4"));
        process.exit(1);
      }

      const spinner = ora(`Initializing ${providerName}...`).start();

      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
        spinner.text = "Reading reference image...";
        const imagePath = resolve(process.cwd(), options.image);
        const imageBuffer = await readFile(imagePath);
        const ext = options.image.toLowerCase().split(".").pop();
        const mimeTypes: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mimeType = mimeTypes[ext || "png"] || "image/png";
        referenceImage = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        isImageToVideo = true;
      }

      spinner.text = "Starting video generation...";

      let result;
      let finalResult;

      if (provider === "runway") {
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        result = await runway.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16",
          seed: options.seed ? parseInt(options.seed) : undefined,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Runway Gen-3")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe generate video-status ${result.id} -p runway`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 1-2 minutes)...";

        finalResult = await runway.waitForCompletion(
          result.id,
          (status) => {
            if (status.progress !== undefined) {
              spinner.text = `Generating video... ${status.progress}%`;
            }
          },
          300000
        );
      } else if (provider === "kling") {
        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
        }

        // Kling v2.x requires image URL, not base64 — auto-upload to ImgBB
        let klingImage = referenceImage;
        if (klingImage && klingImage.startsWith("data:")) {
          spinner.text = "Uploading image to ImgBB for Kling...";
          const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
          if (!imgbbKey) {
            spinner.fail(chalk.red("Kling requires image URL. Set IMGBB_API_KEY for auto-upload."));
            console.error(chalk.dim("Run: vibe setup --full  to configure ImgBB"));
            process.exit(1);
          }
          // Extract raw base64 from data URI
          const base64Data = klingImage.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
          if (!uploadResult.success || !uploadResult.url) {
            spinner.fail(chalk.red(`ImgBB upload failed: ${uploadResult.error}`));
            process.exit(1);
          }
          klingImage = uploadResult.url;
          spinner.text = "Starting video generation...";
        }

        result = await kling.generateVideo(prompt, {
          prompt,
          referenceImage: klingImage,
          duration: parseInt(options.duration) as 5 | 10,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          negativePrompt: options.negative,
          mode: options.mode as "std" | "pro",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Kling AI")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);
        console.log(`Type: ${isImageToVideo ? "image2video" : "text2video"}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe generate video-status ${result.id} -p kling${isImageToVideo ? " --type image2video" : ""}`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 2-5 minutes)...";

        const taskType = isImageToVideo ? "image2video" : "text2video";
        finalResult = await kling.waitForCompletion(
          result.id,
          taskType,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          600000
        );
      } else if (provider === "veo") {
        const gemini = new GeminiProvider();
        await gemini.initialize({ apiKey });

        // Map Veo model alias to full model ID
        const veoModelMap: Record<string, string> = {
          "3.0": "veo-3.0-generate-preview",
          "3.1": "veo-3.1-generate-preview",
          "3.1-fast": "veo-3.1-fast-generate-preview",
        };
        const veoModel = veoModelMap[options.veoModel] || "veo-3.1-fast-generate-preview";

        const veoDuration = parseInt(options.duration) <= 6 ? 6 : 8;

        // Prepare last frame if provided
        let lastFrame: string | undefined;
        if (options.lastFrame) {
          const lastFramePath = resolve(process.cwd(), options.lastFrame);
          const lastFrameBuffer = await readFile(lastFramePath);
          const ext = options.lastFrame.toLowerCase().split(".").pop();
          const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
          lastFrame = `data:${mimeType};base64,${lastFrameBuffer.toString("base64")}`;
        }

        // Prepare reference images if provided
        let refImages: Array<{ base64: string; mimeType: string }> | undefined;
        if (options.refImages && options.refImages.length > 0) {
          refImages = [];
          for (const refPath of options.refImages.slice(0, 3)) {
            const absRefPath = resolve(process.cwd(), refPath);
            const refBuffer = await readFile(absRefPath);
            const ext = refPath.toLowerCase().split(".").pop();
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext || "png"}`;
            refImages.push({ base64: refBuffer.toString("base64"), mimeType });
          }
        }

        result = await gemini.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: veoDuration,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
          model: veoModel as "veo-3.0-generate-preview" | "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview",
          negativePrompt: options.negative,
          resolution: options.resolution as "720p" | "1080p" | "4k" | undefined,
          lastFrame,
          referenceImages: refImages,
          personGeneration: options.person as "allow_all" | "allow_adult" | undefined,
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start generation"));
          process.exit(1);
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("Google Veo 3.1")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Veo generation is synchronous - video URL available above"));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 1-3 minutes)...";
        finalResult = await gemini.waitForVideoCompletion(
          result.id,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          300000
        );
      } else if (provider === "grok") {
        // Grok Imagine video — placeholder for xAI integration
        console.error(chalk.red("Grok Imagine video provider is not yet implemented in the unified command."));
        console.error(chalk.dim("Use: vibe ai video -p grok (legacy command)"));
        process.exit(1);
      }

      if (!finalResult || finalResult.status !== "completed") {
        spinner.fail(chalk.red(finalResult?.error || "Generation failed"));
        process.exit(1);
      }

      spinner.succeed(chalk.green("Video generated"));

      if (isJsonMode()) {
        let outputPath: string | undefined;
        if (options.output && finalResult.videoUrl) {
          const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
          outputPath = resolve(process.cwd(), options.output);
          await writeFile(outputPath, buffer);
        }
        outputResult({ success: true, provider, taskId: result?.id, videoUrl: finalResult.videoUrl, duration: finalResult.duration, outputPath });
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
          downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
        }
      }
    } catch (error) {
      console.error(chalk.red("Video generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 3. Speech (was: ai tts)
// ============================================================================

generateCommand
  .command("speech")
  .description("Generate speech from text using ElevenLabs")
  .argument("<text>", "Text to convert to speech")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "output.mp3")
  .option("-v, --voice <id>", "Voice ID (default: Rachel)", "21m00Tcm4TlvDq8ikWAM")
  .option("--list-voices", "List available voices")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (text: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate speech", params: { text, voice: options.voice, output: options.output } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      // List voices mode
      if (options.listVoices) {
        const spinner = ora("Fetching voices...").start();
        const voices = await elevenlabs.getVoices();
        spinner.succeed(chalk.green(`Found ${voices.length} voices`));

        console.log();
        console.log(chalk.bold.cyan("Available Voices"));
        console.log(chalk.dim("─".repeat(60)));

        for (const voice of voices) {
          console.log();
          console.log(`${chalk.bold(voice.name)} ${chalk.dim(`(${voice.voice_id})`)}`);
          console.log(`  Category: ${voice.category}`);
          if (voice.labels) {
            const labels = Object.entries(voice.labels)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            console.log(`  ${chalk.dim(labels)}`);
          }
        }
        console.log();
        return;
      }

      const spinner = ora("Generating speech...").start();

      const result = await elevenlabs.textToSpeech(text, {
        voiceId: options.voice,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "TTS generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Speech generated"));

      if (isJsonMode()) {
        outputResult({ success: true, characterCount: result.characterCount, outputPath });
        return;
      }

      console.log();
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("TTS generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 4. Sound Effect (was: ai sfx)
// Note: -p is reserved for --provider; --prompt-influence is long-only
// ============================================================================

generateCommand
  .command("sound-effect")
  .description("Generate sound effect using ElevenLabs")
  .argument("<prompt>", "Description of the sound effect")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "sound-effect.mp3")
  .option("-d, --duration <seconds>", "Duration in seconds (0.5-22, default: auto)")
  .option("--prompt-influence <value>", "Prompt influence (0-1, default: 0.3)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate sound-effect", params: { prompt, duration: options.duration, promptInfluence: options.promptInfluence, output: options.output } });
        return;
      }

      const apiKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("ElevenLabs API key required. Use --api-key or set ELEVENLABS_API_KEY"));
        process.exit(1);
      }

      const spinner = ora("Generating sound effect...").start();

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.generateSoundEffect(prompt, {
        duration: options.duration ? parseFloat(options.duration) : undefined,
        promptInfluence: options.promptInfluence ? parseFloat(options.promptInfluence) : undefined,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(chalk.red(result.error || "Sound effect generation failed"));
        process.exit(1);
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Sound effect generated"));

      if (isJsonMode()) {
        outputResult({ success: true, outputPath });
        return;
      }

      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      console.error(chalk.red("Sound effect generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 5. Music
// ============================================================================

generateCommand
  .command("music")
  .description("Generate background music from a text prompt using MusicGen")
  .argument("<prompt>", "Description of the music to generate")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .option("-d, --duration <seconds>", "Duration in seconds (1-30)", "8")
  .option("-m, --melody <file>", "Reference melody audio file for conditioning")
  .option("--model <model>", "Model variant: large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
  .option("-o, --output <path>", "Output audio file path", "music.mp3")
  .option("--no-wait", "Don't wait for generation to complete (async mode)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate music", params: { prompt, duration: options.duration, model: options.model, output: options.output } });
        return;
      }

      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const spinner = ora("Starting music generation...").start();

      const duration = Math.max(1, Math.min(30, parseFloat(options.duration)));

      // If melody file provided, upload it first
      let melodyUrl: string | undefined;
      if (options.melody) {
        spinner.text = "Uploading melody reference...";
        const absPath = resolve(process.cwd(), options.melody);
        if (!existsSync(absPath)) {
          spinner.fail(chalk.red(`Melody file not found: ${options.melody}`));
          process.exit(1);
        }
        // For Replicate, we need a publicly accessible URL
        // In practice, users would need to host the file or use a data URL
        console.log(chalk.yellow("Note: Melody conditioning requires a publicly accessible URL"));
        console.log(chalk.yellow("Please upload your melody file and provide the URL"));
        process.exit(1);
      }

      const result = await replicate.generateMusic(prompt, {
        duration,
        model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large",
        melodyUrl,
      });

      if (!result.success || !result.taskId) {
        spinner.fail(chalk.red(result.error || "Music generation failed"));
        process.exit(1);
      }

      if (!options.wait) {
        spinner.succeed(chalk.green("Music generation started"));
        console.log();
        console.log(`Task ID: ${chalk.bold(result.taskId)}`);
        console.log(chalk.dim("Check status with: vibe generate music-status " + result.taskId));
        return;
      }

      spinner.text = "Generating music (this may take a few minutes)...";

      const finalResult = await replicate.waitForMusic(result.taskId);

      if (!finalResult.success || !finalResult.audioUrl) {
        spinner.fail(chalk.red(finalResult.error || "Music generation failed"));
        process.exit(1);
      }

      spinner.text = "Downloading generated audio...";

      const response = await fetch(finalResult.audioUrl);
      if (!response.ok) {
        spinner.fail(chalk.red("Failed to download generated audio"));
        process.exit(1);
      }

      const audioBuffer = Buffer.from(await response.arrayBuffer());
      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, audioBuffer);

      spinner.succeed(chalk.green("Music generated successfully"));

      if (isJsonMode()) {
        outputResult({ success: true, taskId: result.taskId, audioUrl: finalResult.audioUrl, outputPath });
        return;
      }

      console.log();
      console.log(`Saved to: ${chalk.bold(outputPath)}`);
      console.log(`Duration: ${duration}s`);
      console.log(`Model: ${options.model}`);
      console.log();
    } catch (error) {
      console.error(chalk.red("Music generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 6. Music Status
// ============================================================================

generateCommand
  .command("music-status")
  .description("Check music generation status")
  .argument("<task-id>", "Task ID from music generation")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Replicate API token required. Use --api-key or set REPLICATE_API_TOKEN"));
        process.exit(1);
      }

      const replicate = new ReplicateProvider();
      await replicate.initialize({ apiKey });

      const result = await replicate.getMusicStatus(taskId);

      if (isJsonMode()) {
        const status = result.audioUrl ? "completed" : result.error ? "failed" : "processing";
        outputResult({ success: true, taskId, status, audioUrl: result.audioUrl, error: result.error });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Music Generation Status"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`Task ID: ${taskId}`);

      if (result.audioUrl) {
        console.log(`Status: ${chalk.green("completed")}`);
        console.log(`Audio URL: ${result.audioUrl}`);
      } else if (result.error) {
        console.log(`Status: ${chalk.red("failed")}`);
        console.log(`Error: ${result.error}`);
      } else {
        console.log(`Status: ${chalk.yellow("processing")}`);
      }
      console.log();
    } catch (error) {
      console.error(chalk.red("Failed to get music status"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 7. Storyboard
// ============================================================================

generateCommand
  .command("storyboard")
  .description("Generate video storyboard from content using Claude")
  .argument("<content>", "Content to analyze (text or file path)")
  .option("-k, --api-key <key>", "Anthropic API key (or set ANTHROPIC_API_KEY env)")
  .option("-o, --output <path>", "Output JSON file path")
  .option("-d, --duration <sec>", "Target total duration in seconds")
  .option("-f, --file", "Treat content argument as file path")
  .option("-c, --creativity <level>", "Creativity level: low (default, consistent) or high (varied, unexpected)", "low")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (content: string, options) => {
    try {
      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        console.error(chalk.red("Invalid creativity level. Use 'low' or 'high'."));
        process.exit(1);
      }

      let textContent = content;
      if (options.file) {
        const filePath = resolve(process.cwd(), content);
        textContent = await readFile(filePath, "utf-8");
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate storyboard", params: { content: textContent.substring(0, 200), duration: options.duration, creativity } });
        return;
      }

      const apiKey = await getApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Anthropic API key required. Use --api-key or set ANTHROPIC_API_KEY"));
        process.exit(1);
      }

      const spinnerText = creativity === "high"
        ? "Analyzing content with high creativity..."
        : "Analyzing content...";
      const spinner = ora(spinnerText).start();

      const claude = new ClaudeProvider();
      await claude.initialize({ apiKey });

      const segments = await claude.analyzeContent(
        textContent,
        options.duration ? parseFloat(options.duration) : undefined,
        { creativity: creativity as "low" | "high" | undefined }
      );

      if (segments.length === 0) {
        spinner.fail(chalk.red("Could not generate storyboard"));
        process.exit(1);
      }

      spinner.succeed(chalk.green(`Generated ${segments.length} segments`));

      if (options.output) {
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
        if (isJsonMode()) {
          outputResult({ success: true, segmentCount: segments.length, segments, outputPath });
          return;
        }
      } else if (isJsonMode()) {
        outputResult({ success: true, segmentCount: segments.length, segments });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Storyboard"));
      console.log(chalk.dim("─".repeat(60)));

      for (const seg of segments) {
        console.log();
        console.log(chalk.yellow(`[${seg.index + 1}] ${formatTime(seg.startTime)} - ${formatTime(seg.startTime + seg.duration)}`));
        console.log(`  ${seg.description}`);
        console.log(chalk.dim(`  Visuals: ${seg.visuals}`));
        if (seg.audio) {
          console.log(chalk.dim(`  Audio: ${seg.audio}`));
        }
        if (seg.textOverlays && seg.textOverlays.length > 0) {
          console.log(chalk.dim(`  Text: ${seg.textOverlays.join(", ")}`));
        }
      }
      console.log();

      if (options.output) {
        console.log(chalk.green(`Saved to: ${resolve(process.cwd(), options.output)}`));
      }
    } catch (error) {
      console.error(chalk.red("Storyboard generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 8. Motion (delegated to registerMotionCommand)
// ============================================================================

registerMotionCommand(generateCommand);

// ============================================================================
// 9. Thumbnail
// ============================================================================

generateCommand
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
    try {
      // Best-frame mode: analyze video with Gemini and extract frame
      if (options.bestFrame) {
        const absVideoPath = resolve(process.cwd(), options.bestFrame);
        if (!existsSync(absVideoPath)) {
          console.error(chalk.red(`Video not found: ${absVideoPath}`));
          process.exit(1);
        }

        if (!commandExists("ffmpeg")) {
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

        if (isJsonMode()) {
          outputResult({ success: true, timestamp: result.timestamp, reason: result.reason, outputPath: result.outputPath });
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
        console.error(chalk.red("Description required for thumbnail generation."));
        console.error(chalk.dim("Usage: vibe generate thumbnail <description> or vibe generate thumbnail --best-frame <video>"));
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
      console.error(chalk.red("Thumbnail generation failed"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 10. Background
// ============================================================================

generateCommand
  .command("background")
  .description("Generate video background using DALL-E")
  .argument("<description>", "Background description")
  .option("-k, --api-key <key>", "OpenAI API key (or set OPENAI_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads image)")
  .option("-a, --aspect <ratio>", "Aspect ratio: 16:9, 9:16, 1:1", "16:9")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (description: string, options) => {
    try {
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate background", params: { description, aspect: options.aspect, output: options.output } });
        return;
      }

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

// ============================================================================
// 11. Video Status (merged: ai video-status + ai kling-status)
// ============================================================================

generateCommand
  .command("video-status")
  .description("Check video generation status (Runway or Kling)")
  .argument("<task-id>", "Task ID from video generation")
  .option("-p, --provider <provider>", "Provider: runway, kling", "runway")
  .option("-k, --api-key <key>", "API key (or set RUNWAY_API_SECRET / KLING_API_KEY env)")
  .option("-t, --type <type>", "Task type: text2video or image2video (Kling only)", "text2video")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
    try {
      const provider = (options.provider || "runway").toLowerCase();

      if (provider === "runway") {
        const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Runway API key required"));
          process.exit(1);
        }

        const spinner = ora("Checking status...").start();

        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        let result = await runway.getGenerationStatus(taskId);

        if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
          spinner.text = "Waiting for completion...";
          result = await runway.waitForCompletion(
            taskId,
            (status) => {
              if (status.progress !== undefined) {
                spinner.text = `Generating... ${status.progress}%`;
              }
            }
          );
        }

        spinner.stop();

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && result.videoUrl) {
            const buffer = await downloadVideo(result.videoUrl, apiKey);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, taskId, provider: "runway", status: result.status, videoUrl: result.videoUrl, progress: result.progress, error: result.error, outputPath });
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else if (provider === "kling") {
        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Kling API key required"));
          process.exit(1);
        }

        const spinner = ora("Checking status...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        const taskType = options.type as "text2video" | "image2video";
        let result = await kling.getGenerationStatus(taskId, taskType);

        if (options.wait && result.status !== "completed" && result.status !== "failed" && result.status !== "cancelled") {
          spinner.text = "Waiting for completion...";
          result = await kling.waitForCompletion(
            taskId,
            taskType,
            (status) => {
              spinner.text = `Generating... ${status.status}`;
            }
          );
        }

        spinner.stop();

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && result.videoUrl) {
            const buffer = await downloadVideo(result.videoUrl, apiKey);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, taskId, provider: "kling", status: result.status, videoUrl: result.videoUrl, duration: result.duration, error: result.error, outputPath });
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else {
        console.error(chalk.red(`Invalid provider: ${provider}. Use runway or kling.`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Failed to get status"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 12. Video Cancel
// ============================================================================

generateCommand
  .command("video-cancel")
  .description("Cancel Runway video generation")
  .argument("<task-id>", "Task ID to cancel")
  .option("-k, --api-key <key>", "Runway API key (or set RUNWAY_API_SECRET env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await getApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);
      if (!apiKey) {
        console.error(chalk.red("Runway API key required"));
        process.exit(1);
      }

      const spinner = ora("Cancelling generation...").start();

      const runway = new RunwayProvider();
      await runway.initialize({ apiKey });

      const success = await runway.cancelGeneration(taskId);

      if (success) {
        spinner.succeed(chalk.green("Generation cancelled"));
        if (isJsonMode()) {
          outputResult({ success: true, taskId, cancelled: true });
          return;
        }
      } else {
        spinner.fail(chalk.red("Failed to cancel generation"));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Failed to cancel"));
      console.error(error);
      process.exit(1);
    }
  });

// ============================================================================
// 13. Video Extend (merged: ai video-extend + ai veo-extend)
// Note: --prompt is long-only (-p is reserved for --provider)
// ============================================================================

generateCommand
  .command("video-extend")
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

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate video-extend", params: { id, provider, prompt: options.prompt, duration: options.duration, negative: options.negative, veoModel: options.veoModel } });
        return;
      }

      if (provider === "kling") {
        const apiKey = await getApiKey("KLING_API_KEY", "Kling", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Kling API key required."));
          console.error(chalk.dim("Format: ACCESS_KEY:SECRET_KEY"));
          console.error(chalk.dim("Use --api-key or set KLING_API_KEY environment variable"));
          process.exit(1);
        }

        const spinner = ora("Initializing Kling AI...").start();

        const kling = new KlingProvider();
        await kling.initialize({ apiKey });

        if (!kling.isConfigured()) {
          spinner.fail(chalk.red("Invalid API key format. Use ACCESS_KEY:SECRET_KEY"));
          process.exit(1);
        }

        spinner.text = "Starting video extension...";

        const result = await kling.extendVideo(id, {
          prompt: options.prompt,
          negativePrompt: options.negative,
          duration: options.duration as "5" | "10",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start extension"));
          process.exit(1);
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
          600000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(chalk.red(finalResult.error || "Extension failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Video extended"));

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && finalResult.videoUrl) {
            const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, provider: "kling", taskId: result.id, videoUrl: finalResult.videoUrl, duration: finalResult.duration, outputPath });
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else if (provider === "veo") {
        const apiKey = await getApiKey("GOOGLE_API_KEY", "Google", options.apiKey);
        if (!apiKey) {
          console.error(chalk.red("Google API key required."));
          console.error(chalk.dim("Use --api-key or set GOOGLE_API_KEY environment variable"));
          process.exit(1);
        }

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
          model: veoModel as "veo-3.0-generate-preview" | "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview",
        });

        if (result.status === "failed") {
          spinner.fail(chalk.red(result.error || "Failed to start extension"));
          process.exit(1);
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
          300000
        );

        if (finalResult.status !== "completed") {
          spinner.fail(chalk.red(finalResult.error || "Extension failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Video extended"));

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && finalResult.videoUrl) {
            const buffer = await downloadVideo(finalResult.videoUrl, apiKey);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, provider: "veo", taskId: result.id, videoUrl: finalResult.videoUrl, duration: finalResult.duration, outputPath });
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else {
        console.error(chalk.red(`Invalid provider: ${provider}. Video extend supports: kling, veo`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("Video extension failed"));
      console.error(error);
      process.exit(1);
    }
  });
