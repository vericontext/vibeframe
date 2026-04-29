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
import ora from "ora";
import { ElevenLabsProvider } from "@vibeframe/ai-providers";
import { requireApiKey, hasApiKey } from "../../utils/api-key.js";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import { getApiKeyFromConfig } from "../../config/index.js";
import {
  isJsonMode,
  outputSuccess,
  log,
  exitWithError,
  apiError,
  usageError,
} from "../output.js";
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

export async function executeSpeech(
  options: ExecuteSpeechOptions,
): Promise<ExecuteSpeechResult> {
  try {
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

// ── CLI: vibe generate speech (alias `tts`) ─────────────────────────────

export function registerSpeechCommand(parent: Command): void {
  parent
    .command("speech")
    .alias("tts")
    .description("Generate speech from text using ElevenLabs")
    .argument("[text]", "Text to convert to speech (interactive if omitted)")
    .option("-k, --api-key <key>", "ElevenLabs API key (or set ELEVENLABS_API_KEY env)")
    .option("-o, --output <path>", "Output audio file path", "output.mp3")
    .option("--voice <id>", "Voice ID (default: Rachel)", "21m00Tcm4TlvDq8ikWAM")
    .option("--list-voices", "List available voices")
    .option("--fit-duration <seconds>", "Speed up audio to fit target duration (via FFmpeg atempo)", parseFloat)
    .option("--dry-run", "Preview parameters without executing")
    .action(async (text: string | undefined, options) => {
      const startedAt = Date.now();
      try {
        // Interactive prompt if no argument provided
        if (!text) {
          if (hasTTY()) {
            text = await promptText(chalk.cyan("What text to speak? "));
            if (!text?.trim()) {
              exitWithError(usageError("Text is required."));
            }
          } else {
            exitWithError(
              usageError(
                "Text argument is required.",
                "Usage: vibe generate speech <text>",
              ),
            );
          }
        }
        rejectControlChars(text);
        if (options.output) {
          validateOutputPath(options.output);
        }

        if (options.dryRun) {
          outputSuccess({
            command: "generate speech",
            startedAt,
            dryRun: true,
            data: { params: { text, voice: options.voice, output: options.output } },
          });
          return;
        }

        const apiKey = await requireApiKey(
          "ELEVENLABS_API_KEY",
          "ElevenLabs",
          options.apiKey,
        );

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
          const { ffprobeDuration, execSafe } = await import("../../utils/exec-safe.js");
          const actualDuration = await ffprobeDuration(outputPath);

          if (actualDuration > options.fitDuration) {
            const tempo = actualDuration / options.fitDuration;
            if (tempo > 2.0) {
              log(
                chalk.yellow(
                  `Warning: Audio is ${tempo.toFixed(1)}x longer than target — would sound unnatural. Skipping tempo adjustment.`,
                ),
              );
            } else {
              const fitSpinner = ora(
                `Adjusting tempo (${tempo.toFixed(3)}x) to fit ${options.fitDuration}s...`,
              ).start();
              const tempPath = outputPath.replace(/(\.\w+)$/, `.tempo$1`);
              try {
                await execSafe("ffmpeg", [
                  "-y", "-i", outputPath,
                  "-filter:a", `atempo=${tempo.toFixed(4)}`,
                  "-vn", tempPath,
                ]);
                const { rename } = await import("node:fs/promises");
                await rename(tempPath, outputPath);
                fitSpinner.succeed(
                  chalk.green(
                    `Adjusted to fit ${options.fitDuration}s (${tempo.toFixed(3)}x speed)`,
                  ),
                );
              } catch {
                fitSpinner.fail(
                  chalk.yellow("Tempo adjustment failed — keeping original audio"),
                );
              }
            }
          } else {
            log(
              chalk.dim(
                `Audio (${actualDuration.toFixed(2)}s) already fits within ${options.fitDuration}s`,
              ),
            );
          }
        }

        if (isJsonMode()) {
          outputSuccess({
            command: "generate speech",
            startedAt,
            data: {
              characterCount: result.characterCount,
              outputPath,
            },
          });
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
}
