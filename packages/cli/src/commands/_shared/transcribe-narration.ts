/**
 * @module _shared/transcribe-narration
 *
 * Shared narration → word-level transcript helpers, used by both
 * `vibe scene add` (deterministic emit path) and `vibe build` (LLM compose
 * path). Whisper transcription of the generated narration audio is the
 * single, provider-agnostic source of word timings: every TTS provider
 * (kokoro / openai / elevenlabs) writes a `.wav`/`.mp3`, and word timings let
 * the composer sync captions / kinetic typography to speech.
 *
 * Failure is always non-fatal — narration still plays; callers treat the
 * absence of timings as "no word-sync available", never as a build error.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { WhisperProvider } from "@vibeframe/ai-providers";

import type { SceneTranscriptWord } from "./scene-html-emit.js";

export interface TranscribeNarrationOptions {
  /** OpenAI API key for Whisper. */
  apiKey: string;
  /** Optional BCP-47 language hint passed to Whisper (auto-detect when unset). */
  language?: string;
}

/**
 * Transcribe a narration audio file to word-level timings. Returns an empty
 * array on ANY failure (no words, API error, bad audio) so callers can treat
 * the absence of timings as "no word-sync available" rather than abort.
 */
export async function transcribeNarrationWords(
  audioAbsPath: string,
  opts: TranscribeNarrationOptions
): Promise<SceneTranscriptWord[]> {
  try {
    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey: opts.apiKey });
    const audioBytes = await readFile(audioAbsPath);
    const audioBlob = new Blob([new Uint8Array(audioBytes)]);
    const transcript = await whisper.transcribe(audioBlob, undefined, {
      granularity: "word",
      language: opts.language,
    });
    if (transcript.status === "completed" && transcript.words?.length) {
      return transcript.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
    }
    return [];
  } catch {
    return [];
  }
}

/** Canonical per-beat transcript path, relative to the project root. */
export function beatTranscriptRelPath(beatId: string): string {
  return `assets/transcript-${beatId}.json`;
}

/**
 * Read a previously generated `assets/transcript-<beatId>.json` from disk.
 * Returns `undefined` when the file is missing or malformed — compose then
 * proceeds without word timings (identical to a project that never
 * transcribed). Validates each entry's shape so a hand-edited or partial file
 * can't inject `NaN`/`undefined` timings into the prompt.
 */
export async function readBeatTranscript(
  projectDir: string,
  beatId: string
): Promise<SceneTranscriptWord[] | undefined> {
  const abs = join(projectDir, beatTranscriptRelPath(beatId));
  if (!existsSync(abs)) return undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(abs, "utf-8"));
    if (!Array.isArray(parsed)) return undefined;
    const words = parsed
      .filter(
        (w): w is SceneTranscriptWord =>
          typeof w === "object" &&
          w !== null &&
          typeof (w as SceneTranscriptWord).text === "string" &&
          Number.isFinite((w as SceneTranscriptWord).start) &&
          Number.isFinite((w as SceneTranscriptWord).end)
      )
      .map((w) => ({ text: w.text, start: w.start, end: w.end }));
    return words.length > 0 ? words : undefined;
  } catch {
    return undefined;
  }
}
