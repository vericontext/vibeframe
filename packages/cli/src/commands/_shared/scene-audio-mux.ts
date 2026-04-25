/**
 * @module _shared/scene-audio-mux
 *
 * Lay every `<audio>` element discovered by `scene-audio-scan.ts` onto a
 * single audio track and mux it into the producer's silent video output.
 *
 * Why this exists: `@hyperframes/producer` renders frames + assembles the
 * MP4 but does not embed audio from sub-composition `<audio>` elements
 * (verified against the upstream Hyperframes reference example). We do the
 * mux ourselves with one ffmpeg pass, copying the producer's video stream
 * untouched so we don't pay a re-encode tax.
 *
 * The filter graph for N audio inputs is:
 *
 *   [1:a]adelay=Sms:all=1,volume=V[a1];
 *   [2:a]adelay=Sms:all=1,volume=V[a2];
 *   ...
 *   [a1][a2]...amix=inputs=N:dropout_transition=0:normalize=0[mixed]
 *
 * Single-input case skips the amix (cheaper and avoids amix's auto-gain).
 *
 * Pure construction lives in `buildAudioMuxFilter`. The async `muxAudioIntoVideo`
 * shells out to ffmpeg via the project's existing `execSafe` wrapper.
 */

import { rename, unlink } from "node:fs/promises";
import { resolve, dirname, extname, basename } from "node:path";
import { execSafe, commandExists } from "../../utils/exec-safe.js";
import type { SceneAudioElement } from "./scene-audio-scan.js";

export interface AudioMuxFilter {
  /** ffmpeg `-filter_complex` string. */
  filterComplex: string;
  /** Output stream label inside the graph (e.g. `[mixed]` or `[a0]`). */
  outLabel: string;
  /** Number of audio inputs the caller must `-i` before this filter. */
  inputCount: number;
}

/**
 * Build a filter_complex for the given audio elements. Pure — no I/O.
 *
 * Each element becomes one ffmpeg input (input index 1, 2, ... — input 0 is
 * the silent video). `adelay` shifts the audio to its absolute timeline
 * start, `volume` applies per-element gain, and `amix` blends them. When
 * there's only one element we skip `amix` entirely.
 */
export function buildAudioMuxFilter(audios: SceneAudioElement[]): AudioMuxFilter | null {
  if (audios.length === 0) return null;

  const labels: string[] = [];
  const stages: string[] = [];

  audios.forEach((a, i) => {
    const inputIdx = i + 1; // input 0 is the video
    const delayMs = Math.max(0, Math.round(a.absoluteStart * 1000));
    const volume = Number.isFinite(a.volume) ? a.volume : 1;
    // Hard-cap audio length at the parent clip's duration so a long wav
    // doesn't bleed past its scene. Use atrim+asetpts for a clean cut.
    const trimSec = Math.max(0, a.clipDurationCap);
    const label = `a${i}`;
    const stage = [
      `[${inputIdx}:a]`,
      `atrim=duration=${trimSec.toFixed(3)},`,
      `asetpts=PTS-STARTPTS,`,
      `adelay=${delayMs}:all=1,`,
      `volume=${volume}`,
      `[${label}]`,
    ].join("");
    stages.push(stage);
    labels.push(`[${label}]`);
  });

  if (audios.length === 1) {
    return {
      filterComplex: stages.join(";"),
      outLabel: labels[0],
      inputCount: 1,
    };
  }

  const mix = `${labels.join("")}amix=inputs=${audios.length}:dropout_transition=0:normalize=0[mixed]`;
  return {
    filterComplex: `${stages.join(";")};${mix}`,
    outLabel: "[mixed]",
    inputCount: audios.length,
  };
}

export interface AudioMuxOptions {
  /** Producer's silent video output (will be replaced with the mux'd file). */
  videoPath: string;
  /** Audio elements with absolute timing, from `scanSceneAudio`. */
  audios: SceneAudioElement[];
  /** Final output container — drives the audio codec choice. */
  format: "mp4" | "webm" | "mov";
  /** Cap output to this many seconds via ffmpeg `-t`. Falls back to `videoDuration`. */
  totalDuration?: number;
  /** Producer's video duration (probed by ffprobe). Used as default cap. */
  videoDuration?: number;
  /** Callback for ffmpeg stderr lines (progress / errors). */
  onProgress?: (line: string) => void;
}

export interface AudioMuxResult {
  /** True when ffmpeg succeeded. */
  success: boolean;
  /** Absolute path of the produced file (overwrites the input on success). */
  outputPath: string;
  /** ffmpeg stderr tail when success === false. */
  error?: string;
  /** Number of audio inputs muxed. */
  audioCount: number;
}

/**
 * Audio codec for each container. Stays in sync with what the upstream
 * producer chose for video so the file stays playable.
 */
function audioCodecForFormat(format: AudioMuxOptions["format"]): string {
  if (format === "webm") return "libopus";
  if (format === "mov") return "pcm_s16le"; // ProRes-friendly
  return "aac";
}

/**
 * Run ffmpeg to overlay every `<audio>` element onto the producer's silent
 * video. Replaces the input file on success. Idempotent — re-running on the
 * same project repeats the work but produces an equivalent result.
 *
 * No-op (`success: true, audioCount: 0`) when `audios` is empty.
 */
export async function muxAudioIntoVideo(opts: AudioMuxOptions): Promise<AudioMuxResult> {
  if (opts.audios.length === 0) {
    return { success: true, outputPath: opts.videoPath, audioCount: 0 };
  }

  if (!commandExists("ffmpeg")) {
    return {
      success: false,
      outputPath: opts.videoPath,
      audioCount: opts.audios.length,
      error: "ffmpeg not found in PATH — install via `brew install ffmpeg` (mac) or your package manager",
    };
  }

  const filter = buildAudioMuxFilter(opts.audios);
  if (!filter) {
    return { success: true, outputPath: opts.videoPath, audioCount: 0 };
  }

  // Write to a sibling temp file then atomic-rename over the original. Avoids
  // corrupting the producer's MP4 if ffmpeg crashes mid-write.
  const ext = extname(opts.videoPath) || `.${opts.format}`;
  const tmpPath = resolve(
    dirname(opts.videoPath),
    `.${basename(opts.videoPath, ext)}.muxing${ext}`,
  );

  const args: string[] = ["-y", "-loglevel", "error", "-i", opts.videoPath];
  for (const a of opts.audios) {
    args.push("-i", a.srcAbs);
  }
  args.push(
    "-filter_complex",
    filter.filterComplex,
    "-map",
    "0:v",
    "-map",
    filter.outLabel,
    "-c:v",
    "copy",
    "-c:a",
    audioCodecForFormat(opts.format),
    // Cap on the video duration so audio that overruns the producer's render
    // (e.g. a long Kokoro wav on a short scene) doesn't extend the output.
    // Video drives the timeline because the producer already counted frames.
    "-t",
    (opts.totalDuration && opts.totalDuration > 0
      ? opts.totalDuration.toFixed(3)
      : opts.videoDuration?.toFixed(3) ?? ""),
  );
  // Drop trailing empty -t value if neither override nor probe-supplied
  // duration was provided. ffmpeg without -t falls back to its default
  // (longest input) which is fine when -c:v copy keeps the video stream.
  if (args[args.length - 1] === "") {
    args.pop();
    args.pop(); // also drop the "-t" flag
  }
  args.push("-movflags", "+faststart", tmpPath);

  try {
    const { stderr } = await execSafe("ffmpeg", args);
    if (stderr && opts.onProgress) {
      stderr.split(/\r?\n/).forEach((line) => opts.onProgress?.(line));
    }
  } catch (err) {
    // execSafe throws on non-zero exit. Surface ffmpeg's stderr if present.
    const msg = err instanceof Error ? err.message : String(err);
    // Best-effort cleanup of the half-written temp.
    try { await unlink(tmpPath); } catch { /* ignore */ }
    return {
      success: false,
      outputPath: opts.videoPath,
      audioCount: opts.audios.length,
      error: `ffmpeg mux failed: ${msg}`,
    };
  }

  await rename(tmpPath, opts.videoPath);
  return {
    success: true,
    outputPath: opts.videoPath,
    audioCount: opts.audios.length,
  };
}
