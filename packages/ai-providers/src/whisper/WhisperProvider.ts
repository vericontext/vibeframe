import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  TranscribeOptions,
  TranscriptResult,
  TranscriptWord,
} from "../interface/types.js";

/**
 * OpenAI Whisper provider for speech-to-text.
 *
 * Supports segment-level (default) and word-level timestamps via the
 * `timestamp_granularities[]` query parameter on the `/audio/transcriptions`
 * endpoint. Word-level output mirrors the Hyperframes `transcript.json`
 * shape (`{text, start, end}`) so it can drive scene HTML GSAP timelines.
 */
export class WhisperProvider implements AIProvider {
  id = "whisper";
  name = "OpenAI Whisper";
  description = "Speech-to-text transcription using OpenAI Whisper API";
  capabilities: AICapability[] = ["speech-to-text"];
  iconUrl = "/icons/openai.svg";
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

  async transcribe(
    audio: Blob,
    language?: string,
    options?: TranscribeOptions,
  ): Promise<TranscriptResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Whisper API key not configured",
      };
    }

    const granularity = options?.granularity ?? "segment";

    try {
      const formData = new FormData();
      formData.append("file", audio, "audio.webm");
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");

      // Whisper API accepts multiple `timestamp_granularities[]` values.
      if (granularity === "segment" || granularity === "both") {
        formData.append("timestamp_granularities[]", "segment");
      }
      if (granularity === "word" || granularity === "both") {
        formData.append("timestamp_granularities[]", "word");
      }

      const lang = language ?? options?.language;
      if (lang) {
        formData.append("language", lang);
      }

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          id: "",
          status: "failed",
          error: `Transcription failed: ${error}`,
        };
      }

      const data = await response.json() as {
        text: string;
        language?: string;
        segments?: Array<{ id: number; start: number; end: number; text: string }>;
        words?: Array<{ word: string; start: number; end: number }>;
      };

      const result: TranscriptResult = {
        id: crypto.randomUUID(),
        status: "completed",
        fullText: data.text,
        detectedLanguage: data.language,
      };

      if (granularity === "segment" || granularity === "both") {
        result.segments = data.segments?.map((seg, index) => ({
          id: `segment-${index}`,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text.trim(),
          confidence: 1, // Whisper doesn't provide per-segment confidence
        }));
      }

      if (granularity === "word" || granularity === "both") {
        result.words = data.words?.map((w): TranscriptWord => ({
          text: w.word,
          start: w.start,
          end: w.end,
        }));
      }

      return result;
    } catch (error) {
      return {
        id: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const whisperProvider = new WhisperProvider();
