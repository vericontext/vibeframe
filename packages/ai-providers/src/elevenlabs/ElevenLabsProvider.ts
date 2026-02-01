import type {
  AIProvider,
  AICapability,
  ProviderConfig,
} from "../interface/types.js";

/**
 * Voice clone options
 */
export interface VoiceCloneOptions {
  /** Voice name (required) */
  name: string;
  /** Voice description */
  description?: string;
  /** Voice labels as key-value pairs */
  labels?: Record<string, string>;
  /** Remove background noise from samples */
  removeBackgroundNoise?: boolean;
}

/**
 * Voice clone result
 */
export interface VoiceCloneResult {
  success: boolean;
  /** The created voice ID */
  voiceId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Sound effect generation options
 */
export interface SoundEffectOptions {
  /** Duration in seconds (0.5-22, default: auto) */
  duration?: number;
  /** Prompt influence (0-1, default: 0.3) */
  promptInfluence?: number;
}

/**
 * Sound effect generation result
 */
export interface SoundEffectResult {
  success: boolean;
  /** Audio data as Buffer */
  audioBuffer?: Buffer;
  /** Error message if failed */
  error?: string;
}

/**
 * Audio isolation result
 */
export interface AudioIsolationResult {
  success: boolean;
  /** Isolated vocals as Buffer */
  audioBuffer?: Buffer;
  /** Error message if failed */
  error?: string;
}

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
  capabilities: AICapability[] = ["text-to-speech", "sound-generation", "audio-isolation", "voice-clone"];
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

  /**
   * Generate sound effect from text prompt
   */
  async generateSoundEffect(
    prompt: string,
    options: SoundEffectOptions = {}
  ): Promise<SoundEffectResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "ElevenLabs API key not configured",
      };
    }

    try {
      const body: Record<string, unknown> = {
        text: prompt,
        prompt_influence: options.promptInfluence ?? 0.3,
      };

      // Duration is optional; API auto-determines if not provided
      if (options.duration !== undefined) {
        // Clamp to valid range (0.5-22 seconds)
        const duration = Math.max(0.5, Math.min(22, options.duration));
        body.duration_seconds = duration;
      }

      const response = await fetch(`${this.baseUrl}/sound-generation`, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Sound generation failed: ${error}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      return {
        success: true,
        audioBuffer,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Isolate vocals from audio
   * Separates the vocal track from the background music/noise
   */
  async isolateVocals(audioData: Buffer | Blob): Promise<AudioIsolationResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "ElevenLabs API key not configured",
      };
    }

    try {
      const formData = new FormData();

      const audioBlob = Buffer.isBuffer(audioData)
        ? new Blob([new Uint8Array(audioData)])
        : audioData;
      formData.append("audio", audioBlob, "audio.mp3");

      const response = await fetch(`${this.baseUrl}/audio-isolation`, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          Accept: "audio/mpeg",
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Audio isolation failed: ${error}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      return {
        success: true,
        audioBuffer,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Clone a voice from audio samples
   * Requires at least one audio sample (1-25 samples supported)
   */
  async cloneVoice(
    audioSamples: Buffer[],
    options: VoiceCloneOptions
  ): Promise<VoiceCloneResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "ElevenLabs API key not configured",
      };
    }

    if (audioSamples.length === 0) {
      return {
        success: false,
        error: "At least one audio sample is required",
      };
    }

    if (audioSamples.length > 25) {
      return {
        success: false,
        error: "Maximum 25 audio samples allowed",
      };
    }

    try {
      const formData = new FormData();
      formData.append("name", options.name);

      if (options.description) {
        formData.append("description", options.description);
      }

      if (options.labels) {
        formData.append("labels", JSON.stringify(options.labels));
      }

      if (options.removeBackgroundNoise) {
        formData.append("remove_background_noise", "true");
      }

      // Add audio samples
      for (let i = 0; i < audioSamples.length; i++) {
        const blob = new Blob([new Uint8Array(audioSamples[i])]);
        formData.append("files", blob, `sample_${i + 1}.mp3`);
      }

      const response = await fetch(`${this.baseUrl}/voices/add`, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Voice clone failed: ${error}`,
        };
      }

      const data = (await response.json()) as { voice_id: string };

      return {
        success: true,
        voiceId: data.voice_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "ElevenLabs API key not configured",
      };
    }

    try {
      const response = await fetch(`${this.baseUrl}/voices/${voiceId}`, {
        method: "DELETE",
        headers: {
          "xi-api-key": this.apiKey,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Voice deletion failed: ${error}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const elevenLabsProvider = new ElevenLabsProvider();
