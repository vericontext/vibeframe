/**
 * @module generate/sound-effect
 * @description `vibe generate sound-effect` — ElevenLabs SFX generation.
 * The command validates and formats; `executeSoundEffect` (also used by
 * pipelines and the MCP tool) does the work.
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { ElevenLabsProvider, type ProviderErrorKind } from "@vibeframe/ai-providers";
import { requireApiKey, getConfiguredApiKey } from "../../utils/api-key.js";
import { isJsonMode, outputSuccess, exitWithError, providerFailure, usageError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";

// ── Library: executeSoundEffect (used by pipeline executor + manifest) ──

export interface ExecuteSoundEffectOptions {
  prompt: string;
  output?: string;
  /** Seconds (0.5-30); the model picks when omitted. */
  duration?: number;
  /** 0-1, default 0.3. */
  promptInfluence?: number;
  apiKey?: string;
}

export interface ExecuteSoundEffectResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeSoundEffect(options: ExecuteSoundEffectOptions): Promise<ExecuteSoundEffectResult> {
  try {
    const apiKey = await getConfiguredApiKey("ELEVENLABS_API_KEY", options.apiKey);
    if (!apiKey) {
      return { success: false, error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup", errorKind: "auth" };
    }
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });
    const result = await elevenlabs.generateSoundEffect(options.prompt, {
      duration: options.duration,
      promptInfluence: options.promptInfluence,
    });
    if (!result.success || !result.audioBuffer) {
      return { success: false, error: result.error || "Sound effect generation failed", errorKind: result.errorKind };
    }
    const outputPath = resolve(process.cwd(), options.output || "sound-effect.mp3");
    await writeFile(outputPath, result.audioBuffer);
    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: `SFX failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── CLI: vibe generate sound-effect ─────────────────────────────────────

export function registerSoundEffectCommand(parent: Command): void {
  parent
    .command("sound-effect")
    .description("Generate sound effect using ElevenLabs")
    .argument("<prompt>", "Description of the sound effect")
    .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
    .option("-o, --output <path>", "Output audio file path", "sound-effect.mp3")
    .option("-d, --duration <seconds>", "Duration in seconds (0.5-30, default: auto)")
    .option("--prompt-influence <value>", "Prompt influence (0-1, default: 0.3)")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (prompt: string, options) => {
      const startedAt = Date.now();
      rejectControlChars(prompt);
      if (options.output) validateOutputPath(options.output);
      const duration = options.duration !== undefined ? parseFloat(options.duration) : undefined;
      if (duration !== undefined && !(duration >= 0.5 && duration <= 30)) {
        exitWithError(usageError(`Invalid --duration: ${options.duration}`, "Must be between 0.5 and 30 seconds."));
      }
      const promptInfluence = options.promptInfluence !== undefined ? parseFloat(options.promptInfluence) : undefined;
      if (promptInfluence !== undefined && !(promptInfluence >= 0 && promptInfluence <= 1)) {
        exitWithError(usageError(`Invalid --prompt-influence: ${options.promptInfluence}`, "Must be between 0 and 1."));
      }

      if (options.dryRun) {
        outputSuccess({
          command: "generate sound-effect",
          startedAt,
          dryRun: true,
          data: { params: { prompt, duration, promptInfluence, output: options.output } },
        });
        return;
      }

      const apiKey = await requireApiKey("ELEVENLABS_API_KEY", "ElevenLabs", options.apiKey);
      const spinner = isJsonMode() ? null : ora("Generating sound effect...").start();
      const result = await executeSoundEffect({ prompt, output: options.output, duration, promptInfluence, apiKey });
      if (!result.success) {
        spinner?.fail(result.error ?? "Sound effect generation failed");
        exitWithError(providerFailure(result.error ?? "Sound effect generation failed", result.errorKind));
      }
      if (isJsonMode()) {
        outputSuccess({ command: "generate sound-effect", startedAt, data: { outputPath: result.outputPath } });
        return;
      }
      spinner?.succeed(chalk.green("Sound effect generated"));
      console.log(chalk.green(`Saved to: ${result.outputPath}`));
    });
}
