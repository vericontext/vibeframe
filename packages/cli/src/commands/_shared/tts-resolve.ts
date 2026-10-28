/**
 * @module _shared/tts-resolve
 *
 * One-stop factory for picking a TTS provider at runtime. Used by every
 * path that turns text into narration audio (`generate narration`,
 * `scene add`, `build`, `audio dub`).
 *
 * Routes between, in `--tts auto` order:
 *   - **ElevenLabs** - cloud, paid. Default when `ELEVENLABS_API_KEY` is
 *     set: a dedicated TTS key signals intent.
 *   - **Gemini** - cloud `gemini-3.8-flash-tts` on `GOOGLE_API_KEY`, about
 *     $0.0135/min of audio. Next when a Google key is set.
 *   - **OpenAI** - cloud gpt-4o-mini-tts on `OPENAI_API_KEY`, which shuts
 *     down on 2027-01-06.
 *   - **Kokoro** - local Apache 2.0 model, free, ~90MB first-call download.
 *     The fallback for key-less users.
 *
 * The pick itself (names, keys, `auto` order) lives in `tts-providers.ts`,
 * which `build`'s plan shares.
 */

import { createSpeechGenerator, isProviderError, speechAudioExtension } from "@vibeframe/ai-providers";
import type { KokoroLoadEvent, ProviderErrorKind } from "@vibeframe/ai-providers";
import { getApiKey, getConfiguredApiKey } from "../../utils/api-key.js";
import { ApiKeyError } from "../../utils/api-key-error.js";
import {
  TTS_PROVIDER_KEYS,
  asTtsProviderName,
  pickTtsProvider,
  TTS_PROVIDER_NAMES,
  type ResolvedTtsProvider,
  type TtsProviderName,
} from "./tts-providers.js";

export type { ResolvedTtsProvider, TtsProviderName } from "./tts-providers.js";

/** Options accepted by every {@link TtsCallable}. Subset of provider-specific options. */
export interface TtsCallOptions {
  /**
   * Provider-specific voice id. ElevenLabs takes voice names/ids
   * (`"rachel"`, `"21m00Tcm..."`), Gemini prebuilt names (`"Kore"`), OpenAI
   * voices (`"marin"`), Kokoro voice ids (`"af_heart"`). The router does not
   * map between them.
   */
  voice?: string;
  /** Speaking speed multiplier (Kokoro: 0.5-2; ElevenLabs: 0.7-1.2; Gemini: a pace direction). */
  speed?: number;
  /** Catalog model ID or alias for the resolved provider. */
  model?: string;
  /** Cold-start progress callback (Kokoro only - fires on first ~330MB load). */
  onProgress?: (event: KokoroLoadEvent) => void;
}

/** Result of a TTS call. Same shape for every provider. */
export interface TtsCallResult {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
  /** Why the provider failed (`auth`, `quota`, `invalid-request`, ...). */
  errorKind?: ProviderErrorKind;
  characterCount?: number;
  /** The catalog model that spoke it. */
  model?: string;
}

/** Synthesise speech from text. Provider-specific implementation lives behind this. */
export type TtsCallable = (text: string, options?: TtsCallOptions) => Promise<TtsCallResult>;

export interface TtsResolution {
  /** Concrete provider chosen. */
  provider: ResolvedTtsProvider;
  /** Output container - drives the narration filename extension. */
  audioExtension: "mp3" | "wav";
  /** Synthesise text -> audio buffer. */
  call: TtsCallable;
}

/**
 * Resolve a TTS provider preference into a callable + metadata. An explicit
 * cloud provider without its key throws {@link TtsKeyMissingError}.
 */
export async function resolveTtsProvider(
  preferred: TtsProviderName = "auto",
): Promise<TtsResolution> {
  const provider = await pickTtsProvider(preferred, async ({ envVar }) =>
    Boolean(await getConfiguredApiKey(envVar)),
  );
  if (provider === "kokoro") return build(provider);
  const { envVar, label } = TTS_PROVIDER_KEYS[provider];
  const key = await getApiKey(envVar, label);
  if (!key) throw new TtsKeyMissingError(provider);
  return build(provider, key);
}

/** A TTS callable over the speech contract; provider errors come back as data with their kind. */
async function build(provider: ResolvedTtsProvider, key?: string): Promise<TtsResolution> {
  const generator = await createSpeechGenerator(provider, key);
  const call: TtsCallable = async (text, opts) => {
    try {
      const result = await generator.synthesize(
        { text, voice: opts?.voice, speed: opts?.speed, model: opts?.model },
        { onProgress: opts?.onProgress }
      );
      return {
        success: true,
        audioBuffer: Buffer.from(result.bytes),
        characterCount: result.characters,
        model: result.model,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorKind: isProviderError(error) ? error.kind : undefined,
      };
    }
  };
  return { provider, audioExtension: speechAudioExtension(provider), call };
}

/**
 * Thrown when the caller asked for a specific provider whose key is not
 * configured. It is an {@link ApiKeyError}, so commands report it as
 * `API_KEY_MISSING` (exit 4) like every other missing key; the message adds
 * the free local fallback for human output.
 */
export class TtsKeyMissingError extends ApiKeyError {
  constructor(public readonly provider: Exclude<ResolvedTtsProvider, "kokoro">) {
    const { envVar, label } = TTS_PROVIDER_KEYS[provider];
    super(envVar, label);
    this.message = `${label} API key required (${envVar}). Run 'vibe setup', set ${envVar} in .env, or pass --tts kokoro for local synthesis.`;
    this.name = "TtsKeyMissingError";
  }
}

/**
 * Validate a free-form `--tts <value>` against {@link TtsProviderName}.
 * `flag` names the option in the error (`generate narration` calls it `--provider`).
 */
export function parseTtsProviderName(value: string | undefined, flag = "--tts"): TtsProviderName {
  if (!value) return "auto";
  const name = asTtsProviderName(value);
  if (name) return name;
  throw new Error(`Invalid ${flag}: ${value}. Valid: ${TTS_PROVIDER_NAMES.join(", ")}.`);
}
