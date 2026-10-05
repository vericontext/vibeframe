import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";
import type { SpeechGenerator, SpeechRequest, SpeechResult } from "../speech/contract.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveCatalogModel } from "../video/models.js";

/**
 * OpenAI TTS models.
 * - gpt-4o-mini-tts: default — steerable mini TTS, ~$0.015/min of audio.
 * - tts-1 / tts-1-hd: legacy dedicated TTS models.
 */
export type OpenAiTtsModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";

/**
 * Built-in OpenAI voices accepted by /v1/audio/speech. The API rejects
 * unknown names with a 400, so we validate up front for a clean error.
 */
export const OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "fable",
  "marin",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

/** Newest narration-quality voice; verified live against gpt-4o-mini-tts. */
const DEFAULT_VOICE: OpenAiTtsVoice = "marin";

/** `tts-1` and `tts-1-hd` support only the nine original voices (docs). */
const TTS_1_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"] as const;

export interface OpenAiTtsOptions {
  /** Voice name (see {@link OPENAI_TTS_VOICES}). Defaults to "marin". */
  voice?: string;
  /** Model override. Defaults to gpt-4o-mini-tts. */
  model?: OpenAiTtsModel;
  /** Speaking speed multiplier (0.25–4.0). */
  speed?: number;
  /** Free-form delivery directions (gpt-4o-mini-tts only), e.g. "calm documentary narrator". */
  instructions?: string;
}

export interface OpenAiTtsResult {
  success: boolean;
  /** MP3 audio data. */
  audioBuffer?: Buffer;
  error?: string;
  characterCount?: number;
}

/**
 * OpenAI text-to-speech (`POST /v1/audio/speech`). Backs the user-facing
 * "openai" provider id for the `speech` kind — the metadata declaration
 * lives in `../openai/index.ts`, mirroring how OpenAIImageProvider backs
 * the same id for images.
 */
export class OpenAiTtsProvider implements AIProvider, SpeechGenerator {
  id = "openai";
  readonly speechProvider = "openai";
  name = "OpenAI TTS";
  description = "OpenAI cloud text-to-speech (gpt-4o-mini-tts)";
  capabilities: AICapability[] = ["text-to-speech"];
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.openai.com/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── SpeechGenerator ───────────────────────────────────────────────────

  async synthesize(request: SpeechRequest): Promise<SpeechResult> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.speechProvider, message: "OpenAI API key not configured" });
    }
    const model = resolveCatalogModel(this.speechProvider, "speech", request.model).id;
    const voice = (request.voice ?? DEFAULT_VOICE).toLowerCase();
    const voices: readonly string[] = model.startsWith("tts-1") ? TTS_1_VOICES : OPENAI_TTS_VOICES;
    if (!voices.includes(voice)) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.speechProvider,
        message: `Unknown OpenAI voice "${request.voice}" for ${model}. Available voices: ${voices.join(", ")}.`,
      });
    }
    const response = await providerRequest(this.speechProvider, `${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: request.text,
        voice,
        response_format: "mp3",
        ...(request.speed !== undefined && { speed: request.speed }),
        ...(request.instructions !== undefined && { instructions: request.instructions }),
      }),
    });
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: "audio/mpeg",
      extension: "mp3",
      model,
      characters: request.text.length,
    };
  }

  /** Older interface; `synthesize` is the contract. */
  async textToSpeech(text: string, options: OpenAiTtsOptions = {}): Promise<OpenAiTtsResult> {
    try {
      const result = await this.synthesize({
        text,
        voice: options.voice,
        model: options.model,
        speed: options.speed,
        instructions: options.instructions,
      });
      return { success: true, audioBuffer: Buffer.from(result.bytes), characterCount: result.characters };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}

export const openaiTtsProvider = new OpenAiTtsProvider();
