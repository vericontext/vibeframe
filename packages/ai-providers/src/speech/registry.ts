/** One way to get a text-to-speech provider by its catalog id. */

import { ElevenLabsProvider } from "../elevenlabs/ElevenLabsProvider.js";
import { KokoroProvider } from "../kokoro/KokoroProvider.js";
import { OpenAiTtsProvider } from "../openai-tts/OpenAiTtsProvider.js";
import { ProviderError } from "../shared/errors.js";
import type { SpeechGenerator } from "./contract.js";

export const SPEECH_GENERATOR_PROVIDERS = ["elevenlabs", "openai", "kokoro"] as const;
export type SpeechGeneratorProvider = (typeof SPEECH_GENERATOR_PROVIDERS)[number];

/** A ready speech generator for `provider`. Kokoro runs locally and needs no key. */
export async function createSpeechGenerator(provider: string, apiKey?: string): Promise<SpeechGenerator> {
  const generator =
    provider === "elevenlabs"
      ? new ElevenLabsProvider()
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
