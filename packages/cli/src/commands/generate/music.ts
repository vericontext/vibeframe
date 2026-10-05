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
  ELEVENLABS_MUSIC_MODEL,
  ElevenLabsProvider,
  ReplicateProvider,
  type ProviderErrorKind,
} from "@vibeframe/ai-providers";
import { requireApiKey, getConfiguredApiKey } from "../../utils/api-key.js";
import { isJsonMode, outputSuccess, exitWithError, notFoundError, providerFailure, usageError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { createAndWriteJobRecord, type JobRecord } from "../_shared/status-jobs.js";

// ── Library: executeMusic ───────────────────────────────────────────────

export interface ExecuteMusicOptions {
  prompt: string;
  output?: string;
  duration?: number;
  provider?: "elevenlabs" | "replicate";
  instrumental?: boolean;
  wait?: boolean;
  /** Replicate MusicGen variant: large, stereo-large, melody-large, stereo-melody-large. */
  model?: string;
  apiKey?: string;
}
export interface ExecuteMusicResult {
  success: boolean;
  outputPath?: string;
  provider?: string;
  duration?: number;
  taskId?: string;
  status?: string;
  audioUrl?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeMusic(
  options: ExecuteMusicOptions,
): Promise<ExecuteMusicResult> {
  try {
    const provider = options.provider || "elevenlabs";

    if (provider === "elevenlabs") {
      const apiKey = await getConfiguredApiKey("ELEVENLABS_API_KEY", options.apiKey);
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
        return { success: false, error: result.error || "Music generation failed", errorKind: result.errorKind };
      }

      const outputPath = resolve(process.cwd(), options.output || "music.mp3");
      await writeFile(outputPath, result.audioBuffer);

      return { success: true, outputPath, provider: "elevenlabs", duration };
    }

    // Replicate MusicGen
    const apiKey = await getConfiguredApiKey("REPLICATE_API_TOKEN", options.apiKey);
    if (!apiKey)
      return {
        success: false,
        error: "Replicate API token required. Set REPLICATE_API_TOKEN or run: vibe setup",
      };

    const replicate = new ReplicateProvider();
    await replicate.initialize({ apiKey });

    const duration = Math.max(1, Math.min(30, options.duration || 8));
    const result = await replicate.generateMusic(options.prompt, {
      duration,
      model: options.model as "large" | "stereo-large" | "melody-large" | "stereo-melody-large" | undefined,
    });

    if (!result.success || !result.taskId) {
      return { success: false, error: result.error || "Music generation failed" };
    }

    if (options.wait === false) {
      return {
        success: true,
        provider: "replicate",
        taskId: result.taskId,
        status: "processing",
        duration,
      };
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
    .option("-m, --model <model>", "Model variant (Replicate only): large, stereo-large, melody-large, stereo-melody-large", "stereo-large")
    .option("-o, --output <path>", "Output audio file path", "music.mp3")
    .option("--no-wait", "Don't wait for generation to complete (Replicate async mode)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      const startedAt = Date.now();
      rejectControlChars(prompt);
      if (options.output) validateOutputPath(options.output);
      // Validate before the dry run, so a plan never echoes values a real run would reject.
      const requested = parseFloat(options.duration);
      if (!Number.isFinite(requested) || requested <= 0 || requested > 600) {
        exitWithError(usageError(`Invalid --duration: ${options.duration}`, "Must be a positive number ≤ 600s (ElevenLabs 3-600, Replicate 1-30)."));
      }
      const provider = String(options.provider || "elevenlabs").toLowerCase();
      if (provider !== "elevenlabs" && provider !== "replicate") {
        exitWithError(usageError(`Invalid provider: ${provider}`, "Available providers: elevenlabs, replicate"));
      }
      if (options.melody) {
        if (!existsSync(resolve(process.cwd(), options.melody))) exitWithError(notFoundError(options.melody));
        exitWithError(usageError("Melody conditioning requires a publicly accessible URL", "Please upload your melody file and provide the URL."));
      }

      if (options.dryRun) {
        outputSuccess({
          command: "generate music",
          startedAt,
          dryRun: true,
          data: {
            params: { prompt, provider, duration: options.duration, model: options.model, output: options.output, instrumental: options.instrumental },
          },
        });
        return;
      }

      const apiKey =
        provider === "elevenlabs"
          ? await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey)
          : await requireApiKey("REPLICATE_API_TOKEN", "Replicate", options.apiKey);
      const label = provider === "elevenlabs" ? "ElevenLabs" : "Replicate MusicGen";
      const spinner = isJsonMode() ? null : ora(`Generating music with ${label}...`).start();
      const result = await executeMusic({
        prompt,
        provider,
        duration: requested,
        instrumental: options.instrumental,
        model: options.model,
        output: options.output,
        wait: options.wait,
        apiKey,
      });
      if (!result.success) {
        spinner?.fail(result.error ?? "Music generation failed");
        exitWithError(providerFailure(result.error ?? "Music generation failed", result.errorKind));
      }

      // Replicate --no-wait: record the job so `vibe status job` can finish it.
      if (result.taskId && !result.outputPath) {
        const job = await recordMusicNoWaitJob({ provider: "replicate", providerTaskId: result.taskId, prompt });
        if (isJsonMode()) {
          outputSuccess({ command: "generate music", startedAt, data: noWaitMusicData("replicate", result.taskId, job) });
          return;
        }
        spinner?.succeed(chalk.green(`Music generation started (task ${result.taskId})`));
        console.log(chalk.dim(`Check status with: ${job.retryWith[0]}`));
        return;
      }

      if (isJsonMode()) {
        outputSuccess({
          command: "generate music",
          startedAt,
          data: { provider: result.provider, outputPath: result.outputPath, duration: result.duration },
        });
        return;
      }
      spinner?.succeed(chalk.green("Music generated successfully"));
      console.log(`Saved to: ${chalk.bold(result.outputPath)}`);
      console.log(`Duration: ${result.duration}s`);
      console.log(provider === "elevenlabs" ? `Provider: ElevenLabs (${ELEVENLABS_MUSIC_MODEL})` : `Provider: Replicate MusicGen (${options.model})`);
      if (options.instrumental && provider === "elevenlabs") console.log("Mode: Instrumental");
    });
}

async function recordMusicNoWaitJob(opts: {
  provider: string;
  providerTaskId: string;
  prompt: string;
}): Promise<JobRecord> {
  return createAndWriteJobRecord({
    jobType: "generate-music",
    provider: opts.provider,
    providerTaskId: opts.providerTaskId,
    status: "running",
    command: "generate music --no-wait",
    prompt: opts.prompt,
  });
}

function noWaitMusicData(provider: string, taskId: string, job: JobRecord): Record<string, unknown> {
  return {
    provider,
    taskId,
    status: job.status,
    jobId: job.id,
    statusCommand: job.retryWith[0],
  };
}
