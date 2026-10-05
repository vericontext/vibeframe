/**
 * The transcription (speech-to-text) contract.
 *
 * Audio bytes go in and a timed transcript comes back, or a `ProviderError`
 * is thrown. Providers that detect the format from the upload's filename
 * get one derived from the bytes, so callers never have to name it.
 */

import type { TranscriptGranularity, TranscriptSegment, TranscriptWord } from "../interface/types.js";

export interface TranscriptionRequest {
  audio: Uint8Array;
  /** Upload filename; inferred from the bytes when omitted. */
  filename?: string;
  /** BCP-47 language hint ("en", "ko"). */
  language?: string;
  /** Timestamp granularity. Default "segment". */
  granularity?: TranscriptGranularity;
  /** Catalog model ID or alias; the provider's default when omitted. */
  model?: string;
}

export interface Transcript {
  text: string;
  /** The language the provider detected. */
  language?: string;
  segments?: TranscriptSegment[];
  words?: TranscriptWord[];
  /** The catalog model that transcribed it. */
  model: string;
}

export interface Transcriber {
  /** Catalog provider id ("openai"). */
  readonly transcriptionProvider: string;
  /** Throws `ProviderError`. */
  transcribeAudio(request: TranscriptionRequest): Promise<Transcript>;
}

/** A filename whose extension matches the audio container, from its magic bytes. */
export function audioFilename(bytes: Uint8Array): string {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio.wav";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio.mp3";
  if (ascii(4, 4) === "ftyp") return "audio.m4a";
  if (ascii(0, 4) === "OggS") return "audio.ogg";
  if (ascii(0, 4) === "fLaC") return "audio.flac";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio.webm";
  return "audio.mp3";
}
