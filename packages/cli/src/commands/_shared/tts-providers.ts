/**
 * @module _shared/tts-providers
 *
 * Which TTS provider a `--tts` value means, with no provider calls: the
 * names, the key each cloud provider needs, and the `auto` pick. Both
 * `resolveTtsProvider` (which then opens the provider) and `build`'s plan
 * use {@link pickTtsProvider}, so the two never disagree.
 *
 * The `auto` order is `SPEECH_GENERATOR_PROVIDERS` from
 * `@vibeframe/ai-providers`: ElevenLabs (a dedicated TTS key signals
 * intent), Gemini (`GOOGLE_API_KEY`), OpenAI (gpt-4o-mini-tts, which shuts
 * down on 2027-01-06), then local Kokoro.
 */

import { SPEECH_GENERATOR_PROVIDERS, type SpeechGeneratorProvider } from "@vibeframe/ai-providers";

/** Concrete provider id surfaced in result metadata. Never `"auto"`. */
export type ResolvedTtsProvider = SpeechGeneratorProvider;

/** TTS providers VibeFrame can route to. `"auto"` picks based on key availability. */
export type TtsProviderName = "auto" | ResolvedTtsProvider;

/** Every `--tts` value, for option help and schema enums. */
export const TTS_PROVIDER_NAMES = ["auto", ...SPEECH_GENERATOR_PROVIDERS] as const;

export interface TtsProviderKey {
  envVar: string;
  /** The `config.yaml` providers key. */
  configKey: string;
  label: string;
}

/** The key each cloud provider needs; Kokoro needs none. */
export const TTS_PROVIDER_KEYS: Record<Exclude<ResolvedTtsProvider, "kokoro">, TtsProviderKey> = {
  elevenlabs: { envVar: "ELEVENLABS_API_KEY", configKey: "elevenlabs", label: "ElevenLabs" },
  gemini: { envVar: "GOOGLE_API_KEY", configKey: "google", label: "Google" },
  openai: { envVar: "OPENAI_API_KEY", configKey: "openai", label: "OpenAI" },
};

/** `value` as a `--tts` name, or undefined when it is not one. */
export function asTtsProviderName(value: string): TtsProviderName | undefined {
  return (TTS_PROVIDER_NAMES as readonly string[]).includes(value) ? (value as TtsProviderName) : undefined;
}

/**
 * The provider a `--tts` value resolves to. An explicit choice wins; `auto`
 * takes the first provider in `SPEECH_GENERATOR_PROVIDERS` whose key
 * `hasKey` reports, ending at keyless Kokoro.
 */
export async function pickTtsProvider(
  preferred: TtsProviderName,
  hasKey: (key: TtsProviderKey) => Promise<boolean>,
): Promise<ResolvedTtsProvider> {
  if (preferred !== "auto") return preferred;
  for (const provider of SPEECH_GENERATOR_PROVIDERS) {
    if (provider === "kokoro" || (await hasKey(TTS_PROVIDER_KEYS[provider]))) return provider;
  }
  return "kokoro";
}
