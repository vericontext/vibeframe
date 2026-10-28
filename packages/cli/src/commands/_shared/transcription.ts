/**
 * The CLI side of the transcription contract: pick a speech-to-text
 * provider, transcribe an audio file on disk, and get the result shape the
 * commands already use. Every command that needs a transcript (audio,
 * captions, highlights, jump-cut, speed-ramp, dub, scene narration) goes
 * through here.
 *
 * Providers:
 *   - **elevenlabs** - Scribe v2, word timestamps. First choice of `auto`
 *     whenever `ELEVENLABS_API_KEY` is set.
 *   - **openai** - Whisper (`whisper-1`, shuts down 2027-02-26). Used by
 *     `auto` when only `OPENAI_API_KEY` is set.
 *
 * The `auto` order is the provider registry's `transcription` priority
 * (`getProvidersFor("transcription")`), not a list kept here. Keys are
 * looked up with `getConfiguredApiKey` so a project's own config.yaml and
 * .env count, which `resolveProvider()` (process-wide keys only) misses.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  TRANSCRIBER_PROVIDERS,
  createTranscriber,
  getProvidersFor,
  isProviderError,
  type ProviderErrorKind,
  type TranscriberProvider,
  type TranscriptGranularity,
  type TranscriptResult,
} from "@vibeframe/ai-providers";
import { ApiKeyError, getConfiguredApiKey, requireApiKey } from "../../utils/api-key.js";
import { exitWithError, usageError } from "../output.js";

/** `--stt` values. `"auto"` picks by configured keys. */
export const STT_PROVIDER_NAMES = ["auto", ...TRANSCRIBER_PROVIDERS] as const;
export type SttProviderName = (typeof STT_PROVIDER_NAMES)[number];
export type ResolvedSttProvider = TranscriberProvider;

/** A chosen transcription provider and the key to call it with. */
export interface SttResolution {
  provider: ResolvedSttProvider;
  apiKey: string;
}

const STT_KEYS: Record<ResolvedSttProvider, { envVar: string; label: string }> = {
  elevenlabs: { envVar: "ELEVENLABS_API_KEY", label: "ElevenLabs" },
  openai: { envVar: "OPENAI_API_KEY", label: "OpenAI" },
};

/** One-line help for `--stt` / `-p` on transcribing commands. */
export const STT_OPTION_HELP =
  "Transcription provider: auto (default: ElevenLabs Scribe if ELEVENLABS_API_KEY is set, else OpenAI Whisper), elevenlabs, openai";

function isSttProviderName(value: string): value is SttProviderName {
  return (STT_PROVIDER_NAMES as readonly string[]).includes(value);
}

function isResolvedSttProvider(value: string): value is ResolvedSttProvider {
  return (TRANSCRIBER_PROVIDERS as readonly string[]).includes(value);
}

/** Validate a free-form `--stt <value>`; empty means `"auto"`. */
export function parseSttProviderName(value: string | undefined): SttProviderName {
  if (!value) return "auto";
  if (isSttProviderName(value)) return value;
  throw new Error(`Invalid transcription provider: ${value}. Valid: ${STT_PROVIDER_NAMES.join(", ")}.`);
}

/** {@link parseSttProviderName} for a CLI option: an invalid value exits with a usage error. */
export function sttOptionOrExit(value: string | undefined): SttProviderName {
  if (value && !isSttProviderName(value)) {
    exitWithError(usageError(`Invalid transcription provider: ${value}`, `Valid: ${STT_PROVIDER_NAMES.join(", ")}`));
  }
  return parseSttProviderName(value);
}

export interface ResolveSttOptions {
  /**
   * Explicit key for the chosen provider. With `"auto"` it is taken as an
   * OpenAI key, which is what `--api-key` meant before Scribe existed.
   */
  apiKey?: string;
  /** Directory whose config.yaml / .env supply keys. */
  cwd?: string;
}

/**
 * Pick a transcription provider without throwing: the requested one when
 * its key is configured, or for `"auto"` the first provider in registry
 * order with a key. `undefined` when there is none, for optional steps
 * such as narration word timings.
 */
export async function findSttProvider(
  preferred: string | undefined = "auto",
  options: ResolveSttOptions = {}
): Promise<SttResolution | undefined> {
  const name = parseSttProviderName(preferred);
  if (name !== "auto") {
    const apiKey = await getConfiguredApiKey(STT_KEYS[name].envVar, options.apiKey, { cwd: options.cwd });
    return apiKey ? { provider: name, apiKey } : undefined;
  }
  if (options.apiKey) return { provider: "openai", apiKey: options.apiKey };
  for (const candidate of getProvidersFor("transcription")) {
    if (!isResolvedSttProvider(candidate.name)) continue;
    const apiKey = await getConfiguredApiKey(STT_KEYS[candidate.name].envVar, undefined, { cwd: options.cwd });
    if (apiKey) return { provider: candidate.name, apiKey };
  }
  return undefined;
}

/**
 * Like {@link findSttProvider}, but a missing key throws {@link ApiKeyError}
 * (`API_KEY_MISSING`) before any provider call. Never prompts, so the CLI,
 * MCP tools, and pipelines fail the same way.
 */
export async function resolveSttProvider(
  preferred: string | undefined = "auto",
  options: ResolveSttOptions = {}
): Promise<SttResolution> {
  const found = await findSttProvider(preferred, options);
  if (found) return found;
  const name = parseSttProviderName(preferred);
  if (name !== "auto") throw new ApiKeyError(STT_KEYS[name].envVar, STT_KEYS[name].label);
  throw new ApiKeyError("ELEVENLABS_API_KEY or OPENAI_API_KEY", "ElevenLabs or OpenAI");
}

/**
 * {@link resolveSttProvider} for interactive CLI commands: when a named
 * provider's key is missing, a TTY user is asked for it (like
 * `requireApiKey`). `"auto"` never prompts, since it cannot know which key
 * to ask for.
 */
export async function requireSttProvider(
  preferred: string | undefined = "auto",
  options: ResolveSttOptions = {}
): Promise<SttResolution> {
  const name = parseSttProviderName(preferred);
  if (name === "auto") return resolveSttProvider(name, options);
  const found = await findSttProvider(name, options);
  if (found) return found;
  return { provider: name, apiKey: await requireApiKey(STT_KEYS[name].envVar, STT_KEYS[name].label, options.apiKey) };
}

/** Human name of the model family behind a resolved provider, for progress lines. */
export function sttLabel(provider: ResolvedSttProvider): string {
  return provider === "elevenlabs" ? "ElevenLabs Scribe" : "OpenAI Whisper";
}

export interface TranscribeFileOptions extends SttResolution {
  language?: string;
  granularity?: TranscriptGranularity;
}

/** Transcribe `path` with the resolved provider. Failures come back as `status: "failed"` with an error kind. */
export async function transcribeAudioFile(
  path: string,
  options: TranscribeFileOptions
): Promise<TranscriptResult & { errorKind?: ProviderErrorKind }> {
  try {
    const transcriber = await createTranscriber(options.provider, options.apiKey);
    const audio = new Uint8Array(await readFile(path));
    const name = basename(path);
    const transcript = await transcriber.transcribeAudio({
      audio,
      // A real extension helps the provider; temp files without one are sniffed from the bytes.
      filename: /\.(mp3|wav|m4a|mp4|ogg|flac|webm|mpeg|mpga)$/i.test(name) ? name : undefined,
      language: options.language,
      granularity: options.granularity,
    });
    return {
      id: `transcript-${Date.now()}`,
      status: "completed",
      fullText: transcript.text,
      detectedLanguage: transcript.language,
      segments: transcript.segments,
      words: transcript.words,
    };
  } catch (error) {
    return {
      id: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      errorKind: isProviderError(error) ? error.kind : undefined,
    };
  }
}
