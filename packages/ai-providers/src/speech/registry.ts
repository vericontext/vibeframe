/** One way to get a text-to-speech provider by its catalog id. */

import { ElevenLabsProvider } from "../elevenlabs/ElevenLabsProvider.js";
import { GeminiTtsProvider } from "../gemini/gemini-tts.js";
import { KokoroProvider } from "../kokoro/KokoroProvider.js";
import { OpenAiTtsProvider } from "../openai-tts/OpenAiTtsProvider.js";
import { ProviderError } from "../shared/errors.js";
import type { SpeechGenerator } from "./contract.js";

/**
 * Every speech provider, in the order `--tts auto` tries them: the first one
 * with a configured key wins, and keyless Kokoro comes last. Each provider's
 * `speech` resolver priority (`defineProvider`) follows the same order.
 */
export const SPEECH_GENERATOR_PROVIDERS = ["elevenlabs", "gemini", "openai", "kokoro"] as const;
export type SpeechGeneratorProvider = (typeof SPEECH_GENERATOR_PROVIDERS)[number];

/** A ready speech generator for `provider`. Kokoro runs locally and needs no key. */
export async function createSpeechGenerator(provider: string, apiKey?: string): Promise<SpeechGenerator> {
  const generator =
    provider === "elevenlabs"
      ? new ElevenLabsProvider()
      : provider === "gemini"
        ? new GeminiTtsProvider()
        : provider === "openai"
          ? new OpenAiTtsProvider()
          : provider === "kokoro"
            ? new KokoroProvider()
            : undefined;
  if (!generator) {
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown speech provider "${provider}". Available: ${SPEECH_GENERATOR_PROVIDERS.join(", ")}.`,
    });
  }
  await generator.initialize({ apiKey });
  return generator;
}

/** The container a provider answers in, known before the call because it names narration files. */
export function speechAudioExtension(provider: SpeechGeneratorProvider): "mp3" | "wav" {
  return provider === "gemini" || provider === "kokoro" ? "wav" : "mp3";
}
