/**
 * @module _shared/footage-assemble
 *
 * The footage-cut assembler: crossfade-concatenate a scene project's generated
 * per-beat clips (`assets/video-<beat>.mp4`) into one cinematic cut, laying
 * per-beat narration at computed offsets with an optional ducked music bed —
 * all in a single FFmpeg pass, no HTML composition or browser capture.
 *
 * This is the footage-led alternative to the HyperFrames render path: provider
 * clips are the picture, so timing is derived from the real files on disk
 * (ffprobe), not from declared storyboard durations. Segments whose narration
 * outruns the clip are extended by cloning the last frame (`tpad`), which is
 * the footage equivalent of the "voice duration wins, with a floor" rule in
 * `root-sync`.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { execSafe, ffprobeDuration } from "../../utils/exec-safe.js";
import { ffmpegToolsAvailable } from "./ffmpeg-gate.js";
import { parseStoryboard } from "./storyboard-parse.js";
import { loadStoryboardMarkdown } from "./storyboard-source.js";
import type { ReviewAction } from "./review-report.js";

// ── planning (pure) ────────────────────────────────────────────────────────

export interface FootageClipInput {
  id: string;
  clipDurationSec: number;
  narrationDurationSec?: number;
}

export interface FootagePlanOptions {
  /** Crossfade length between segments (seconds). */
  transitionSec?: number;
  /** Fade-from/to-black length at the head and tail of the cut (seconds). */
  fadeSec?: number;
  /** Gap between a segment becoming dominant and its narration starting. */
  narrationLeadSec?: number;
  /** Silence required after narration ends before the segment may end. */
  narrationTailSec?: number;
}

export interface FootageBeatPlan {
  id: string;
  clipDurationSec: number;
  narrationDurationSec?: number;
  /** Segment length on the timeline (clip, possibly tpad-extended). */
  segmentDurationSec: number;
  /** Seconds of last-frame clone added so narration + tail fit. 0 = untouched. */
  extendedSec: number;
  /** Timeline position where this segment (and its incoming crossfade) starts. */
  startSec: number;
  /** Timeline position where this segment's narration starts (when present). */
  narrationStartSec?: number;
}

export interface FootageTimelinePlan {
  beats: FootageBeatPlan[];
  transitionSec: number;
  fadeSec: number;
  totalDurationSec: number;
  warnings: string[];
}

export const FOOTAGE_DEFAULTS = {
  transitionSec: 0.5,
  fadeSec: 0.6,
  narrationLeadSec: 0.35,
  narrationTailSec: 0.4,
  width: 1920,
  height: 1080,
  fps: 30,
  crf: 18,
  finishCrf: 23,
  musicVolume: 0.35,
  duck: { thresholdDb: -30, ratio: 3, attackMs: 20, releaseMs: 200 },
  /**
   * The cinematic finish pass: subtle vignette + temporal film grain, applied
   * before the head/tail fades. These are the field-tested values that pull
   * provider clips away from the too-clean "AI look"; the fades multiply over
   * them so blacks stay black.
   */
  finish: ["vignette=angle=PI/5", "noise=alls=7:allf=t"],
  /** Base segment length for a ken-burns keyframe fallback (no clip to probe). */
  kenburnsSec: 4,
  /** Slow-push ceiling for the ken-burns zoom. */
  kenburnsMaxZoom: 1.1,
} as const;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Compute segment lengths and timeline offsets from real clip/narration
 * durations. Deterministic and side-effect free so agents can reason about the
 * cut from the report alone.
 *
 * Timeline model: segment i starts at `start_i = start_{i-1} + seg_{i-1} - T`
 * (each crossfade overlaps T seconds), so the xfade filter offset for join i
 * is exactly `start_i`. When clips are too short to host the requested
 * transition, T is clamped (with a warning) instead of failing the run.
 */
export function planFootageTimeline(
  inputs: FootageClipInput[],
  opts: FootagePlanOptions = {}
): FootageTimelinePlan {
  if (inputs.length === 0) {
    throw new Error("No clips to assemble.");
  }
  const fadeSec = opts.fadeSec ?? FOOTAGE_DEFAULTS.fadeSec;
  const narrationLeadSec = opts.narrationLeadSec ?? FOOTAGE_DEFAULTS.narrationLeadSec;
  const narrationTailSec = opts.narrationTailSec ?? FOOTAGE_DEFAULTS.narrationTailSec;
  const warnings: string[] = [];

  // A transition consumes T seconds at both ends of a segment; every clip must
  // keep some of its own frames on screen, so cap T at half the shortest clip.
  let transitionSec = opts.transitionSec ?? FOOTAGE_DEFAULTS.transitionSec;
  if (inputs.length > 1) {
    const shortest = Math.min(...inputs.map((c) => c.clipDurationSec));
    const maxTransition = round3(Math.max(0, shortest / 2 - 0.05));
    if (transitionSec > maxTransition) {
      warnings.push(
        `Transition ${transitionSec}s exceeds half the shortest clip (${shortest}s); clamped to ${maxTransition}s.`
      );
      transitionSec = maxTransition;
    }
  }

  const beats: FootageBeatPlan[] = [];
  let cursor = 0;
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const isFirst = i === 0;
    const isLast = i === inputs.length - 1;
    const startSec = round3(cursor);

    // Narration starts once the incoming crossfade has (mostly) resolved.
    const inSegmentOffset = (isFirst ? 0 : transitionSec / 2) + narrationLeadSec;
    let segmentDurationSec = input.clipDurationSec;
    let narrationStartSec: number | undefined;
    if (input.narrationDurationSec !== undefined) {
      narrationStartSec = round3(startSec + inSegmentOffset);
      const tail = isLast ? Math.max(narrationTailSec, fadeSec) : narrationTailSec;
      const required = inSegmentOffset + input.narrationDurationSec + tail;
      segmentDurationSec = Math.max(segmentDurationSec, required);
    }
    segmentDurationSec = round3(segmentDurationSec);
    const extendedSec = round3(segmentDurationSec - input.clipDurationSec);
    if (extendedSec > 0) {
      warnings.push(
        `Beat "${input.id}": narration outruns the clip; last frame held for ${extendedSec}s.`
      );
    }

    beats.push({
      id: input.id,
      clipDurationSec: input.clipDurationSec,
      narrationDurationSec: input.narrationDurationSec,
      segmentDurationSec,
      extendedSec,
      startSec,
      narrationStartSec,
    });
    cursor = startSec + segmentDurationSec - (isLast ? 0 : transitionSec);
  }

  return {
    beats,
    transitionSec,
    fadeSec,
    totalDurationSec: round3(cursor),
    warnings,
  };
}

// ── ffmpeg args (pure) ─────────────────────────────────────────────────────

/** One visual source per beat: a generated clip, or a keyframe still to ken-burns. */
export interface FootageSource {
  /** Absolute path to the clip (video) or keyframe still (image). */
  path: string;
  kind: "video" | "image";
}

export interface FootageAssembleArgsOptions {
  /** Visual sources in beat order (parallel to `plan.beats`). */
  sources: FootageSource[];
  plan: FootageTimelinePlan;
  /** Absolute narration paths keyed by beat index (sparse — not every beat narrates). */
  narrationPaths: ReadonlyMap<number, string>;
  /** Absolute music-bed path; looped and ducked under narration when present. */
  musicPath?: string;
  outputPath: string;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  musicVolume?: number;
  /** Apply the cinematic finish pass (vignette + film grain) before the fades. */
  finish?: boolean;
}

/**
 * Build the single-pass FFmpeg invocation: normalize every clip to one
 * geometry/fps, xfade-chain them at the planned offsets, fade the head and
 * tail, and mix narration (adelay per beat) over an optional looped,
 * sidechain-ducked music bed.
 */
export function buildFootageAssembleArgs(opts: FootageAssembleArgsOptions): string[] {
  const { plan, sources, narrationPaths, musicPath, outputPath } = opts;
  const width = opts.width ?? FOOTAGE_DEFAULTS.width;
  const height = opts.height ?? FOOTAGE_DEFAULTS.height;
  const fps = opts.fps ?? FOOTAGE_DEFAULTS.fps;
  // Temporal grain is pure entropy to x264 — at crf 18 it inflates the file
  // ~15x. The grain itself masks compression, so a softer crf keeps the look
  // at a deliverable size.
  const crf = opts.crf ?? (opts.finish ? FOOTAGE_DEFAULTS.finishCrf : FOOTAGE_DEFAULTS.crf);
  const musicVolume = opts.musicVolume ?? FOOTAGE_DEFAULTS.musicVolume;
  const total = plan.totalDurationSec;
  const fade = plan.fadeSec;

  const args: string[] = ["-y"];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (source.kind === "image") {
      // A looped still becomes this beat's segment; zoompan animates it below.
      args.push(
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-t",
        String(plan.beats[i].segmentDurationSec),
        "-i",
        source.path
      );
    } else {
      args.push("-i", source.path);
    }
  }
  const narrationEntries = [...narrationPaths.entries()].sort(([a], [b]) => a - b);
  const narrationInputIndex = new Map<number, number>();
  for (const [beatIndex, path] of narrationEntries) {
    narrationInputIndex.set(beatIndex, sources.length + narrationInputIndex.size);
    args.push("-i", path);
  }
  let musicInputIndex: number | undefined;
  if (musicPath) {
    musicInputIndex = sources.length + narrationInputIndex.size;
    args.push("-stream_loop", "-1", "-i", musicPath);
  }

  const filters: string[] = [];

  // Video: normalize each source, extend where the plan says so, xfade-chain.
  for (let i = 0; i < sources.length; i++) {
    const seg = plan.beats[i].segmentDurationSec;
    if (sources[i].kind === "image") {
      // Ken-burns slow push: upsample 2x (zoompan jitters at 1:1), crop to the
      // target aspect, then zoom toward the ceiling over the full segment.
      const rate = round6((FOOTAGE_DEFAULTS.kenburnsMaxZoom - 1) / Math.max(1, seg * fps));
      filters.push(
        `[${i}:v]scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,` +
          `crop=${width * 2}:${height * 2},` +
          `zoompan=z='min(pzoom+${rate},${FOOTAGE_DEFAULTS.kenburnsMaxZoom})':` +
          `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},` +
          `setsar=1,settb=AVTB,format=yuv420p[v${i}]`
      );
      continue;
    }
    const extend = plan.beats[i].extendedSec;
    const tpad = extend > 0 ? `,tpad=stop_mode=clone:stop_duration=${extend}` : "";
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},setsar=1,fps=${fps},settb=AVTB,format=yuv420p${tpad}[v${i}]`
    );
  }
  let videoLabel = "[v0]";
  for (let i = 1; i < sources.length; i++) {
    const out = `[vx${i}]`;
    filters.push(
      `${videoLabel}[v${i}]xfade=transition=fade:duration=${plan.transitionSec}:` +
        `offset=${plan.beats[i].startSec}${out}`
    );
    videoLabel = out;
  }
  const finishChain = opts.finish ? `${FOOTAGE_DEFAULTS.finish.join(",")},` : "";
  filters.push(
    `${videoLabel}${finishChain}fade=t=in:st=0:d=${fade},` +
      `fade=t=out:st=${round3(Math.max(0, total - fade))}:d=${fade}[vout]`
  );

  // Audio: narration mix (delayed per beat) over an optional ducked music bed.
  let audioLabel: string | undefined;
  if (narrationInputIndex.size > 0) {
    const delayed: string[] = [];
    for (const [beatIndex, inputIndex] of narrationInputIndex) {
      const ms = Math.round((plan.beats[beatIndex].narrationStartSec ?? 0) * 1000);
      const label = `[nd${beatIndex}]`;
      filters.push(`[${inputIndex}:a]adelay=${ms}:all=1${label}`);
      delayed.push(label);
    }
    if (delayed.length === 1) {
      filters.push(`${delayed[0]}anull[nar]`);
    } else {
      filters.push(`${delayed.join("")}amix=inputs=${delayed.length}:normalize=0[nar]`);
    }
    audioLabel = "[nar]";
  }
  if (musicInputIndex !== undefined) {
    filters.push(
      `[${musicInputIndex}:a]atrim=0:${total},asetpts=PTS-STARTPTS,volume=${musicVolume}[mb]`
    );
    if (audioLabel) {
      const { thresholdDb, ratio, attackMs, releaseMs } = FOOTAGE_DEFAULTS.duck;
      const thresholdLinear = round3(Math.pow(10, thresholdDb / 20));
      filters.push(
        `${audioLabel}asplit=2[narA][narSC]`,
        `[mb][narSC]sidechaincompress=threshold=${thresholdLinear}:ratio=${ratio}:` +
          `attack=${attackMs}:release=${releaseMs}[mduck]`,
        `[mduck][narA]amix=inputs=2:normalize=0[mix]`
      );
      audioLabel = "[mix]";
    } else {
      audioLabel = "[mb]";
    }
  }
  if (audioLabel) {
    filters.push(
      `${audioLabel}apad,atrim=0:${total},` +
        `afade=t=out:st=${round3(Math.max(0, total - fade))}:d=${fade}[aout]`
    );
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (audioLabel) {
    args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-t",
    String(total),
    outputPath
  );
  return args;
}

// ── executor ───────────────────────────────────────────────────────────────

export interface FootageAssembleOptions {
  projectDir: string;
  /** Output path (relative paths resolve against projectDir). Default: renders/footage.mp4. */
  output?: string;
  transitionSec?: number;
  fadeSec?: number;
  /**
   * Music bed: an explicit path, `"none"` to disable, or undefined to
   * auto-detect `assets/music.mp3|wav` then `assets/music-<firstBeat>.mp3|wav`.
   */
  music?: string;
  musicVolume?: number;
  /** Apply the cinematic finish pass (vignette + film grain). */
  finish?: boolean;
  dryRun?: boolean;
}

export interface FootageAssembleReport {
  schemaVersion: "1";
  kind: "footage-assemble";
  project: string;
  output: string;
  totalDurationSec: number;
  transitionSec: number;
  fadeSec: number;
  beats: Array<
    FootageBeatPlan & {
      /** The visual source file (generated clip, or keyframe still on fallback). */
      clip: string;
      /** How the segment was produced. */
      source: "clip" | "keyframe-kenburns";
      narration?: string;
    }
  >;
  music: { path: string; source: "flag" | "auto"; volume: number; ducked: boolean } | null;
  /** The finish filters applied before the fades, or null when skipped. */
  finish: { filters: string[] } | null;
  warnings: string[];
  nextActions: ReviewAction[];
}

export interface FootageAssembleResult {
  success: boolean;
  dryRun: boolean;
  outputPath: string;
  reportPath?: string;
  report?: FootageAssembleReport;
  error?: string;
  suggestion?: string;
}

const DEFAULT_FOOTAGE_OUTPUT = "renders/footage.mp4";

/**
 * Assemble a scene project's generated clips into the footage cut. Probes real
 * durations, plans the timeline, runs one FFmpeg pass, and writes
 * `assemble-report.json` so the driving agent can read the cut's anatomy
 * (offsets, extensions, clamps) without watching the video.
 */
export async function executeFootageAssemble(
  opts: FootageAssembleOptions
): Promise<FootageAssembleResult> {
  const projectDir = resolve(opts.projectDir);
  const outputRel = opts.output ?? DEFAULT_FOOTAGE_OUTPUT;
  const outputPath = isAbsolute(outputRel) ? outputRel : resolve(projectDir, outputRel);

  if (!ffmpegToolsAvailable()) {
    return {
      success: false,
      dryRun: Boolean(opts.dryRun),
      outputPath,
      error: "FFmpeg toolchain (ffmpeg + ffprobe) not found in PATH.",
      suggestion: "Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux).",
    };
  }

  let beats;
  try {
    const md = await loadStoryboardMarkdown(projectDir);
    beats = parseStoryboard(md).beats;
  } catch (err) {
    return {
      success: false,
      dryRun: Boolean(opts.dryRun),
      outputPath,
      error: err instanceof Error ? err.message : String(err),
      suggestion: "Run inside a vibe scene project (needs STORYBOARD.md / scenes/).",
    };
  }
  if (beats.length === 0) {
    return {
      success: false,
      dryRun: Boolean(opts.dryRun),
      outputPath,
      error: "STORYBOARD.md has no beats to assemble.",
    };
  }

  // Source resolution per beat: generated clip, else ken-burns the keyframe
  // still (a failed or skipped clip must not sink the whole unattended cut).
  const missing: string[] = [];
  const sourceRels: Array<{ rel: string; kind: "video" | "image" }> = [];
  const kenburnsBeatIds: string[] = [];
  for (const beat of beats) {
    const clipRel = `assets/video-${beat.id}.mp4`;
    if (existsSync(join(projectDir, clipRel))) {
      sourceRels.push({ rel: clipRel, kind: "video" });
      continue;
    }
    const keyframeRel = `assets/keyframe-${beat.id}.png`;
    if (existsSync(join(projectDir, keyframeRel))) {
      sourceRels.push({ rel: keyframeRel, kind: "image" });
      kenburnsBeatIds.push(beat.id);
      continue;
    }
    missing.push(`${beat.id} (${clipRel})`);
    sourceRels.push({ rel: clipRel, kind: "video" });
  }
  if (missing.length > 0) {
    return {
      success: false,
      dryRun: Boolean(opts.dryRun),
      outputPath,
      error: `No clip or keyframe for beat(s): ${missing.join(", ")}.`,
      suggestion: `Generate them first: vibe build ${projectDir} --stage assets --json`,
    };
  }

  const narrationRels = new Map<number, string>();
  for (let i = 0; i < beats.length; i++) {
    const rel = ["mp3", "wav"]
      .map((ext) => `assets/narration-${beats[i].id}.${ext}`)
      .find((r) => existsSync(join(projectDir, r)));
    if (rel) narrationRels.set(i, rel);
  }

  const music = resolveMusicBed(projectDir, beats[0]?.id, opts.music);
  if (!music.ok) {
    return {
      success: false,
      dryRun: Boolean(opts.dryRun),
      outputPath,
      error: music.error,
    };
  }

  const inputs: FootageClipInput[] = [];
  for (let i = 0; i < beats.length; i++) {
    // Ken-burns segments have no file duration to probe: use the declared beat
    // duration (the narration floor still extends them like any clip).
    const clipDurationSec =
      sourceRels[i].kind === "image"
        ? (beats[i].duration ?? FOOTAGE_DEFAULTS.kenburnsSec)
        : round3(await ffprobeDuration(join(projectDir, sourceRels[i].rel)));
    const narrationRel = narrationRels.get(i);
    const narrationDurationSec = narrationRel
      ? round3(await ffprobeDuration(join(projectDir, narrationRel)))
      : undefined;
    inputs.push({ id: beats[i].id, clipDurationSec, narrationDurationSec });
  }

  const plan = planFootageTimeline(inputs, {
    transitionSec: opts.transitionSec,
    fadeSec: opts.fadeSec,
  });

  const musicVolume = opts.musicVolume ?? FOOTAGE_DEFAULTS.musicVolume;
  const report: FootageAssembleReport = {
    schemaVersion: "1",
    kind: "footage-assemble",
    project: projectDir,
    output: outputPath,
    totalDurationSec: plan.totalDurationSec,
    transitionSec: plan.transitionSec,
    fadeSec: plan.fadeSec,
    beats: plan.beats.map((b, i) => ({
      ...b,
      clip: sourceRels[i].rel,
      source: sourceRels[i].kind === "image" ? ("keyframe-kenburns" as const) : ("clip" as const),
      narration: narrationRels.get(i),
    })),
    music: music.rel
      ? {
          path: music.rel,
          source: music.source,
          volume: musicVolume,
          ducked: narrationRels.size > 0,
        }
      : null,
    finish: opts.finish ? { filters: [...FOOTAGE_DEFAULTS.finish] } : null,
    warnings: [
      ...plan.warnings,
      ...kenburnsBeatIds.map(
        (id) => `Beat "${id}": no generated clip; keyframe ken-burns fallback used.`
      ),
    ],
    nextActions: [
      {
        id: "inspect-footage-cut",
        kind: "command",
        label: "Inspect the assembled cut",
        command: `vibe inspect render ${outputPath} --cheap --json`,
        fixOwner: "vibe",
        costTier: "free",
        safeToAutoRun: true,
        requiresConfirmation: false,
        reason: "Verify duration, black frames, and audio coverage without watching the video.",
      },
      ...kenburnsBeatIds.map((id) => ({
        id: `regenerate-clip-${id}`,
        kind: "command" as const,
        label: `Regenerate the missing clip for beat "${id}"`,
        command: `vibe build ${projectDir} --beat ${id} --stage assets --force --json`,
        fixOwner: "vibe" as const,
        costTier: "very-high" as const,
        safeToAutoRun: false,
        requiresConfirmation: true,
        reason: `Beat "${id}" shipped as a ken-burns still; regenerating the clip restores real motion.`,
      })),
    ],
  };

  if (opts.dryRun) {
    return { success: true, dryRun: true, outputPath, report };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const args = buildFootageAssembleArgs({
    sources: sourceRels.map((s) => ({ path: join(projectDir, s.rel), kind: s.kind })),
    plan,
    narrationPaths: new Map(
      [...narrationRels.entries()].map(([i, rel]) => [i, join(projectDir, rel)])
    ),
    musicPath: music.rel
      ? isAbsolute(music.rel)
        ? music.rel
        : join(projectDir, music.rel)
      : undefined,
    outputPath,
    musicVolume,
    finish: opts.finish,
  });
  try {
    await execSafe("ffmpeg", args, { timeout: 600_000 });
  } catch (err) {
    return {
      success: false,
      dryRun: false,
      outputPath,
      report,
      error: `FFmpeg assembly failed: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: "Re-run with --dry-run --json to inspect the planned timeline.",
    };
  }

  const reportPath = join(projectDir, "assemble-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  return { success: true, dryRun: false, outputPath, reportPath, report };
}

type MusicResolution =
  | { ok: true; rel?: string; source: "flag" | "auto" }
  | { ok: false; error: string };

function resolveMusicBed(
  projectDir: string,
  firstBeatId: string | undefined,
  flag: string | undefined
): MusicResolution {
  if (flag === "none") return { ok: true, source: "flag" };
  if (flag) {
    const abs = isAbsolute(flag) ? flag : join(projectDir, flag);
    if (!existsSync(abs)) return { ok: false, error: `Music file not found: ${abs}` };
    return { ok: true, rel: flag, source: "flag" };
  }
  const candidates = ["assets/music.mp3", "assets/music.wav"];
  if (firstBeatId) {
    candidates.push(`assets/music-${firstBeatId}.mp3`, `assets/music-${firstBeatId}.wav`);
  }
  const rel = candidates.find((r) => existsSync(join(projectDir, r)));
  return { ok: true, rel, source: "auto" };
}
