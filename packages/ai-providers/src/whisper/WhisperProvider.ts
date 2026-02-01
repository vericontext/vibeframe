import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  TranscriptResult,
} from "../interface/types.js";

/**
 * OpenAI Whisper provider for speech-to-text
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

  async transcribe(audio: Blob, language?: string): Promise<TranscriptResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Whisper API key not configured",
      };
    }

    try {
      const formData = new FormData();
      formData.append("file", audio, "audio.webm");
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      if (language) {
        formData.append("language", language);
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
      };

      return {
        id: crypto.randomUUID(),
        status: "completed",
        fullText: data.text,
        detectedLanguage: data.language,
        segments: data.segments?.map((seg: {
          id: number;
          start: number;
          end: number;
          text: string;
        }, index: number) => ({
          id: `segment-${index}`,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text.trim(),
          confidence: 1, // Whisper doesn't provide confidence per segment
        })),
      };
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
