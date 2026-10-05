/**
 * @module generate/speech
 * @description `vibe generate narration` (alias `voiceover`) — text to
 * speech on ElevenLabs, OpenAI, or local Kokoro, through the same TTS
 * resolver scenes and builds use.
 */

import type { Command } from "commander";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import type { ProviderErrorKind } from "@vibeframe/ai-providers";
import { hasTTY, prompt as promptText } from "../../utils/tty.js";
import { writeAudioFile } from "../../utils/audio-file.js";
import { isJsonMode, outputSuccess, exitWithError, providerFailure, usageError } from "../output.js";
import { rejectControlChars, validateOutputPath } from "../validate.js";
import { parseTtsProviderName, resolveTtsProvider, TtsKeyMissingError } from "../_shared/tts-resolve.js";

// ── Library: executeSpeech ──────────────────────────────────────────────

export interface ExecuteSpeechOptions {
  text: string;
  output?: string;
  voice?: string;
  /** auto (default): ElevenLabs if its key is set, else OpenAI, else local Kokoro. */
  provider?: string;
  /** Catalog model ID or alias for the chosen provider. */
  model?: string;
  speed?: number;
}

export interface ExecuteSpeechResult {
  success: boolean;
  outputPath?: string;
  characterCount?: number;
  provider?: string;
  model?: string;
  error?: string;
  errorKind?: ProviderErrorKind;
}

export async function executeSpeech(options: ExecuteSpeechOptions): Promise<ExecuteSpeechResult> {
  let tts: Awaited<ReturnType<typeof resolveTtsProvider>>;
  try {
    tts = await resolveTtsProvider(parseTtsProviderName(options.provider));
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorKind: error instanceof TtsKeyMissingError ? "auth" : "invalid-request",
    };
  }
  const result = await tts.call(options.text, { voice: options.voice, speed: options.speed, model: options.model });
  if (!result.success || !result.audioBuffer) {
    return { success: false, provider: tts.provider, error: result.error ?? "TTS generation failed", errorKind: result.errorKind };
  }
  const outputPath = resolve(process.cwd(), options.output || `narration.${tts.audioExtension}`);
  await writeAudioFile(outputPath, result.audioBuffer, tts.audioExtension);
  return { success: true, outputPath, characterCount: result.characterCount, provider: tts.provider, model: result.model };
}

export function registerNarrationCommand(parent: Command): void {
  parent
    .command("narration")
    .alias("voiceover")
    .description("Generate narration from text (ElevenLabs, OpenAI, or local Kokoro)")
    .argument("[text]", "Narration text (interactive if omitted)")
    .option("-p, --provider <provider>", "auto (default: ElevenLabs if its key is set, else OpenAI, else local Kokoro), elevenlabs, openai, kokoro", "auto")
    .option("-k, --api-key <key>", "API key for the chosen provider")
    .option("-o, --output <path>", "Output audio file path (default: narration.mp3, or .wav for Kokoro)")
    .option("--voice <id>", "Voice: ElevenLabs name or ID (default Rachel), OpenAI voice (default marin), Kokoro voice (default af_heart)")
    .option("-m, --model <model>", "Model: ElevenLabs v3 (default), multilingual, flash; OpenAI gpt-4o-mini-tts, tts-1")
    .option("--speed <n>", "Speaking speed multiplier")
    .option("--dry-run", "Preview parameters without executing")
    .action(async (text: string | undefined, options) => {
      const startedAt = Date.now();
      if (!text) {
        if (hasTTY()) {
          text = await promptText(chalk.cyan("What narration text? "));
          if (!text?.trim()) exitWithError(usageError("Text is required."));
        } else {
          exitWithError(usageError("Text argument is required.", "Usage: vibe generate narration <text>"));
        }
      }
      rejectControlChars(text);
      if (options.output) validateOutputPath(options.output);
      let provider: string;
      try {
        provider = parseTtsProviderName(options.provider);
      } catch (error) {
        exitWithError(usageError(error instanceof Error ? error.message : String(error)));
      }
      const speed = options.speed !== undefined ? Number(options.speed) : undefined;
      if (speed !== undefined && !(speed > 0)) exitWithError(usageError(`Invalid --speed: ${options.speed}`));

      if (options.dryRun) {
        outputSuccess({
          command: "generate narration",
          startedAt,
          dryRun: true,
          data: { params: { text, provider, voice: options.voice, model: options.model, speed, output: options.output } },
        });
        return;
      }

      if (options.apiKey && provider !== "auto" && provider !== "kokoro") {
        process.env[provider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY"] = options.apiKey;
      }
      const spinner = isJsonMode() ? null : ora("Generating narration...").start();
      const result = await executeSpeech({ text, provider, output: options.output, voice: options.voice, model: options.model, speed });
      if (!result.success) {
        spinner?.fail(result.error ?? "Narration generation failed");
        exitWithError(providerFailure(result.error ?? "Narration generation failed", result.errorKind));
      }

      if (isJsonMode()) {
        outputSuccess({
          command: "generate narration",
          startedAt,
          data: {
            provider: result.provider,
            model: result.model,
            characterCount: result.characterCount,
            outputPath: result.outputPath,
          },
        });
        return;
      }
      spinner?.succeed(chalk.green(`Narration generated with ${result.provider} (${result.model})`));
      console.log(chalk.dim(`Characters: ${result.characterCount}`));
      console.log(chalk.green(`Saved to: ${result.outputPath}`));
    });
}
