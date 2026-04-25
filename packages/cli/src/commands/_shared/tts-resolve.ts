/**
 * @module _shared/tts-resolve
 *
 * One-stop factory for picking a TTS provider at runtime. Used by every
 * scene-authoring path that turns text into narration audio (currently
 * `executeSceneAdd`; `script-to-video --format scenes` follows in C5+).
 *
 * Routes between:
 *   - **ElevenLabs** — cloud, API-key gated, paid (~$0.02/scene). Default
 *     when `ELEVENLABS_API_KEY` is set.
 *   - **Kokoro** — local Apache 2.0 model, free, ~330MB first-call download.
 *     The fallback for key-less users.
 *
 * The router exposes a uniform `TtsCallable` shape so call sites don't have
 * to branch on provider id. Both providers already return the same
 * `{ success, audioBuffer, error?, characterCount? }` result.
 */

import { ElevenLabsProvider, KokoroProvider } from "@vibeframe/ai-providers";
import type { KokoroLoadEvent } from "@vibeframe/ai-providers";
import { hasApiKey } from "../../utils/api-key.js";
import { getApiKey } from "../../utils/api-key.js";

/** TTS providers VibeFrame can route to. `"auto"` picks based on key availability. */
export type TtsProviderName = "auto" | "elevenlabs" | "kokoro";

/** Concrete provider id surfaced in result metadata. Never `"auto"`. */
export type ResolvedTtsProvider = "elevenlabs" | "kokoro";

/** Options accepted by every {@link TtsCallable}. Subset of provider-specific options. */
export interface TtsCallOptions {
  /**
   * Provider-specific voice id. ElevenLabs takes voice names/ids
   * (`"rachel"`, `"21m00Tcm..."`); Kokoro takes voice ids (`"af_heart"`,
   * `"am_michael"`). The router does not map between the two.
   */
  voice?: string;
  /** Speaking speed multiplier (Kokoro: 0.5–2; ElevenLabs: 0.7–1.2). */
  speed?: number;
  /** Cold-start progress callback (Kokoro only — fires on first ~330MB load). */
  onProgress?: (event: KokoroLoadEvent) => void;
}

/** Result of a TTS call. Same shape both providers already return. */
export interface TtsCallResult {
  success: boolean;
  audioBuffer?: Buffer;
  error?: string;
  characterCount?: number;
}

/** Synthesise speech from text. Provider-specific implementation lives behind this. */
export type TtsCallable = (text: string, options?: TtsCallOptions) => Promise<TtsCallResult>;

export interface TtsResolution {
  /** Concrete provider chosen. */
  provider: ResolvedTtsProvider;
  /** Output container — drives the narration filename extension. */
  audioExtension: "mp3" | "wav";
  /** Synthesise text → audio buffer. */
  call: TtsCallable;
}

/**
 * Resolve a TTS provider preference into a callable + metadata.
 *
 * Resolution policy:
 *   - `"elevenlabs"`: requires `ELEVENLABS_API_KEY`. Throws an `ApiKeyError`-style
 *     error via {@link getApiKey} (consumed by `requireApiKey`/`exitWithError`).
 *   - `"kokoro"`: always available (local). No key check.
 *   - `"auto"` (or `undefined`): if `ELEVENLABS_API_KEY` is set, picks
 *     ElevenLabs; otherwise falls back to Kokoro.
 */
export async function resolveTtsProvider(
  preferred: TtsProviderName = "auto",
): Promise<TtsResolution> {
  const choice = preferred === "auto"
    ? (hasApiKey("ELEVENLABS_API_KEY") ? "elevenlabs" : "kokoro")
    : preferred;

  if (choice === "elevenlabs") {
    return buildElevenLabs();
  }
  return buildKokoro();
}

async function buildElevenLabs(): Promise<TtsResolution> {
  const key = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
  if (!key) {
    throw new TtsKeyMissingError("elevenlabs");
  }
  const provider = new ElevenLabsProvider();
  await provider.initialize({ apiKey: key });
  const call: TtsCallable = async (text, opts) =>
    provider.textToSpeech(text, {
      voiceId: opts?.voice,
      speed: opts?.speed,
    });
  return { provider: "elevenlabs", audioExtension: "mp3", call };
}

async function buildKokoro(): Promise<TtsResolution> {
  const provider = new KokoroProvider();
  // No-op initialize — Kokoro doesn't take a config but we keep parity with
  // the AIProvider lifecycle for future audit checks.
  await provider.initialize({});
  const call: TtsCallable = async (text, opts) =>
    provider.textToSpeech(text, {
      voice: opts?.voice,
      speed: opts?.speed,
      onProgress: opts?.onProgress,
    });
  return { provider: "kokoro", audioExtension: "wav", call };
}

/**
 * Thrown when the caller asked for a specific provider whose key/runtime is
 * unavailable. Carries the provider id so the caller can format a clean
 * `usageError`/`exitWithError`.
 */
export class TtsKeyMissingError extends Error {
  constructor(public readonly provider: ResolvedTtsProvider) {
    super(
      provider === "elevenlabs"
        ? "ElevenLabs API key required (ELEVENLABS_API_KEY). Run 'vibe setup', set ELEVENLABS_API_KEY in .env, or pass --tts kokoro for local synthesis."
        : `Provider ${provider} is unavailable.`,
    );
    this.name = "TtsKeyMissingError";
  }
}

/** Validate a free-form `--tts <value>` against {@link TtsProviderName}. */
export function parseTtsProviderName(value: string | undefined): TtsProviderName {
  if (!value) return "auto";
  if (value === "auto" || value === "elevenlabs" || value === "kokoro") {
    return value;
  }
  throw new Error(
    `Invalid --tts: ${value}. Valid: auto, elevenlabs, kokoro.`,
  );
}
