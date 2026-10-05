/**
 * The speech (text-to-speech) contract every TTS provider implements.
 *
 * A request goes in and audio bytes come back, or a `ProviderError` is
 * thrown. Each provider answers in its own container (ElevenLabs and OpenAI
 * MP3, local Kokoro WAV), which the result names so callers pick the file
 * extension without knowing the provider.
 */

export interface SpeechRequest {
  text: string;
  /** Provider-specific voice: an ElevenLabs name or ID, an OpenAI voice, a Kokoro voice ID. */
  voice?: string;
  /** Catalog model ID or alias; the provider's default when omitted. */
  model?: string;
  /** Speaking speed multiplier; each provider clamps to its own range. */
  speed?: number;
  /** Delivery directions, for models that take them (OpenAI gpt-4o-mini-tts). */
  instructions?: string;
}

export interface SpeechResult {
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "audio/wav";
  extension: "mp3" | "wav";
  /** The catalog model ID that spoke it. */
  model: string;
  /** Characters billed (the input length). */
  characters: number;
}

export interface SpeechSynthesisOptions {
  /** Progress while a local model loads (Kokoro's first call downloads it). */
  onProgress?: (event: { status: string; file?: string; progress?: number }) => void;
}

export interface SpeechGenerator {
  /** Catalog provider id ("elevenlabs", "openai", "kokoro"). */
  readonly speechProvider: string;
  /** Throws `ProviderError`. */
  synthesize(request: SpeechRequest, options?: SpeechSynthesisOptions): Promise<SpeechResult>;
}
