/**
 * ElevenLabs Scribe speech-to-text behind the transcription contract.
 *
 * Scribe returns one flat token list (`words[]`) of words, the spacing
 * between them, and tagged audio events, each with its own timing. The
 * contract also promises segments, which Scribe does not send, so they are
 * built here from the words: a segment ends at sentence punctuation, a
 * pause, a speaker change, or when it grows too long for one caption.
 */

import type { ProviderConfig, TranscriptSegment, TranscriptWord } from "../interface/types.js";
import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { audioFilename, type Transcriber, type Transcript, type TranscriptionRequest } from "../transcription/contract.js";
import { recordTranscriptionUsage } from "../usage/audio-duration.js";
import { resolveCatalogModel } from "../video/models.js";

/** One entry of Scribe's `words[]` (docs: speech-to-text/convert). */
export interface ScribeToken {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start?: number | null;
  end?: number | null;
  speaker_id?: string | null;
  logprob?: number | null;
}

interface ScribeResponse {
  text: string;
  language_code?: string;
  words?: ScribeToken[];
  /** Billed length of the upload. */
  audio_duration_secs?: number;
}

/** A pause at least this long between two words starts a new segment. */
const PAUSE_SECONDS = 0.8;
/** Past this length a segment ends at the next clause punctuation. */
const SOFT_MAX_SECONDS = 6;
/** Past this length a segment ends before the next word, punctuation or not. */
const HARD_MAX_SECONDS = 12;

const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
const CLAUSE_END = /[,;:、，；：]["'”’)\]]*$/;

function timed(token: ScribeToken): token is ScribeToken & { start: number; end: number } {
  return typeof token.start === "number" && typeof token.end === "number";
}

/** Scribe's timed words in the contract's word shape; spacing and audio events are dropped. */
export function scribeWords(tokens: readonly ScribeToken[]): TranscriptWord[] {
  return tokens
    .filter((t) => t.type === "word" && timed(t) && t.text.trim())
    .map((t) => ({ text: t.text.trim(), start: t.start as number, end: t.end as number }));
}

/**
 * Group Scribe tokens into caption-sized segments. The text keeps Scribe's
 * own spacing tokens, so languages written without spaces stay intact.
 * Audio events never enter a segment.
 */
export function scribeSegments(tokens: readonly ScribeToken[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let parts: string[] = [];
  let start: number | undefined;
  let end: number | undefined;
  let speaker: string | undefined;
  let logprobs: number[] = [];

  const flush = () => {
    const text = parts.join("").replace(/\s+/g, " ").trim();
    if (text && start !== undefined && end !== undefined) {
      const mean = logprobs.length ? logprobs.reduce((a, b) => a + b, 0) / logprobs.length : 0;
      segments.push({
        id: `segment-${segments.length}`,
        startTime: start,
        endTime: end,
        text,
        confidence: Math.min(1, Math.max(0, Math.exp(mean))),
        ...(speaker !== undefined && { speaker }),
      });
    }
    parts = [];
    start = end = speaker = undefined;
    logprobs = [];
  };

  for (const token of tokens) {
    if (token.type === "audio_event") continue;
    if (token.type === "spacing") {
      if (parts.length) parts.push(token.text);
      continue;
    }
    if (!token.text.trim()) continue;
    if (timed(token) && start !== undefined && end !== undefined) {
      const pause = token.start - end >= PAUSE_SECONDS;
      const newSpeaker = token.speaker_id != null && speaker !== undefined && token.speaker_id !== speaker;
      const tooLong = token.end - start > HARD_MAX_SECONDS;
      if (pause || newSpeaker || tooLong) flush();
    }
    parts.push(token.text);
    if (timed(token)) {
      start ??= token.start;
      end = token.end;
    }
    if (token.speaker_id != null) speaker ??= token.speaker_id;
    if (typeof token.logprob === "number") logprobs.push(token.logprob);

    const text = token.text.trim();
    const length = start !== undefined && end !== undefined ? end - start : 0;
    if (SENTENCE_END.test(text) || (length >= SOFT_MAX_SECONDS && CLAUSE_END.test(text))) flush();
  }
  flush();
  return segments;
}

/** ElevenLabs Scribe (`POST /v1/speech-to-text`). */
export class ScribeTranscriber implements Transcriber {
  readonly transcriptionProvider = "elevenlabs";

  /** The upload limit the speech-to-text overview documents (the API reference allows 5 GB). */
  private static readonly MAX_BYTES = 3 * 1024 * 1024 * 1024;

  private apiKey?: string;
  private baseUrl = "https://api.elevenlabs.io/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) this.baseUrl = config.baseUrl;
  }

  async transcribeAudio(request: TranscriptionRequest): Promise<Transcript> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: this.transcriptionProvider, message: "ElevenLabs API key not configured for Scribe" });
    }
    if (request.audio.byteLength > ScribeTranscriber.MAX_BYTES) {
      throw new ProviderError({
        kind: "invalid-request",
        provider: this.transcriptionProvider,
        message: `Scribe takes audio up to 3 GB, not ${(request.audio.byteLength / 1024 ** 3).toFixed(1)} GB. Extract a lower-bitrate audio track first.`,
      });
    }
    const model = resolveCatalogModel(this.transcriptionProvider, "transcription", request.model).id;
    const granularity = request.granularity ?? "segment";

    const form = new FormData();
    form.append("model_id", model);
    form.append("file", new Blob([new Uint8Array(request.audio)]), request.filename ?? audioFilename(request.audio));
    // Segments are built from word timings, so words are always requested.
    form.append("timestamps_granularity", "word");
    // "(laughter)" tokens would otherwise land in captions and transcripts.
    form.append("tag_audio_events", "false");
    if (request.language) form.append("language_code", request.language);

    const response = await providerRequest(this.transcriptionProvider, `${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: form,
    }, { timeoutMs: 30 * 60_000 });
    const data = (await response.json()) as ScribeResponse;
    const tokens = data.words ?? [];
    recordTranscriptionUsage({
      provider: this.transcriptionProvider,
      model,
      reportedSeconds: data.audio_duration_secs,
      audio: request.audio,
      lastTimestamp: Math.max(0, ...tokens.map((t) => t.end ?? 0)) || undefined,
    });
    return {
      text: data.text,
      language: data.language_code,
      model,
      segments: granularity === "segment" || granularity === "both" ? scribeSegments(tokens) : undefined,
      words: granularity === "word" || granularity === "both" ? scribeWords(tokens) : undefined,
    };
  }
}
