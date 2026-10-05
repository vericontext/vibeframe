/**
 * The CLI side of the transcription contract: transcribe an audio file on
 * disk and get the result shape the commands already use. Every command
 * that needs a transcript (audio, captions, highlights, jump-cut, scene
 * narration) goes through here.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  createTranscriber,
  isProviderError,
  type ProviderErrorKind,
  type TranscriptGranularity,
  type TranscriptResult,
} from "@vibeframe/ai-providers";

export interface TranscribeFileOptions {
  apiKey: string;
  language?: string;
  granularity?: TranscriptGranularity;
}

/** Transcribe `path` with Whisper. Failures come back as `status: "failed"` with an error kind. */
export async function transcribeAudioFile(
  path: string,
  options: TranscribeFileOptions
): Promise<TranscriptResult & { errorKind?: ProviderErrorKind }> {
  try {
    const transcriber = await createTranscriber("openai", options.apiKey);
    const audio = new Uint8Array(await readFile(path));
    const name = basename(path);
    const transcript = await transcriber.transcribeAudio({
      audio,
      // A real extension helps Whisper; temp files without one are sniffed from the bytes.
      filename: /\.(mp3|wav|m4a|mp4|ogg|flac|webm|mpeg|mpga)$/i.test(name) ? name : undefined,
      language: options.language,
      granularity: options.granularity,
    });
    return {
      id: `transcript-${Date.now()}`,
      status: "completed",
      fullText: transcript.text,
      detectedLanguage: transcript.language,
      segments: transcript.segments,
      words: transcript.words,
    };
  } catch (error) {
    return {
      id: "",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      errorKind: isProviderError(error) ? error.kind : undefined,
    };
  }
}
