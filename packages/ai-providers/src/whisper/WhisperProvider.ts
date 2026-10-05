import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  TranscribeOptions,
  TranscriptResult,
  TranscriptWord,
} from "../interface/types.js";
import { audioFilename, type Transcriber, type Transcript, type TranscriptionRequest } from "../transcription/contract.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { resolveCatalogModel } from "../video/models.js";

/**
 * OpenAI Whisper provider for speech-to-text.
 *
 * Supports segment-level (default) and word-level timestamps via the
 * `timestamp_granularities[]` query parameter on the `/audio/transcriptions`
 * endpoint. Word-level output mirrors the Hyperframes `transcript.json`
 * shape (`{text, start, end}`) so it can drive scene HTML GSAP timelines.
 */
export class WhisperProvider implements AIProvider, Transcriber {
  id = "whisper";
  readonly transcriptionProvider = "openai";
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

  /** Whisper takes uploads up to 25 MB (docs). */
  private static readonly MAX_BYTES = 25 * 1024 * 1024;

  // ── Transcriber ───────────────────────────────────────────────────────

  async transcribeAudio(request: TranscriptionRequest): Promise<Transcript> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.transcriptionProvider, message: "OpenAI API key not configured for Whisper" });
    }
    if (request.audio.byteLength > WhisperProvider.MAX_BYTES) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.transcriptionProvider,
        message: `Whisper takes audio up to 25 MB, not ${(request.audio.byteLength / 1024 / 1024).toFixed(1)} MB. Extract a lower-bitrate audio track first.`,
      });
    }
    const model = resolveCatalogModel(this.transcriptionProvider, "transcription", request.model).id;
    const granularity = request.granularity ?? "segment";
    const form = new FormData();
    // Whisper reads the format from the filename's extension.
    form.append("file", new Blob([new Uint8Array(request.audio)]), request.filename ?? audioFilename(request.audio));
    form.append("model", model);
    form.append("response_format", "verbose_json");
    if (granularity === "segment" || granularity === "both") form.append("timestamp_granularities[]", "segment");
    if (granularity === "word" || granularity === "both") form.append("timestamp_granularities[]", "word");
    if (request.language) form.append("language", request.language);

    const response = await providerRequest(this.transcriptionProvider, `${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    }, { timeoutMs: 10 * 60_000 });
    const data = (await response.json()) as {
      text: string;
      language?: string;
      segments?: Array<{ id: number; start: number; end: number; text: string }>;
      words?: Array<{ word: string; start: number; end: number }>;
    };
    return {
      text: data.text,
      language: data.language,
      model,
      segments:
        granularity === "segment" || granularity === "both"
          ? data.segments?.map((seg, index) => ({
              id: `segment-${index}`,
              startTime: seg.start,
              endTime: seg.end,
              text: seg.text.trim(),
              confidence: 1, // Whisper doesn't provide per-segment confidence
            }))
          : undefined,
      words:
        granularity === "word" || granularity === "both"
          ? data.words?.map((w): TranscriptWord => ({ text: w.word, start: w.start, end: w.end }))
          : undefined,
    };
  }

  /** Older interface; `transcribeAudio` is the contract. */
  async transcribe(audio: Blob, language?: string, options?: TranscribeOptions): Promise<TranscriptResult> {
    try {
      const transcript = await this.transcribeAudio({
        audio: new Uint8Array(await audio.arrayBuffer()),
        language: language ?? options?.language,
        granularity: options?.granularity,
      });
      return {
        id: crypto.randomUUID(),
        status: "completed",
        fullText: transcript.text,
        detectedLanguage: transcript.language,
        segments: transcript.segments,
        words: transcript.words,
      };
    } catch (error) {
      return { id: "", status: "failed", error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}

export const whisperProvider = new WhisperProvider();
