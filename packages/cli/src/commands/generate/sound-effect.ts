/**
 * @module generate/sound-effect
 * @description `vibe generate sound-effect` — ElevenLabs SFX generation.
 * Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { ElevenLabsProvider } from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import { isJsonMode, outputResult, exitWithError, apiError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";

// ── Library: executeSoundEffect (used by pipeline executor + manifest) ──

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

export async function executeSoundEffect(
  options: ExecuteSoundEffectOptions,
): Promise<ExecuteSoundEffectResult> {
  try {
    const apiKey = hasApiKey("ELEVENLABS_API_KEY")
      ? ((await getApiKeyFromConfig("elevenlabs")) || process.env.ELEVENLABS_API_KEY!)
      : null;
    if (!apiKey)
      return {
        success: false,
        error:
          "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup",
      };

    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey });

    const result = await elevenlabs.generateSoundEffect(options.prompt, {
      duration: options.duration,
      promptInfluence: options.promptInfluence,
    });

    if (!result.success || !result.audioBuffer) {
      return {
        success: false,
        error: result.error || "Sound effect generation failed",
      };
    }

    const outputPath = resolve(
      process.cwd(),
      options.output || "sound-effect.mp3",
    );
    await writeFile(outputPath, result.audioBuffer);

    return { success: true, outputPath };
  } catch (error) {
    return {
      success: false,
      error: `SFX failed: ${error instanceof Error ? error.message : String(error)}`,
    };
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
          outputResult({
            dryRun: true,
            command: "generate sound-effect",
            params: {
              prompt,
              duration: options.duration,
              promptInfluence: options.promptInfluence,
              output: options.output,
            },
          });
          return;
        }

        const apiKey = await requireApiKey(
          "ELEVENLABS_API_KEY",
          "ElevenLabs",
          options.apiKey,
        );

        const spinner = ora("Generating sound effect...").start();

        const elevenlabs = new ElevenLabsProvider();
        await elevenlabs.initialize({ apiKey });

        const result = await elevenlabs.generateSoundEffect(prompt, {
          duration: options.duration ? parseFloat(options.duration) : undefined,
          promptInfluence: options.promptInfluence
            ? parseFloat(options.promptInfluence)
            : undefined,
        });

        if (!result.success || !result.audioBuffer) {
          spinner.fail(result.error || "Sound effect generation failed");
          exitWithError(
            apiError(result.error || "Sound effect generation failed", true),
          );
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
}
