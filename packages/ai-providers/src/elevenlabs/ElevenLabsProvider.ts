import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types";

/**
 * Voice info from ElevenLabs API
 */
export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
}

/**
 * TTS generation options
 */
export interface TTSOptions {
  /** Voice ID to use */
  voiceId?: string;
  /** Model to use (eleven_multilingual_v2, eleven_monolingual_v1) */
  model?: string;
  /** Stability (0-1) - higher = more consistent */
  stability?: number;
  /** Similarity boost (0-1) - higher = more similar to original voice */
  similarityBoost?: number;
  /** Style (0-1) - only for v2 models */
  style?: number;
  /** Output format */
  outputFormat?: "mp3_44100_128" | "mp3_22050_32" | "pcm_16000" | "pcm_22050";
}

/**
 * TTS generation result
 */
export interface TTSResult {
  success: boolean;
  /** Audio data as Buffer (for saving to file) */
  audioBuffer?: Buffer;
  /** Error message if failed */
  error?: string;
  /** Character count used */
  characterCount?: number;
}

/**
 * ElevenLabs provider for text-to-speech
 */
export class ElevenLabsProvider implements AIProvider {
  id = "elevenlabs";
  name = "ElevenLabs";
  description = "AI text-to-speech with natural voices and voice cloning";
  capabilities: AICapability[] = ["text-to-speech"];
  iconUrl = "/icons/elevenlabs.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.elevenlabs.io/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get list of available voices
   */
  async getVoices(): Promise<Voice[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/voices`, {
        headers: {
          "xi-api-key": this.apiKey,
        },
      });

      if (!response.ok) {
        console.error("ElevenLabs API error:", await response.text());
        return [];
      }

      const data = (await response.json()) as { voices: Voice[] };
      return data.voices || [];
    } catch (error) {
      console.error("ElevenLabs getVoices error:", error);
      return [];
    }
  }

  /**
   * Generate speech from text
   */
  async textToSpeech(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "ElevenLabs API key not configured",
      };
    }

    try {
      const voiceId = options.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Default: Rachel
      const model = options.model || "eleven_multilingual_v2";

      const response = await fetch(
        `${this.baseUrl}/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              stability: options.stability ?? 0.5,
              similarity_boost: options.similarityBoost ?? 0.75,
              style: options.style ?? 0,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `TTS failed: ${error}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      return {
        success: true,
        audioBuffer,
        characterCount: text.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get user subscription info (quota)
   */
  async getSubscriptionInfo(): Promise<{
    characterCount: number;
    characterLimit: number;
    tier: string;
  } | null> {
    if (!this.apiKey) return null;

    try {
      const response = await fetch(`${this.baseUrl}/user/subscription`, {
        headers: {
          "xi-api-key": this.apiKey,
        },
      });

      if (!response.ok) return null;

      const data = (await response.json()) as {
        character_count: number;
        character_limit: number;
        tier: string;
      };

      return {
        characterCount: data.character_count,
        characterLimit: data.character_limit,
        tier: data.tier,
      };
    } catch {
      return null;
    }
  }
}

export const elevenLabsProvider = new ElevenLabsProvider();
