/**
 * @module generate/music
 * @description `vibe generate music` — ElevenLabs Music API (default, sync,
 * up to 10 min) or Replicate MusicGen (async, max 30 s, optional melody
 * conditioning). Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import {
  ElevenLabsProvider,
  ReplicateProvider,
} from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import {
  isJsonMode,
  outputSuccess,
  exitWithError,
  apiError,
  notFoundError,
  usageError,
} from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";

// ── Library: executeMusic ───────────────────────────────────────────────

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

export async function executeMusic(
  options: ExecuteMusicOptions,
): Promise<ExecuteMusicResult> {
  try {
    const provider = options.provider || "elevenlabs";

    if (provider === "elevenlabs") {
      const apiKey = hasApiKey("ELEVENLABS_API_KEY")
        ? ((await getApiKeyFromConfig("elevenlabs")) || process.env.ELEVENLABS_API_KEY!)
        : null;
      if (!apiKey)
        return {
          success: false,
          error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup",
        };

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
      ? ((await getApiKeyFromConfig("replicate")) || process.env.REPLICATE_API_TOKEN!)
      : null;
    if (!apiKey)
      return {
        success: false,
        error: "Replicate API token required. Set REPLICATE_API_TOKEN or run: vibe setup",
      };

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
    if (!response.ok)
      return { success: false, error: "Failed to download generated audio" };

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const outputPath = resolve(process.cwd(), options.output || "music.mp3");
    await writeFile(outputPath, audioBuffer);

    return { success: true, outputPath, provider: "replicate", duration };
  } catch (error) {
    return {
      success: false,
      error: `Music failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate music ────────────────────────────────────────────

export function registerMusicCommand(parent: Command): void {
  parent
    .command("music")
    .description("Generate background music from a text prompt (ElevenLabs or Replicate MusicGen)")
    .argument("<prompt>", "Description of the music to generate")
    .option("-p, --provider <provider>", "Provider: elevenlabs (default, up to 10min), replicate (MusicGen, max 30s)", "elevenlabs")
    .option("-k, --api-key <key>", "API key (or set ELEVENLABS_API_KEY / REPLICATE_API_TOKEN env)")
    .option("-d, --duration <seconds>", "Duration in seconds (elevenlabs: 3-600, replicate: 1-30)", "8")
    .option("--instrumental", "Force instrumental music, no vocals (ElevenLabs only)")
    .option("--melody <file>", "Reference melody audio file for conditioning (Replicate only)")
    .option("--model <model>", "Model variant (Replicate only): large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
    .option("-o, --output <path>", "Output audio file path", "music.mp3")
    .option("--no-wait", "Don't wait for generation to complete (Replicate async mode)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      const startedAt = Date.now();
      try {
        rejectControlChars(prompt);
        if (options.output) {
          validateOutputPath(options.output);
        }

        const provider = (options.provider || "elevenlabs").toLowerCase();

        if (options.dryRun) {
          outputSuccess({
            command: "generate music",
            startedAt,
            dryRun: true,
            data: {
              params: {
                prompt,
                provider,
                duration: options.duration,
                model: options.model,
                output: options.output,
                instrumental: options.instrumental,
              },
            },
          });
          return;
        }

        if (provider === "elevenlabs") {
          // ElevenLabs Music API — synchronous, up to 10 minutes
          const apiKey = await requireApiKey(
            "ELEVENLABS_API_KEY",
            "ElevenLabs",
            options.apiKey,
          );

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
            outputSuccess({
              command: "generate music",
              startedAt,
              data: {
                provider: "elevenlabs",
                outputPath,
                duration,
              },
            });
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
          const apiKey = await requireApiKey(
            "REPLICATE_API_TOKEN",
            "Replicate",
            options.apiKey,
          );

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
            exitWithError(
              usageError(
                "Melody conditioning requires a publicly accessible URL",
                "Please upload your melody file and provide the URL.",
              ),
            );
          }

          const result = await replicate.generateMusic(prompt, {
            duration,
            model: options.model as
              | "large"
              | "stereo-large"
              | "melody-large"
              | "stereo-melody-large",
          });

          if (!result.success || !result.taskId) {
            spinner.fail(result.error || "Music generation failed");
            exitWithError(apiError(result.error || "Music generation failed", true));
          }

          if (!options.wait) {
            spinner.succeed(chalk.green("Music generation started"));
            console.log();
            console.log(`Task ID: ${chalk.bold(result.taskId)}`);
            console.log(
              chalk.dim("Check status with: vibe generate music-status " + result.taskId),
            );
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
            outputSuccess({
              command: "generate music",
              startedAt,
              data: {
                provider: "replicate",
                taskId: result.taskId,
                audioUrl: finalResult.audioUrl,
                outputPath,
              },
            });
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
}
