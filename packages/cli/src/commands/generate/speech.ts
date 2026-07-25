/**
 * @module generate/speech
 * @description `vibe generate speech` (alias `tts`) — ElevenLabs text-to-
 * speech with optional duration-fit post-processing. Split out of
 * `generate.ts` in v0.69 (Plan G Phase 2).
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import chalk from "chalk";
import { ElevenLabsProvider } from "@vibeframe/ai-providers";
import { getConfiguredApiKey } from "../../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import { isJsonMode, outputSuccess, exitWithError, apiError, usageError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";

// ── Library: executeSpeech ──────────────────────────────────────────────

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
    const apiKey = await getConfiguredApiKey("ELEVENLABS_API_KEY");
    if (!apiKey)
      return {
        success: false,
        error: "ElevenLabs API key required. Set ELEVENLABS_API_KEY or run: vibe setup",
      };

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
    return {
      success: false,
      error: `TTS failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function registerNarrationCommand(parent: Command): void {
  parent
    .command("narration")
    .alias("voiceover")
    .description("Generate narration from text (product-facing TTS)")
    .argument("[text]", "Narration text (interactive if omitted)")
    .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
    .option("-o, --output <path>", "Output audio file path", "narration.mp3")
    .option("--voice <id>", "Voice ID (default: Rachel)", "21m00Tcm4TlvDq8ikWAM")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (text: string | undefined, options) => {
      const startedAt = Date.now();
      try {
        if (!text) {
          if (hasTTY()) {
            text = await promptText(chalk.cyan("What narration text? "));
            if (!text?.trim()) exitWithError(usageError("Text is required."));
          } else {
            exitWithError(
              usageError("Text argument is required.", "Usage: vibe generate narration <text>")
            );
          }
        }
        rejectControlChars(text);
        if (options.output) validateOutputPath(options.output);

        if (options.dryRun) {
          outputSuccess({
            command: "generate narration",
            startedAt,
            dryRun: true,
            data: { params: { text, voice: options.voice, output: options.output } },
          });
          return;
        }

        if (options.apiKey) process.env.ELEVENLABS_API_KEY = options.apiKey;
        const result = await executeSpeech({ text, output: options.output, voice: options.voice });
        if (!result.success) {
          exitWithError(apiError(result.error ?? "Narration generation failed", true));
        }

        if (isJsonMode()) {
          outputSuccess({
            command: "generate narration",
            startedAt,
            data: {
              characterCount: result.characterCount,
              outputPath: result.outputPath,
            },
          });
          return;
        }

        console.log();
        console.log(chalk.dim(`Characters: ${result.characterCount}`));
        console.log(chalk.green(`Saved to: ${result.outputPath}`));
        console.log();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Narration generation failed: ${msg}`, true));
      }
    });
}
