import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";

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
const DEFAULT_MODEL: OpenAiTtsModel = "gpt-4o-mini-tts";

/** One retry absorbs transient rate-limit overlap, mirroring ElevenLabs. */
const TTS_429_MAX_RETRIES = 1;
const TTS_429_RETRY_DELAY_MS = 2000;

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
export class OpenAiTtsProvider implements AIProvider {
  id = "openai";
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

  async textToSpeech(text: string, options: OpenAiTtsOptions = {}): Promise<OpenAiTtsResult> {
    if (!this.apiKey) {
      return { success: false, error: "OpenAI API key not configured" };
    }

    const voice = (options.voice ?? DEFAULT_VOICE).toLowerCase();
    if (!(OPENAI_TTS_VOICES as readonly string[]).includes(voice)) {
      return {
        success: false,
        error:
          `Unknown OpenAI voice "${options.voice}". Available voices: ` +
          `${OPENAI_TTS_VOICES.join(", ")}.`,
      };
    }

    try {
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        response = await fetch(`${this.baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model ?? DEFAULT_MODEL,
            input: text,
            voice,
            response_format: "mp3",
            ...(options.speed !== undefined && { speed: options.speed }),
            ...(options.instructions !== undefined && { instructions: options.instructions }),
          }),
        });
        if (response.status === 429 && attempt < TTS_429_MAX_RETRIES) {
          await new Promise((resolveDelay) =>
            setTimeout(resolveDelay, TTS_429_RETRY_DELAY_MS * (attempt + 1)),
          );
          continue;
        }
        break;
      }

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `OpenAI TTS failed: ${error}` };
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        success: true,
        audioBuffer: Buffer.from(arrayBuffer),
        characterCount: text.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const openaiTtsProvider = new OpenAiTtsProvider();
