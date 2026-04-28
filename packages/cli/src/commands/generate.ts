/**
 * @module generate
 *
 * Top-level `vibe generate` command group for AI asset generation.
 *
 * Commands:
 *   generate image          - Generate image (Gemini, OpenAI, Grok, Runway)
 *   generate video          - Generate video (Kling, Runway, Veo, Grok)
 *   generate speech         - Text-to-speech (ElevenLabs)
 *   generate sound-effect   - Sound effects (ElevenLabs)
 *   generate music          - Music generation (ElevenLabs default, Replicate MusicGen)
 *   generate music-status   - Check music generation status
 *   generate storyboard     - Script-to-storyboard (Claude)
 *   generate motion         - Motion graphics (Claude/Gemini + Remotion)
 *   generate thumbnail      - Thumbnail generation/extraction
 *   generate background     - AI background generation (OpenAI)
 *   generate video-status   - Check video generation status (Grok/Runway/Kling)
 *   generate video-cancel   - Cancel video generation (Grok/Runway)
 *   generate video-extend   - Extend video (Kling/Veo)
 *
 * @dependencies OpenAI, Gemini, Runway, Kling, ElevenLabs, Replicate, Claude, FFmpeg
 */

import { Command } from "commander";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import imageSize from "image-size";
import {
  GeminiProvider,
  OpenAIImageProvider,
  KlingProvider,
  RunwayProvider,
  ElevenLabsProvider,
  ReplicateProvider,
  ClaudeProvider,
  GrokProvider,
  FalProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../utils/tty.js";
import { getApiKeyFromConfig } from "../config/index.js";
import { sanitizeLLMResponse } from "./sanitize.js";
import { isJsonMode, outputResult, log, exitWithError, usageError, apiError, generalError, authError, notFoundError } from "./output.js";
import { commandExists } from "../utils/exec-safe.js";
import { uploadToImgbb } from "./ai-script-pipeline.js";
import { downloadVideo, formatTime } from "./ai-helpers.js";
import { rejectControlChars, validateOutputPath } from "./validate.js";
import { resolveProvider } from "../utils/provider-resolver.js";
import { getProvidersFor } from "@vibeframe/ai-providers";
import { executeThumbnailBestFrame } from "./ai-image.js";
import { registerMotionCommand } from "./ai-motion.js";
import { executeOpenAIImageGenerate } from "./_shared/openai-image.js";

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

export const generateCommand = new Command("generate")
  .alias("gen")
  .description(
    "Generate assets using AI (images, videos, speech, music, motion)"
  )
  .addHelpText(
    "after",
    `
Examples:
  $ vibe generate image "a sunset over the ocean" -o sunset.png
  $ vibe generate image "logo design" -o logo.png -p openai
  $ vibe generate video "dancing cat" -o cat.mp4                  # Grok (default, native audio)
  $ vibe generate video "city timelapse" -o city.mp4 -p kling     # Kling
  $ vibe generate video "epic scene" -i frame.png -o out.mp4 -p runway  # Image-to-video
  $ vibe generate speech "Hello world" -o hello.mp3
  $ vibe generate music "upbeat jazz" -o jazz.mp3 -d 30
  $ vibe generate motion "animated logo intro" -o intro.mp4 --render

API Keys (per provider):
  GOOGLE_API_KEY     Image (default), Veo video
  OPENAI_API_KEY     Image (-p openai)
  XAI_API_KEY        Grok image/video (default video)
  KLING_API_KEY      Kling video (-p kling)
  RUNWAY_API_SECRET  Runway video (-p runway)
  ELEVENLABS_API_KEY Speech, sound effects, music
  ANTHROPIC_API_KEY  Storyboard, motion graphics

Run 'vibe setup --show' to check API key status.
Run 'vibe schema generate.<command>' for structured parameter info.
`
  );

// ============================================================================
// 1. Image
// ============================================================================

generateCommand
  .command("image")
  .alias("img")
  .description("Generate image using AI (Gemini, DALL-E, or Runway)")
  .argument("[prompt]", "Image description prompt (interactive if omitted)")
  .option("-p, --provider <provider>", "Provider: openai (default when OPENAI_API_KEY set), gemini, grok, runway (dalle is deprecated)")
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
          exitWithError(usageError("Prompt argument is required.", "Usage: vibe generate image <prompt>"));
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
      // image-kind providers. `dalle` (deprecated alias) and `runway`
      // (image variant accepted by CLI but not in auto-resolver) are
      // explicit overrides — adding a new image provider in the registry
      // auto-propagates here.
      const imageRegistry = getProvidersFor("image");
      const validProviders = [...imageRegistry.map((p) => p.name), "dalle", "runway"];
      const providerEnvMap: Record<string, string> = Object.fromEntries(
        imageRegistry
          .filter((p): p is typeof p & { envVar: string } => p.envVar !== null)
          .map((p) => [p.name, p.envVar]),
      );
      const envKeyMap: Record<string, string> = {
        ...providerEnvMap,
        dalle: "OPENAI_API_KEY",
        runway: "RUNWAY_API_SECRET",
      };
      const providerNameMap: Record<string, string> = {
        ...Object.fromEntries(imageRegistry.map((p) => [p.name, p.label])),
        // Override Gemini's resolver label "Gemini" with the more specific
        // "Google" used in error messages, and add aliases.
        gemini: "Google",
        grok: "xAI Grok",
        dalle: "OpenAI",
        runway: "Runway",
      };
      let provider: string;
      if (options.provider) {
        provider = options.provider.toLowerCase();
        if (!validProviders.includes(provider)) {
          exitWithError(usageError(`Invalid provider: ${provider}`, `Available providers: ${imageRegistry.map((p) => p.name).join(", ")}, runway`));
        }
        // Explicit choice's key missing → fall back via resolver
        if (providerEnvMap[provider] && !hasApiKey(providerEnvMap[provider]) && !options.apiKey) {
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

      // Show deprecation warning for "dalle"
      if (provider === "dalle") {
        console.log(chalk.yellow('Warning: "dalle" is deprecated. Use "openai" instead.'));
      }

      // Dry-run check
      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate image", params: { prompt, provider, model: options.model, ratio: options.ratio, size: options.size, quality: options.quality, count: options.count, output: options.output } });
        return;
      }

      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];

      const apiKey = await requireApiKey(envKey, providerName, options.apiKey);

      const spinner = ora(`Generating image with ${providerName}...`).start();

      if (provider === "dalle" || provider === "openai") {
        const { result, modelLabel } = await executeOpenAIImageGenerate(prompt, options, { apiKey });

        if (!result.success || !result.images) {
          spinner.fail(result.error || "Image generation failed");
          exitWithError(apiError(result.error || "Image generation failed", true));
        }

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with OpenAI ${modelLabel}`));

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
          spinner.fail(result.error || "Image generation failed");
          exitWithError(apiError(result.error || "Image generation failed", true));
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
      } else if (provider === "grok") {
        const grok = new GrokProvider();
        await grok.initialize({ apiKey });

        // Validate aspect ratio for Grok
        const validGrokRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", "auto"];
        if (options.ratio && !validGrokRatios.includes(options.ratio)) {
          console.warn(chalk.yellow(`Unknown ratio "${options.ratio}" for Grok, using 1:1. Valid: ${validGrokRatios.join(", ")}`));
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

        spinner.succeed(chalk.green(`Generated ${result.images.length} image(s) with xAI Grok`));

        if (isJsonMode()) {
          const outputPath = options.output ? resolve(process.cwd(), options.output) : undefined;
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
          outputResult({ success: true, provider: "grok", images: result.images.map(img => ({ url: img.url })), outputPath });
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
            saveSpinner.fail(chalk.red(`Failed to save image: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else if (provider === "runway") {
        const { spawn } = await import("child_process");
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const scriptPath = resolve(__dirname, "../../../../.claude/skills/runway-video/scripts/image.py");

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
      exitWithError(apiError(`Image generation failed: ${(error as Error).message}`));
    }
  });

// ============================================================================
// 2. Video (merged: ai video + ai kling, unified via --provider)
// ============================================================================

generateCommand
  .command("video")
  .alias("vid")
  .description("Generate video using AI (Kling, Runway, Veo, or Grok)")
  .argument("[prompt]", "Text prompt describing the video (interactive if omitted)")
  .option("-p, --provider <provider>", "Provider: fal (Seedance 2.0, default when FAL_KEY set), grok, kling, runway, veo")
  .option("-k, --api-key <key>", "API key (or set XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY / GOOGLE_API_KEY env)")
  .option("-o, --output <path>", "Output file path (downloads video)")
  .option("-i, --image <path>", "Reference image for image-to-video")
  .option("-d, --duration <sec>", "Duration: 5 or 10 seconds", "5")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, or 1:1 (auto-detected from image if omitted)")
  .option("-s, --seed <number>", "Random seed for reproducibility (Runway only)")
  .option("-m, --mode <mode>", "Generation mode: std or pro (Kling only)", "std")
  .option("-n, --negative <prompt>", "Negative prompt - what to avoid (Kling/Veo)")
  .option("--resolution <res>", "Video resolution: 720p, 1080p, 4k (Veo only)")
  .option("--last-frame <path>", "Last frame image for frame interpolation (Veo only)")
  .option("--ref-images <paths...>", "Reference images for character consistency (Veo 3.1 only, max 3)")
  .option("--person <mode>", "Person generation: allow_all, allow_adult (Veo only)")
  .option("--veo-model <model>", "Veo model: 3.0, 3.1, 3.1-fast (default: 3.1-fast)", "3.1-fast")
  .option("--runway-model <model>", "Runway model: gen4.5 (default, text+image-to-video), gen4_turbo (image-to-video only)", "gen4.5")
  .option("--no-wait", "Start generation and return task ID without waiting")
  .option("--dry-run", "Preview parameters without executing")
  .addHelpText("after", `
Examples:
  $ vibe generate video "dancing cat" -o cat.mp4                      # Grok (default)
  $ vibe gen vid "city timelapse" -o city.mp4 -p kling                # Kling
  $ vibe gen vid "epic scene" -i frame.png -o out.mp4 -p runway       # Image-to-video
  $ vibe gen vid "ocean waves" -o waves.mp4 -p veo --resolution 1080p # Veo
  $ vibe gen vid "sunset" -o sun.mp4 -d 10 --dry-run --json`)
  .action(async (prompt: string | undefined, options) => {
    try {
      // Interactive prompt if no argument provided
      if (!prompt) {
        if (hasTTY()) {
          prompt = await promptText(chalk.cyan("Describe your video: "));
          if (!prompt?.trim()) {
            exitWithError(usageError("Prompt is required."));
          }
        } else {
          exitWithError(usageError("Prompt argument is required.", "Usage: vibe generate video <prompt>"));
        }
      }
      rejectControlChars(prompt);
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Resolve provider:
      //  - explicit -p flag wins (validated, then key-presence checked)
      //  - no flag → VIDEO_PROVIDERS priority list (fal > grok > veo > kling > runway)
      //  - if no keys at all → keep grok as last-resort default so the
      //    later requireApiKey() prints a friendly Grok-specific message
      const validProviders = ["runway", "kling", "veo", "grok", "fal"];
      const videoEnvMap: Record<string, string> = {
        grok: "XAI_API_KEY", veo: "GOOGLE_API_KEY", kling: "KLING_API_KEY", runway: "RUNWAY_API_SECRET",
        fal: "FAL_KEY",
      };
      let provider: string;
      if (options.provider) {
        provider = options.provider.toLowerCase();
        if (!validProviders.includes(provider)) {
          exitWithError(usageError(`Invalid provider: ${provider}`, `Available providers: ${validProviders.join(", ")}`));
        }
        if (videoEnvMap[provider] && !hasApiKey(videoEnvMap[provider]) && !options.apiKey) {
          const resolved = resolveProvider("video");
          if (resolved) {
            log(chalk.dim(`  ${provider} key not found. Using ${resolved.label} instead.`));
            provider = resolved.name;
          }
        }
      } else {
        const resolved = resolveProvider("video");
        provider = resolved?.name ?? "grok";
      }

      // Read image early so we can auto-detect aspect ratio before dry-run
      let referenceImage: string | undefined;
      let isImageToVideo = false;
      if (options.image) {
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

        // Auto-detect aspect ratio from image dimensions when not explicitly set
        if (!options.ratio) {
          const dimensions = imageSize(imageBuffer);
          if (dimensions.width && dimensions.height) {
            const ratio = dimensions.width / dimensions.height;
            if (ratio > 1.2) {
              options.ratio = "16:9";
            } else if (ratio < 0.8) {
              options.ratio = "9:16";
            } else {
              options.ratio = "1:1";
            }
            log(`Auto-detected aspect ratio: ${options.ratio} (${dimensions.width}x${dimensions.height})`);
          }
        }
      }

      // Default to 16:9 when no image and no explicit ratio
      if (!options.ratio) {
        options.ratio = "16:9";
      }

      // Veo and Runway only support 16:9 and 9:16 — clamp 1:1 to 16:9
      if ((provider === "veo" || provider === "runway") && options.ratio === "1:1") {
        log(`${provider} does not support 1:1 — falling back to 16:9`);
        options.ratio = "16:9";
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
        fal: "FAL_KEY",
      };
      const providerNameMap: Record<string, string> = {
        runway: "Runway",
        kling: "Kling",
        veo: "Veo",
        grok: "Grok",
        fal: "fal.ai (Seedance 2.0)",
      };
      const envKey = envKeyMap[provider];
      const providerName = providerNameMap[provider];
      const apiKey = await requireApiKey(envKey, providerName, options.apiKey);

      // Runway gen4_turbo requires an input image; gen4.5 supports text-to-video
      const runwayModel = (options.runwayModel as string) || "gen4.5";
      if (provider === "runway" && !options.image && runwayModel !== "gen4.5") {
        exitWithError(usageError(`Runway ${runwayModel} requires an input image. Use -i <image> or use gen4.5 for text-to-video.`));
      }

      const spinner = ora(`Initializing ${providerName}...`).start();

      spinner.text = "Starting video generation...";

      let result;
      let finalResult;

      if (provider === "runway") {
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });

        result = await runway.generateVideo(prompt, {
          prompt,
          referenceImage,
          model: runwayModel,
          duration: parseInt(options.duration),
          aspectRatio: options.ratio as "16:9" | "9:16",
          seed: options.seed ? parseInt(options.seed) : undefined,
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start generation");
          exitWithError(apiError(result.error || "Failed to start generation", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold(`Runway ${runwayModel}`)}`);
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
          spinner.fail("Invalid API key format");
          exitWithError(authError("KLING_API_KEY", "Kling"));
        }

        // Kling v2.x requires image URL, not base64 — auto-upload to ImgBB
        let klingImage = referenceImage;
        if (klingImage && klingImage.startsWith("data:")) {
          spinner.text = "Uploading image to ImgBB for Kling...";
          const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
          if (!imgbbKey) {
            spinner.fail("ImgBB API key required");
            exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
          }
          // Extract raw base64 from data URI
          const base64Data = klingImage.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
          if (!uploadResult.success || !uploadResult.url) {
            spinner.fail("ImgBB upload failed");
            exitWithError(apiError(`ImgBB upload failed: ${uploadResult.error}`, true));
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
          spinner.fail(result.error || "Failed to start generation");
          exitWithError(apiError(result.error || "Failed to start generation", true));
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
          spinner.fail(result.error || "Failed to start generation");
          exitWithError(apiError(result.error || "Failed to start generation", true));
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
        const grok = new GrokProvider();
        await grok.initialize({ apiKey });

        result = await grok.generateVideo(prompt, {
          prompt,
          referenceImage,
          duration: parseInt(options.duration),
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1",
        });

        if (result.status === "failed") {
          spinner.fail(result.error || "Failed to start generation");
          exitWithError(apiError(result.error || "Failed to start generation", true));
        }

        console.log();
        console.log(chalk.bold.cyan("Video Generation Started"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Provider: ${chalk.bold("xAI Grok Imagine")}`);
        console.log(`Task ID: ${chalk.bold(result.id)}`);

        if (!options.wait) {
          spinner.succeed(chalk.green("Generation started"));
          console.log();
          console.log(chalk.dim("Check status with:"));
          console.log(chalk.dim(`  vibe generate video-status ${result.id} -p grok`));
          console.log();
          return;
        }

        spinner.text = "Generating video (this may take 1-3 minutes)...";
        finalResult = await grok.waitForCompletion(
          result.id,
          (status) => {
            spinner.text = `Generating video... ${status.status}`;
          },
          300000
        );
      } else if (provider === "fal") {
        // fal.ai → ByteDance Seedance 2.0 (Artificial Analysis #2 on
        // both video leaderboards). The fal client's `subscribe` blocks
        // until the queue produces a final URL, so we don't need a
        // separate wait/poll loop like the other providers.
        const fal = new FalProvider();
        await fal.initialize({ apiKey });

        // Seedance 2.0 image-to-video needs an HTTPS URL. base64 / data
        // URIs aren't accepted, so reuse the same ImgBB upload trick
        // Kling uses when an image was passed via `-i`.
        let falImage = referenceImage;
        if (falImage && falImage.startsWith("data:")) {
          spinner.text = "Uploading image to ImgBB for fal...";
          const imgbbKey = (await getApiKeyFromConfig("imgbb")) || process.env.IMGBB_API_KEY;
          if (!imgbbKey) {
            spinner.fail("ImgBB API key required for fal image-to-video");
            exitWithError(authError("IMGBB_API_KEY", "ImgBB"));
          }
          const base64Data = falImage.split(",")[1];
          const imageBuffer = Buffer.from(base64Data, "base64");
          const uploadResult = await uploadToImgbb(imageBuffer, imgbbKey);
          if (!uploadResult.success || !uploadResult.url) {
            spinner.fail("ImgBB upload failed");
            exitWithError(apiError(`ImgBB upload failed: ${uploadResult.error}`, true));
          }
          falImage = uploadResult.url;
        }

        spinner.text = "Generating video with Seedance 2.0 (this may take 1-3 minutes)...";
        const falModel = options.model === "fast" ? "seedance-2.0-fast" : "seedance-2.0";
        result = await fal.generateVideo(prompt, {
          prompt,
          referenceImage: falImage,
          duration: options.duration ? parseInt(options.duration) : undefined,
          aspectRatio: options.ratio as "16:9" | "9:16" | "1:1" | "4:5",
          negativePrompt: options.negative,
          model: falModel,
        });
        finalResult = result;
      }

      if (!finalResult || finalResult.status !== "completed") {
        spinner.fail(finalResult?.error || "Generation failed");
        exitWithError(apiError(finalResult?.error || "Generation failed", true));
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
      exitWithError(apiError(`Video generation failed: ${(error as Error).message}`));
    }
  });

// ============================================================================
// 3. Speech (was: ai tts)
// ============================================================================

generateCommand
  .command("speech")
  .alias("tts")
  .description("Generate speech from text using ElevenLabs")
  .argument("[text]", "Text to convert to speech (interactive if omitted)")
  .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
  .option("-o, --output <path>", "Output audio file path", "output.mp3")
  .option("-v, --voice <id>", "Voice ID (default: Rachel)", "21m00Tcm4TlvDq8ikWAM")
  .option("--list-voices", "List available voices")
  .option("--fit-duration <seconds>", "Speed up audio to fit target duration (via FFmpeg atempo)", parseFloat)
  .option("--dry-run", "Preview parameters without executing")
  .action(async (text: string | undefined, options) => {
    try {
      // Interactive prompt if no argument provided
      if (!text) {
        if (hasTTY()) {
          text = await promptText(chalk.cyan("What text to speak? "));
          if (!text?.trim()) {
            exitWithError(usageError("Text is required."));
          }
        } else {
          exitWithError(usageError("Text argument is required.", "Usage: vibe generate speech <text>"));
        }
      }
      rejectControlChars(text);
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate speech", params: { text, voice: options.voice, output: options.output } });
        return;
      }

      const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

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
        spinner.fail(result.error || "TTS generation failed");
        exitWithError(apiError(result.error || "TTS generation failed", true));
      }

      const outputPath = resolve(process.cwd(), options.output);
      await writeFile(outputPath, result.audioBuffer);

      spinner.succeed(chalk.green("Speech generated"));

      // Post-process: fit to target duration via atempo
      if (options.fitDuration && options.fitDuration > 0) {
        const { ffprobeDuration, execSafe } = await import("../utils/exec-safe.js");
        const actualDuration = await ffprobeDuration(outputPath);

        if (actualDuration > options.fitDuration) {
          const tempo = actualDuration / options.fitDuration;
          if (tempo > 2.0) {
            log(chalk.yellow(`Warning: Audio is ${tempo.toFixed(1)}x longer than target — would sound unnatural. Skipping tempo adjustment.`));
          } else {
            const fitSpinner = ora(`Adjusting tempo (${tempo.toFixed(3)}x) to fit ${options.fitDuration}s...`).start();
            const tempPath = outputPath.replace(/(\.\w+)$/, `.tempo$1`);
            try {
              await execSafe("ffmpeg", [
                "-y", "-i", outputPath,
                "-filter:a", `atempo=${tempo.toFixed(4)}`,
                "-vn", tempPath,
              ]);
              const { rename } = await import("node:fs/promises");
              await rename(tempPath, outputPath);
              fitSpinner.succeed(chalk.green(`Adjusted to fit ${options.fitDuration}s (${tempo.toFixed(3)}x speed)`));
            } catch (err) {
              fitSpinner.fail(chalk.yellow("Tempo adjustment failed — keeping original audio"));
            }
          }
        } else {
          log(chalk.dim(`Audio (${actualDuration.toFixed(2)}s) already fits within ${options.fitDuration}s`));
        }
      }

      if (isJsonMode()) {
        outputResult({ success: true, characterCount: result.characterCount, outputPath });
        return;
      }

      console.log();
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${outputPath}`));
      console.log();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`TTS generation failed: ${msg}`, true));
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
      rejectControlChars(prompt);
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate sound-effect", params: { prompt, duration: options.duration, promptInfluence: options.promptInfluence, output: options.output } });
        return;
      }

      const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

      const spinner = ora("Generating sound effect...").start();

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const result = await elevenlabs.generateSoundEffect(prompt, {
        duration: options.duration ? parseFloat(options.duration) : undefined,
        promptInfluence: options.promptInfluence ? parseFloat(options.promptInfluence) : undefined,
      });

      if (!result.success || !result.audioBuffer) {
        spinner.fail(result.error || "Sound effect generation failed");
        exitWithError(apiError(result.error || "Sound effect generation failed", true));
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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Sound effect generation failed: ${msg}`, true));
    }
  });

// ============================================================================
// 5. Music
// ============================================================================

generateCommand
  .command("music")
  .description("Generate background music from a text prompt (ElevenLabs or Replicate MusicGen)")
  .argument("<prompt>", "Description of the music to generate")
  .option("-p, --provider <provider>", "Provider: elevenlabs (default, up to 10min), replicate (MusicGen, max 30s)", "elevenlabs")
  .option("-k, --api-key <key>", "API key (or set ELEVENLABS_API_KEY / REPLICATE_API_TOKEN env)")
  .option("-d, --duration <seconds>", "Duration in seconds (elevenlabs: 3-600, replicate: 1-30)", "8")
  .option("--instrumental", "Force instrumental music, no vocals (ElevenLabs only)")
  .option("-m, --melody <file>", "Reference melody audio file for conditioning (Replicate only)")
  .option("--model <model>", "Model variant (Replicate only): large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
  .option("-o, --output <path>", "Output audio file path", "music.mp3")
  .option("--no-wait", "Don't wait for generation to complete (Replicate async mode)")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (prompt: string, options) => {
    try {
      rejectControlChars(prompt);
      if (options.output) {
        validateOutputPath(options.output);
      }

      const provider = (options.provider || "elevenlabs").toLowerCase();

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate music", params: { prompt, provider, duration: options.duration, model: options.model, output: options.output, instrumental: options.instrumental } });
        return;
      }

      if (provider === "elevenlabs") {
        // ElevenLabs Music API — synchronous, up to 10 minutes
        const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey });

        const duration = Math.max(3, Math.min(600, parseFloat(options.duration)));
        const spinner = ora(`Generating music (${duration}s)...`).start();

        const result = await elevenlabs.generateMusic(prompt, {
          duration,
          forceInstrumental: options.instrumental || false,
        });

        if (!result.success || !result.audioBuffer) {
          spinner.fail(result.error || "Music generation failed");
          exitWithError(apiError(result.error || "Music generation failed", true));
        }

        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, result.audioBuffer);

        spinner.succeed(chalk.green("Music generated successfully"));

        if (isJsonMode()) {
          outputResult({ success: true, provider: "elevenlabs", outputPath, duration });
          return;
        }

        console.log();
        console.log(`Saved to: ${chalk.bold(outputPath)}`);
        console.log(`Duration: ${duration}s`);
        console.log(`Provider: ElevenLabs (music_v1)`);
        if (options.instrumental) console.log(`Mode: Instrumental`);
        console.log();
      } else {
        // Replicate MusicGen — async, max 30 seconds
        const apiKey = await requireApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);

        const replicate = new ReplicateProvider();
        await replicate.initialize({ apiKey });

        const spinner = ora("Starting music generation...").start();

        const duration = Math.max(1, Math.min(30, parseFloat(options.duration)));

        // If melody file provided, upload it first
        if (options.melody) {
          spinner.text = "Uploading melody reference...";
          const absPath = resolve(process.cwd(), options.melody);
          if (!existsSync(absPath)) {
            spinner.fail(`Melody file not found: ${options.melody}`);
            exitWithError(notFoundError(options.melody));
          }
          exitWithError(usageError("Melody conditioning requires a publicly accessible URL", "Please upload your melody file and provide the URL."));
        }

        const result = await replicate.generateMusic(prompt, {
          duration,
          model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large",
        });

        if (!result.success || !result.taskId) {
          spinner.fail(result.error || "Music generation failed");
          exitWithError(apiError(result.error || "Music generation failed", true));
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
          spinner.fail(finalResult.error || "Music generation failed");
          exitWithError(apiError(finalResult.error || "Music generation failed", true));
        }

        spinner.text = "Downloading generated audio...";

        const response = await fetch(finalResult.audioUrl);
        if (!response.ok) {
          spinner.fail("Failed to download generated audio");
          exitWithError(apiError("Failed to download generated audio", true));
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const outputPath = resolve(process.cwd(), options.output);
        await writeFile(outputPath, audioBuffer);

        spinner.succeed(chalk.green("Music generated successfully"));

        if (isJsonMode()) {
          outputResult({ success: true, provider: "replicate", taskId: result.taskId, audioUrl: finalResult.audioUrl, outputPath });
          return;
        }

        console.log();
        console.log(`Saved to: ${chalk.bold(outputPath)}`);
        console.log(`Duration: ${duration}s`);
        console.log(`Model: ${options.model}`);
        console.log();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Music generation failed: ${msg}`, true));
    }
  });

// ============================================================================
// 6. Music Status
// ============================================================================

generateCommand
  .command("music-status", { hidden: true })
  .description("Check music generation status")
  .argument("<task-id>", "Task ID from music generation")
  .option("-k, --api-key <key>", "Replicate API token (or set REPLICATE_API_TOKEN env)")
  .action(async (taskId: string, options) => {
    try {
      const apiKey = await requireApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Failed to get music status: ${msg}`, true));
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
      rejectControlChars(content);
      if (options.output) {
        validateOutputPath(options.output);
      }

      // Validate creativity level
      const creativity = options.creativity?.toLowerCase();
      if (creativity && creativity !== "low" && creativity !== "high") {
        exitWithError(usageError("Invalid creativity level. Use 'low' or 'high'."));
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

      const apiKey = await requireApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);

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
        spinner.fail("Could not generate storyboard");
        exitWithError(apiError("Could not generate storyboard", true));
      }

      spinner.succeed(chalk.green(`Generated ${segments.length} segments`));

      for (const seg of segments) {
        seg.description = sanitizeLLMResponse(seg.description);
        if (seg.visuals) seg.visuals = sanitizeLLMResponse(seg.visuals);
      }

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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Storyboard generation failed: ${msg}`, true));
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
          exitWithError(generalError("FFmpeg not found", "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"));
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
        exitWithError(usageError("Description required for thumbnail generation.", "Usage: vibe generate thumbnail <description> or vibe generate thumbnail --best-frame <video>"));
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
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Thumbnail generation failed: ${msg}`, true));
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
      rejectControlChars(description);
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputResult({ dryRun: true, command: "generate background", params: { description, aspect: options.aspect, output: options.output } });
        return;
      }

      const apiKey = await requireApiKey("OPENAI_API_KEY", "OpenAI", options.apiKey);

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
        } catch (err) {
          saveSpinner.fail(chalk.red("Failed to save background"));
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Background generation failed: ${msg}`, true));
    }
  });

// ============================================================================
// 11. Video Status (merged: ai video-status + ai kling-status)
// ============================================================================

generateCommand
  .command("video-status", { hidden: true })
  .description("Check video generation status (Grok, Runway, or Kling)")
  .argument("<task-id>", "Task ID from video generation")
  .option("-p, --provider <provider>", "Provider: grok, runway, kling", "grok")
  .option("-k, --api-key <key>", "API key (or set XAI_API_KEY / RUNWAY_API_SECRET / KLING_API_KEY env)")
  .option("-t, --type <type>", "Task type: text2video or image2video (Kling only)", "text2video")
  .option("-w, --wait", "Wait for completion")
  .option("-o, --output <path>", "Download video when complete")
  .action(async (taskId: string, options) => {
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
          result = await grok.waitForCompletion(
            taskId,
            (status) => {
              spinner.text = `Generating... ${status.status}`;
            }
          );
        }

        spinner.stop();

        if (isJsonMode()) {
          let outputPath: string | undefined;
          if (options.output && result.videoUrl) {
            const buffer = await downloadVideo(result.videoUrl);
            outputPath = resolve(process.cwd(), options.output);
            await writeFile(outputPath, buffer);
          }
          outputResult({ success: true, taskId, provider: "grok", status: result.status, videoUrl: result.videoUrl, error: result.error, outputPath });
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
            downloadSpinner.fail(chalk.red(`Failed to download video: ${err instanceof Error ? err.message : err}`));
          }
        }
      } else if (provider === "runway") {
        const apiKey = await requireApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);

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
        const apiKey = await requireApiKey("KLING_API_KEY", "Kling", options.apiKey);

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
        exitWithError(usageError(`Invalid provider: ${provider}. Use grok, runway, or kling.`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Failed to get status: ${msg}`, true));
    }
  });

// ============================================================================
// 12. Video Cancel
// ============================================================================

generateCommand
  .command("video-cancel", { hidden: true })
  .description("Cancel video generation (Grok or Runway)")
  .argument("<task-id>", "Task ID to cancel")
  .option("-p, --provider <provider>", "Provider: grok, runway", "grok")
  .option("-k, --api-key <key>", "API key (or set XAI_API_KEY / RUNWAY_API_SECRET env)")
  .action(async (taskId: string, options) => {
    try {
      const provider = (options.provider || "grok").toLowerCase();

      let success = false;

      if (provider === "grok") {
        const apiKey = await requireApiKey("XAI_API_KEY", "xAI", options.apiKey);

        const spinner = ora("Cancelling generation...").start();
        const grok = new GrokProvider();
        await grok.initialize({ apiKey });
        success = await grok.cancelGeneration(taskId);

        if (success) {
          spinner.succeed(chalk.green("Generation cancelled"));
          if (isJsonMode()) {
            outputResult({ success: true, taskId, provider: "grok", cancelled: true });
            return;
          }
        } else {
          spinner.fail("Failed to cancel generation");
          exitWithError(apiError("Failed to cancel generation", true));
        }
      } else if (provider === "runway") {
        const apiKey = await requireApiKey("RUNWAY_API_SECRET", "Runway", options.apiKey);

        const spinner = ora("Cancelling generation...").start();
        const runway = new RunwayProvider();
        await runway.initialize({ apiKey });
        success = await runway.cancelGeneration(taskId);

        if (success) {
          spinner.succeed(chalk.green("Generation cancelled"));
          if (isJsonMode()) {
            outputResult({ success: true, taskId, provider: "runway", cancelled: true });
            return;
          }
        } else {
          spinner.fail("Failed to cancel generation");
          exitWithError(apiError("Failed to cancel generation", true));
        }
      } else {
        exitWithError(usageError(`Invalid provider: ${provider}. Use grok or runway.`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Failed to cancel: ${msg}`, true));
    }
  });

// ============================================================================
// 13. Video Extend (merged: ai video-extend + ai veo-extend)
// Note: --prompt is long-only (-p is reserved for --provider)
// ============================================================================

generateCommand
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
        outputResult({ dryRun: true, command: "generate video-extend", params: { id, provider, prompt: options.prompt, duration: options.duration, negative: options.negative, veoModel: options.veoModel } });
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
          600000
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
          model: veoModel as "veo-3.0-generate-preview" | "veo-3.1-generate-preview" | "veo-3.1-fast-generate-preview",
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
          300000
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
        exitWithError(usageError(`Invalid provider: ${provider}. Video extend supports: kling, veo`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(apiError(`Video extension failed: ${msg}`, true));
    }
  });

// ── Extracted execute functions for MCP/agent consumption ───────────────

export interface ExecuteSpeechOptions {
  text: string;
  output?: string;
  voice?: string;
}
export interface ExecuteSpeechResult {
  success: boolean;
  outputPath?: string;
  characterCount?: number;
  error?: string;
}

export async function executeSpeech(options: ExecuteSpeechOptions): Promise<ExecuteSpeechResult> {
  try {
    const apiKey = hasApiKey("ELEVENLABS_API_KEY")
      ? (await getApiKeyFromConfig("elevenlabs") || process.env.ELEVENLABS_API_KEY!)
      : null;
    if (!apiKey) return { success: false, error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup" };

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });

    const result = await elevenlabs.textToSpeech(options.text, {
      voiceId: options.voice || "21m00Tcm4TlvDq8ikWAM",
    });

    if (!result.success || !result.audioBuffer) {
      return { success: false, error: result.error || "TTS generation failed" };
    }

    const outputPath = resolve(process.cwd(), options.output || "output.mp3");
    await writeFile(outputPath, result.audioBuffer);

    return { success: true, outputPath, characterCount: result.characterCount };
  } catch (error) {
    return { success: false, error: `TTS failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface ExecuteSoundEffectOptions {
  prompt: string;
  output?: string;
  duration?: number;
  promptInfluence?: number;
}
export interface ExecuteSoundEffectResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

export async function executeSoundEffect(options: ExecuteSoundEffectOptions): Promise<ExecuteSoundEffectResult> {
  try {
    const apiKey = hasApiKey("ELEVENLABS_API_KEY")
      ? (await getApiKeyFromConfig("elevenlabs") || process.env.ELEVENLABS_API_KEY!)
      : null;
    if (!apiKey) return { success: false, error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup" };

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });

    const result = await elevenlabs.generateSoundEffect(options.prompt, {
      duration: options.duration,
      promptInfluence: options.promptInfluence,
    });

    if (!result.success || !result.audioBuffer) {
      return { success: false, error: result.error || "Sound effect generation failed" };
    }

    const outputPath = resolve(process.cwd(), options.output || "sound-effect.mp3");
    await writeFile(outputPath, result.audioBuffer);

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `SFX failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface ExecuteMusicOptions {
  prompt: string;
  output?: string;
  duration?: number;
  provider?: "elevenlabs" | "replicate";
  instrumental?: boolean;
}
export interface ExecuteMusicResult {
  success: boolean;
  outputPath?: string;
  provider?: string;
  duration?: number;
  error?: string;
}

export async function executeMusic(options: ExecuteMusicOptions): Promise<ExecuteMusicResult> {
  try {
    const provider = options.provider || "elevenlabs";

    if (provider === "elevenlabs") {
      const apiKey = hasApiKey("ELEVENLABS_API_KEY")
        ? (await getApiKeyFromConfig("elevenlabs") || process.env.ELEVENLABS_API_KEY!)
        : null;
      if (!apiKey) return { success: false, error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup" };

      const elevenlabs = new ElevenLabsProvider();
      await elevenlabs.initialize({ apiKey });

      const duration = Math.max(3, Math.min(600, options.duration || 8));
      const result = await elevenlabs.generateMusic(options.prompt, {
        duration,
        forceInstrumental: options.instrumental || false,
      });

      if (!result.success || !result.audioBuffer) {
        return { success: false, error: result.error || "Music generation failed" };
      }

      const outputPath = resolve(process.cwd(), options.output || "music.mp3");
      await writeFile(outputPath, result.audioBuffer);

      return { success: true, outputPath, provider: "elevenlabs", duration };
    }

    // Replicate MusicGen
    const apiKey = hasApiKey("REPLICATE_API_TOKEN")
      ? (await getApiKeyFromConfig("replicate") || process.env.REPLICATE_API_TOKEN!)
      : null;
    if (!apiKey) return { success: false, error: "Replicate API token required. Set REPLICATE_API_TOKEN or run: vibe setup" };

    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });

    const duration = Math.max(1, Math.min(30, options.duration || 8));
    const result = await replicate.generateMusic(options.prompt, { duration });

    if (!result.success || !result.taskId) {
      return { success: false, error: result.error || "Music generation failed" };
    }

    const finalResult = await replicate.waitForMusic(result.taskId);
    if (!finalResult.success || !finalResult.audioUrl) {
      return { success: false, error: finalResult.error || "Music generation failed" };
    }

    const response = await fetch(finalResult.audioUrl);
    if (!response.ok) return { success: false, error: "Failed to download generated audio" };

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const outputPath = resolve(process.cwd(), options.output || "music.mp3");
    await writeFile(outputPath, audioBuffer);

    return { success: true, outputPath, provider: "replicate", duration };
  } catch (error) {
    return { success: false, error: `Music failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}


// ============================================================================
// Storyboard
// ============================================================================

export interface ExecuteStoryboardOptions {
  content: string;
  duration?: number;
  creativity?: "low" | "high";
  output?: string;
  apiKey?: string;
}

export interface ExecuteStoryboardResult {
  success: boolean;
  segments?: Array<{ description: string; visuals?: string; duration?: number; narration?: string }>;
  segmentCount?: number;
  outputPath?: string;
  error?: string;
}

export async function executeStoryboard(options: ExecuteStoryboardOptions): Promise<ExecuteStoryboardResult> {
  const { content, duration, creativity = "low", output, apiKey } = options;

  try {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return { success: false, error: "ANTHROPIC_API_KEY required" };

    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: key });

    const segments = await claude.analyzeContent(content, duration, { creativity });

    if (segments.length === 0) {
      return { success: false, error: "Could not generate storyboard" };
    }

    // Sanitize LLM output
    for (const seg of segments) {
      seg.description = sanitizeLLMResponse(seg.description);
      if (seg.visuals) seg.visuals = sanitizeLLMResponse(seg.visuals);
    }

    let outputPath: string | undefined;
    if (output) {
      outputPath = resolve(process.cwd(), output);
      await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
    }

    return { success: true, segments, segmentCount: segments.length, outputPath };
  } catch (error) {
    return { success: false, error: `Storyboard failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

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

export async function executeBackground(options: ExecuteBackgroundOptions): Promise<ExecuteBackgroundResult> {
  try {
    const apiKey = options.apiKey
      ?? (hasApiKey("OPENAI_API_KEY")
        ? ((await getApiKeyFromConfig("openai")) || process.env.OPENAI_API_KEY!)
        : null);
    if (!apiKey) return { success: false, error: "OPENAI_API_KEY required for background generation" };

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
    return { success: false, error: `Background generation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface ExecuteMusicStatusOptions {
  taskId: string;
  apiKey?: string;
}
export interface ExecuteMusicStatusResult {
  success: boolean;
  taskId?: string;
  status?: "completed" | "failed" | "processing";
  audioUrl?: string;
  error?: string;
}

export async function executeMusicStatus(options: ExecuteMusicStatusOptions): Promise<ExecuteMusicStatusResult> {
  try {
    const apiKey = options.apiKey
      ?? (hasApiKey("REPLICATE_API_TOKEN")
        ? ((await getApiKeyFromConfig("replicate")) || process.env.REPLICATE_API_TOKEN!)
        : null);
    if (!apiKey) return { success: false, error: "REPLICATE_API_TOKEN required for music status" };

    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });
    const result = await replicate.getMusicStatus(options.taskId);

    const status: "completed" | "failed" | "processing" = result.audioUrl
      ? "completed"
      : result.error
      ? "failed"
      : "processing";

    return {
      success: true,
      taskId: options.taskId,
      status,
      audioUrl: result.audioUrl,
      error: result.error,
    };
  } catch (error) {
    return { success: false, error: `Music status check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
