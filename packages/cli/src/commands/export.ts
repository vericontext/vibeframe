import { Command } from "commander";
import { readFile, access, stat } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import { execSafe, ffprobeDuration } from "../utils/exec-safe.js";

/**
 * Resolve project file path - handles both file paths and directory paths
 * If path is a directory, looks for project.vibe.json inside
 */
async function resolveProjectPath(inputPath: string): Promise<string> {
  const filePath = resolve(process.cwd(), inputPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist or other error - let readFile handle it
  }

  return filePath;
}

/**
 * Get the duration of a media file using ffprobe
 * For images, returns a default duration since they have no inherent time
 */
export async function getMediaDuration(
  filePath: string,
  mediaType: "video" | "audio" | "image",
  defaultImageDuration: number = 5
): Promise<number> {
  if (mediaType === "image") {
    return defaultImageDuration;
  }

  try {
    return await ffprobeDuration(filePath);
  } catch {
    return defaultImageDuration;
  }
}

/**
 * Check if a media file has an audio stream
 */
export async function checkHasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execSafe("ffprobe", [
      "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Export result for programmatic usage
 */
export interface ExportResult {
  success: boolean;
  message: string;
  outputPath?: string;
}

/**
 * Gap filling strategy for timeline gaps
 * - "black": Fill gaps with black frames (fallback)
 * - "extend": Extend adjacent clips using source media if available
 */
export type GapFillStrategy = "black" | "extend";

/**
 * Export options
 */
export interface ExportOptions {
  preset?: "draft" | "standard" | "high" | "ultra";
  format?: "mp4" | "webm" | "mov";
  overwrite?: boolean;
  gapFill?: GapFillStrategy;
}

/**
 * Reusable export function for programmatic usage
 */
export async function runExport(
  projectPath: string,
  outputPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const { preset = "standard", format = "mp4", overwrite = false, gapFill = "extend" } = options;

  try {
    // Check if FFmpeg is installed
    const ffmpegPath = await findFFmpeg();
    if (!ffmpegPath) {
      return {
        success: false,
        message: "FFmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
      };
    }

    // Load project
    const filePath = await resolveProjectPath(projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const summary = project.getSummary();

    if (summary.clipCount === 0) {
      return {
        success: false,
        message: "Project has no clips to export",
      };
    }

    // Determine output path
    const finalOutputPath = resolve(process.cwd(), outputPath);

    // Get preset settings
    const presetSettings = getPresetSettings(preset, summary.aspectRatio);

    // Get clips sorted by start time
    const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
    const sources = project.getSources();

    // Verify source files exist and check for audio streams
    const sourceAudioMap = new Map<string, boolean>();
    for (const clip of clips) {
      const source = sources.find((s) => s.id === clip.sourceId);
      if (source) {
        try {
          await access(source.url);
          // Check if video source has audio
          if (source.type === "video" && !sourceAudioMap.has(source.id)) {
            sourceAudioMap.set(source.id, await checkHasAudio(source.url));
          }
        } catch {
          return {
            success: false,
            message: `Source file not found: ${source.url}`,
          };
        }
      }
    }

    // Build FFmpeg command
    const ffmpegArgs = buildFFmpegArgs(clips, sources, presetSettings, finalOutputPath, { overwrite, format, gapFill }, sourceAudioMap);

    // Run FFmpeg
    await runFFmpegProcess(ffmpegPath, ffmpegArgs, () => {});

    return {
      success: true,
      message: `Exported: ${outputPath}`,
      outputPath: finalOutputPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Export failed: ${errorMessage}`,
    };
  }
}

export const exportCommand = new Command("export")
  .description("Export project to video file")
  .argument("<project>", "Project file path")
  .option("-o, --output <path>", "Output file path")
  .option("-f, --format <format>", "Output format (mp4, webm, mov)", "mp4")
  .option(
    "-p, --preset <preset>",
    "Quality preset (draft, standard, high, ultra)",
    "standard"
  )
  .option("-y, --overwrite", "Overwrite output file if exists", false)
  .option("-g, --gap-fill <strategy>", "Gap filling strategy (black, extend)", "extend")
  .action(async (projectPath: string, options) => {
    const spinner = ora("Checking FFmpeg...").start();

    try {
      // Check if FFmpeg is installed
      const ffmpegPath = await findFFmpeg();
      if (!ffmpegPath) {
        spinner.fail(chalk.red("FFmpeg not found"));
        console.error();
        console.error(chalk.yellow("Please install FFmpeg:"));
        console.error(chalk.dim("  macOS:   brew install ffmpeg"));
        console.error(chalk.dim("  Ubuntu:  sudo apt install ffmpeg"));
        console.error(chalk.dim("  Windows: winget install ffmpeg"));
        process.exit(1);
      }

      // Load project
      spinner.text = "Loading project...";
      const filePath = await resolveProjectPath(projectPath);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const summary = project.getSummary();

      if (summary.clipCount === 0) {
        spinner.fail(chalk.red("Project has no clips to export"));
        process.exit(1);
      }

      // Determine output path
      const outputPath = options.output
        ? resolve(process.cwd(), options.output)
        : resolve(
            process.cwd(),
            `${basename(projectPath, ".vibe.json")}.${options.format}`
          );

      // Get preset settings
      const presetSettings = getPresetSettings(options.preset, summary.aspectRatio);

      // Get clips sorted by start time
      const clips = project.getClips().sort((a, b) => a.startTime - b.startTime);
      const sources = project.getSources();

      // Verify source files exist and check for audio streams
      spinner.text = "Verifying source files...";
      const sourceAudioMap = new Map<string, boolean>();
      for (const clip of clips) {
        const source = sources.find((s) => s.id === clip.sourceId);
        if (source) {
          try {
            await access(source.url);
            // Check if video source has audio
            if (source.type === "video" && !sourceAudioMap.has(source.id)) {
              sourceAudioMap.set(source.id, await checkHasAudio(source.url));
            }
          } catch {
            spinner.fail(chalk.red(`Source file not found: ${source.url}`));
            process.exit(1);
          }
        }
      }

      // Build FFmpeg command
      spinner.text = "Building export command...";
      const gapFillStrategy = (options.gapFill === "black" ? "black" : "extend") as GapFillStrategy;
      const ffmpegArgs = buildFFmpegArgs(clips, sources, presetSettings, outputPath, { ...options, gapFill: gapFillStrategy }, sourceAudioMap);

      if (process.env.DEBUG) {
        console.log("\nFFmpeg command:");
        console.log("ffmpeg", ffmpegArgs.join(" "));
        console.log();
      }

      // Run FFmpeg
      spinner.text = "Encoding...";

      await runFFmpegProcess(ffmpegPath, ffmpegArgs, (progress) => {
        spinner.text = `Encoding... ${progress}%`;
      });

      spinner.succeed(chalk.green(`Exported: ${outputPath}`));

      console.log();
      console.log(chalk.dim("  Duration:"), `${summary.duration.toFixed(1)}s`);
      console.log(chalk.dim("  Clips:"), summary.clipCount);
      console.log(chalk.dim("  Format:"), options.format);
      console.log(chalk.dim("  Preset:"), options.preset);
      console.log(chalk.dim("  Resolution:"), presetSettings.resolution);
      console.log();
    } catch (error) {
      spinner.fail(chalk.red("Export failed"));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  });

/**
 * Find FFmpeg executable
 */
async function findFFmpeg(): Promise<string | null> {
  try {
    const { stdout } = await execSafe("which", ["ffmpeg"]);
    return stdout.trim().split("\n")[0];
  } catch {
    try {
      const { stdout } = await execSafe("where", ["ffmpeg"]);
      return stdout.trim().split("\n")[0];
    } catch {
      return null;
    }
  }
}

/**
 * Detect gaps in timeline between clips
 * Returns array of gaps with start and end times
 */
function detectTimelineGaps(
  clips: Array<{ startTime: number; duration: number }>,
  totalDuration?: number
): Array<{ start: number; end: number }> {
  if (clips.length === 0) return [];

  const gaps: Array<{ start: number; end: number }> = [];
  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

  // Check for gap at the start (first clip doesn't start at 0)
  if (sortedClips[0].startTime > 0.001) {
    gaps.push({ start: 0, end: sortedClips[0].startTime });
  }

  // Check for gaps between clips
  for (let i = 0; i < sortedClips.length - 1; i++) {
    const clipEnd = sortedClips[i].startTime + sortedClips[i].duration;
    const nextStart = sortedClips[i + 1].startTime;
    // Allow small tolerance for floating point errors
    if (nextStart > clipEnd + 0.001) {
      gaps.push({ start: clipEnd, end: nextStart });
    }
  }

  // Check for gap at the end if totalDuration is provided
  if (totalDuration !== undefined) {
    const lastClip = sortedClips[sortedClips.length - 1];
    const lastClipEnd = lastClip.startTime + lastClip.duration;
    if (totalDuration > lastClipEnd + 0.001) {
      gaps.push({ start: lastClipEnd, end: totalDuration });
    }
  }

  return gaps;
}

/**
 * Gap fill plan for a single gap
 */
interface GapFillPlan {
  gap: { start: number; end: number };
  fills: Array<{
    type: "extend-before" | "extend-after" | "black";
    sourceId?: string;
    sourceUrl?: string;
    start: number;
    end: number;
    sourceStart?: number;
    sourceEnd?: number;
  }>;
}

/**
 * Create gap fill plans by extending adjacent clips
 * Priority:
 * 1. Extend clip AFTER the gap backwards (if sourceStartOffset > 0)
 * 2. Extend clip BEFORE the gap forwards (if source has unused duration)
 * 3. Fallback to black frames
 */
function createGapFillPlans(
  gaps: Array<{ start: number; end: number }>,
  clips: Array<{ startTime: number; duration: number; sourceId: string; sourceStartOffset: number; sourceEndOffset: number }>,
  sources: Array<{ id: string; url: string; type: string; duration: number }>
): GapFillPlan[] {
  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

  return gaps.map((gap) => {
    const gapDuration = gap.end - gap.start;
    const fills: GapFillPlan["fills"] = [];
    let remainingStart = gap.start;
    let remainingEnd = gap.end;

    // Find clip AFTER the gap (for extending backwards)
    const clipAfter = sortedClips.find((c) => Math.abs(c.startTime - gap.end) < 0.01);

    // Find clip BEFORE the gap (for extending forwards)
    const clipBefore = sortedClips.find((c) => Math.abs((c.startTime + c.duration) - gap.start) < 0.01);

    // Try extending clip after the gap backwards first
    if (clipAfter && clipAfter.sourceStartOffset > 0.01) {
      const source = sources.find((s) => s.id === clipAfter.sourceId);
      if (source && source.type === "video") {
        const availableExtension = clipAfter.sourceStartOffset;
        const extensionDuration = Math.min(availableExtension, remainingEnd - remainingStart);

        if (extensionDuration > 0.01) {
          // Extend from the gap end backwards
          const fillStart = remainingEnd - extensionDuration;
          const sourceStart = clipAfter.sourceStartOffset - extensionDuration;
          const sourceEnd = clipAfter.sourceStartOffset;

          fills.push({
            type: "extend-after",
            sourceId: source.id,
            sourceUrl: source.url,
            start: fillStart,
            end: remainingEnd,
            sourceStart,
            sourceEnd,
          });

          remainingEnd = fillStart;
        }
      }
    }

    // If there's still a gap, try extending clip before the gap forwards
    if (remainingEnd - remainingStart > 0.01 && clipBefore) {
      const source = sources.find((s) => s.id === clipBefore.sourceId);
      if (source && source.type === "video") {
        const usedEndInSource = clipBefore.sourceEndOffset;
        const availableExtension = source.duration - usedEndInSource;

        if (availableExtension > 0.01) {
          const extensionDuration = Math.min(availableExtension, remainingEnd - remainingStart);

          if (extensionDuration > 0.01) {
            const sourceStart = usedEndInSource;
            const sourceEnd = usedEndInSource + extensionDuration;

            fills.push({
              type: "extend-before",
              sourceId: source.id,
              sourceUrl: source.url,
              start: remainingStart,
              end: remainingStart + extensionDuration,
              sourceStart,
              sourceEnd,
            });

            remainingStart = remainingStart + extensionDuration;
          }
        }
      }
    }

    // Fill any remaining gap with black
    if (remainingEnd - remainingStart > 0.01) {
      fills.push({
        type: "black",
        start: remainingStart,
        end: remainingEnd,
      });
    }

    return { gap, fills };
  });
}

/**
 * Build FFmpeg arguments for export
 */
function buildFFmpegArgs(
  clips: ReturnType<Project["getClips"]>,
  sources: ReturnType<Project["getSources"]>,
  presetSettings: PresetSettings,
  outputPath: string,
  options: { overwrite?: boolean; format?: string; gapFill?: GapFillStrategy },
  sourceAudioMap: Map<string, boolean> = new Map()
): string[] {
  const args: string[] = [];

  // Overwrite flag first
  if (options.overwrite) {
    args.push("-y");
  }

  // Add input files
  const sourceMap = new Map<string, number>();
  let inputIndex = 0;

  for (const clip of clips) {
    const source = sources.find((s) => s.id === clip.sourceId);
    if (source && !sourceMap.has(source.id)) {
      // Add -loop 1 before image inputs to create a continuous video stream
      if (source.type === "image") {
        args.push("-loop", "1");
      }
      args.push("-i", source.url);
      sourceMap.set(source.id, inputIndex);
      inputIndex++;
    }
  }

  // Build filter complex
  const filterParts: string[] = [];

  // Separate clips by track type for proper timeline-based export
  // Get track info to determine clip types
  const videoClips = clips.filter((clip) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    return source && (source.type === "image" || source.type === "video");
  }).sort((a, b) => a.startTime - b.startTime);

  // Include audio clips from:
  // 1. Explicit audio sources (narration, music)
  // 2. Video sources when there are NO separate audio clips (e.g., highlight reels)
  const explicitAudioClips = clips.filter((clip) => {
    const source = sources.find((s) => s.id === clip.sourceId);
    return source && source.type === "audio";
  }).sort((a, b) => a.startTime - b.startTime);

  // If no explicit audio clips, extract audio from video clips
  const audioClips = explicitAudioClips.length > 0
    ? explicitAudioClips
    : clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return source && source.type === "video";
      }).sort((a, b) => a.startTime - b.startTime);

  // Get target resolution for scaling (all clips must match for concat)
  const [targetWidth, targetHeight] = presetSettings.resolution.split("x").map(Number);

  // Detect gaps in video timeline
  // For totalDuration, use the longest audio clip end time if explicit audio exists
  // (audio is usually the reference for timing in b-roll scenarios)
  let totalDuration: number | undefined;
  if (explicitAudioClips.length > 0) {
    const audioEnd = Math.max(...explicitAudioClips.map(c => c.startTime + c.duration));
    totalDuration = audioEnd;
  }
  const videoGaps = detectTimelineGaps(videoClips, totalDuration);

  // Create gap fill plans based on strategy
  const gapFillStrategy = options.gapFill || "extend";
  const gapFillPlans = gapFillStrategy === "extend"
    ? createGapFillPlans(videoGaps, videoClips, sources)
    : videoGaps.map((gap) => ({
        gap,
        fills: [{ type: "black" as const, start: gap.start, end: gap.end }],
      }));

  // Build ordered list of video segments (clips and gap fills interleaved)
  interface VideoSegment {
    type: 'clip' | 'extended' | 'black';
    clip?: typeof videoClips[0];
    sourceId?: string;
    sourceUrl?: string;
    startTime: number;
    duration?: number;
    sourceStart?: number;
    sourceEnd?: number;
  }
  const videoSegments: VideoSegment[] = [];

  // Add video clips as segments
  for (const clip of videoClips) {
    videoSegments.push({ type: 'clip', clip, startTime: clip.startTime });
  }

  // Add gap fills as segments (from gap fill plans)
  for (const plan of gapFillPlans) {
    for (const fill of plan.fills) {
      if (fill.type === "black") {
        videoSegments.push({
          type: 'black',
          startTime: fill.start,
          duration: fill.end - fill.start,
        });
      } else {
        // extend-before or extend-after
        videoSegments.push({
          type: 'extended',
          sourceId: fill.sourceId,
          sourceUrl: fill.sourceUrl,
          startTime: fill.start,
          duration: fill.end - fill.start,
          sourceStart: fill.sourceStart,
          sourceEnd: fill.sourceEnd,
        });
      }
    }
  }

  // Sort by start time
  videoSegments.sort((a, b) => a.startTime - b.startTime);

  // Process video segments (clips, extended clips, and black frames)
  const videoStreams: string[] = [];
  let videoStreamIdx = 0;

  for (const segment of videoSegments) {
    if (segment.type === 'clip' && segment.clip) {
      const clip = segment.clip;
      const source = sources.find((s) => s.id === clip.sourceId);
      if (!source) continue;

      const srcIdx = sourceMap.get(source.id);
      if (srcIdx === undefined) continue;

      // Video filter chain - images need different handling than video
      let videoFilter: string;
      if (source.type === "image") {
        // Images: trim from 0 to clip duration (no source offset since images are looped)
        videoFilter = `[${srcIdx}:v]trim=start=0:end=${clip.duration},setpts=PTS-STARTPTS`;
      } else {
        // Video: use source offsets
        const trimStart = clip.sourceStartOffset;
        const trimEnd = clip.sourceStartOffset + clip.duration;
        videoFilter = `[${srcIdx}:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS`;
      }

      // Scale to target resolution for concat compatibility (force same size, pad if needed)
      videoFilter += `,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

      // Apply effects
      for (const effect of clip.effects || []) {
        if (effect.type === "fadeIn") {
          videoFilter += `,fade=t=in:st=0:d=${effect.duration}`;
        } else if (effect.type === "fadeOut") {
          const fadeStart = clip.duration - effect.duration;
          videoFilter += `,fade=t=out:st=${fadeStart}:d=${effect.duration}`;
        }
      }

      videoFilter += `[v${videoStreamIdx}]`;
      filterParts.push(videoFilter);
      videoStreams.push(`[v${videoStreamIdx}]`);
      videoStreamIdx++;
    } else if (segment.type === 'extended' && segment.sourceId) {
      // Extended segment - use source video to fill gap
      const srcIdx = sourceMap.get(segment.sourceId);
      if (srcIdx === undefined) {
        // Fallback to black if source not found in input map
        const gapFilter = `color=c=black:s=${targetWidth}x${targetHeight}:d=${segment.duration}:r=30,format=yuv420p[v${videoStreamIdx}]`;
        filterParts.push(gapFilter);
        videoStreams.push(`[v${videoStreamIdx}]`);
        videoStreamIdx++;
        continue;
      }

      const videoFilter = `[${srcIdx}:v]trim=start=${segment.sourceStart}:end=${segment.sourceEnd},setpts=PTS-STARTPTS,scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${videoStreamIdx}]`;
      filterParts.push(videoFilter);
      videoStreams.push(`[v${videoStreamIdx}]`);
      videoStreamIdx++;
    } else if (segment.type === 'black') {
      // Generate black frame for the gap duration
      const gapFilter = `color=c=black:s=${targetWidth}x${targetHeight}:d=${segment.duration}:r=30,format=yuv420p[v${videoStreamIdx}]`;
      filterParts.push(gapFilter);
      videoStreams.push(`[v${videoStreamIdx}]`);
      videoStreamIdx++;
    }
  }

  // Detect gaps in audio timeline (use same totalDuration for consistency)
  const audioGaps = detectTimelineGaps(audioClips, totalDuration);

  // Build ordered list of audio segments
  interface AudioSegment {
    type: 'clip' | 'gap';
    clip?: typeof audioClips[0];
    gap?: { start: number; end: number };
    startTime: number;
  }
  const audioSegments: AudioSegment[] = [];

  // Add audio clips as segments
  for (const clip of audioClips) {
    audioSegments.push({ type: 'clip', clip, startTime: clip.startTime });
  }

  // Add gaps as segments
  for (const gap of audioGaps) {
    audioSegments.push({ type: 'gap', gap, startTime: gap.start });
  }

  // Sort by start time
  audioSegments.sort((a, b) => a.startTime - b.startTime);

  // Process audio segments (clips and gaps)
  const audioStreams: string[] = [];
  let audioStreamIdx = 0;

  for (const segment of audioSegments) {
    if (segment.type === 'clip' && segment.clip) {
      const clip = segment.clip;
      const source = sources.find((s) => s.id === clip.sourceId);
      if (!source) continue;

      const srcIdx = sourceMap.get(source.id);
      if (srcIdx === undefined) continue;

      // Check if source has audio (audio sources always have audio, video sources need to be checked)
      const hasAudio = source.type === "audio" || sourceAudioMap.get(source.id) === true;

      let audioFilter: string;
      if (hasAudio) {
        // Source has audio - extract and trim it
        const audioTrimStart = clip.sourceStartOffset;
        const audioTrimEnd = clip.sourceStartOffset + clip.duration;
        audioFilter = `[${srcIdx}:a]atrim=start=${audioTrimStart}:end=${audioTrimEnd},asetpts=PTS-STARTPTS`;
      } else {
        // Source has no audio - generate silence for the clip duration
        audioFilter = `anullsrc=r=48000:cl=stereo,atrim=0:${clip.duration},asetpts=PTS-STARTPTS`;
      }

      // Apply audio effects
      for (const effect of clip.effects || []) {
        if (effect.type === "fadeIn") {
          audioFilter += `,afade=t=in:st=0:d=${effect.duration}`;
        } else if (effect.type === "fadeOut") {
          const fadeStart = clip.duration - effect.duration;
          audioFilter += `,afade=t=out:st=${fadeStart}:d=${effect.duration}`;
        }
      }

      audioFilter += `[a${audioStreamIdx}]`;
      filterParts.push(audioFilter);
      audioStreams.push(`[a${audioStreamIdx}]`);
      audioStreamIdx++;
    } else if (segment.type === 'gap' && segment.gap) {
      // Generate silence for the gap duration
      const gapDuration = segment.gap.end - segment.gap.start;
      const audioGapFilter = `anullsrc=r=48000:cl=stereo,atrim=0:${gapDuration},asetpts=PTS-STARTPTS[a${audioStreamIdx}]`;
      filterParts.push(audioGapFilter);
      audioStreams.push(`[a${audioStreamIdx}]`);
      audioStreamIdx++;
    }
  }

  // Concatenate video clips
  if (videoStreams.length > 1) {
    filterParts.push(
      `${videoStreams.join("")}concat=n=${videoStreams.length}:v=1:a=0[outv]`
    );
  } else if (videoStreams.length === 1) {
    // Single video clip - just copy
    filterParts.push(`${videoStreams[0]}copy[outv]`);
  }

  // Concatenate or mix audio clips
  if (audioStreams.length > 1) {
    filterParts.push(
      `${audioStreams.join("")}concat=n=${audioStreams.length}:v=0:a=1[outa]`
    );
  } else if (audioStreams.length === 1) {
    // Single audio clip - just copy
    filterParts.push(`${audioStreams[0]}acopy[outa]`);
  }

  // Add filter complex
  args.push("-filter_complex", filterParts.join(";"));

  // Map outputs
  args.push("-map", "[outv]");
  if (audioStreams.length > 0) {
    args.push("-map", "[outa]");
  }

  // Add encoding settings
  args.push(...presetSettings.ffmpegArgs);

  // Output file
  args.push(outputPath);

  return args;
}

/**
 * Run FFmpeg with progress reporting
 */
function runFFmpegProcess(
  ffmpegPath: string,
  args: string[],
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let duration = 0;
    let stderr = "";

    ffmpeg.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;

      // Parse duration
      const durationMatch = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (durationMatch) {
        const [, hours, minutes, seconds] = durationMatch;
        duration =
          parseInt(hours) * 3600 +
          parseInt(minutes) * 60 +
          parseFloat(seconds);
      }

      // Parse progress
      const timeMatch = output.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && duration > 0) {
        const [, hours, minutes, seconds] = timeMatch;
        const currentTime =
          parseInt(hours) * 3600 +
          parseInt(minutes) * 60 +
          parseFloat(seconds);
        const percent = Math.min(100, Math.round((currentTime / duration) * 100));
        onProgress(percent);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract error message
        const errorMatch = stderr.match(/Error.*$/m);
        const errorMsg = errorMatch ? errorMatch[0] : `FFmpeg exited with code ${code}`;
        reject(new Error(errorMsg));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });
  });
}

interface PresetSettings {
  resolution: string;
  videoBitrate: string;
  audioBitrate: string;
  ffmpegArgs: string[];
}

function getPresetSettings(
  preset: string,
  aspectRatio: string
): PresetSettings {
  const presets: Record<string, PresetSettings> = {
    draft: {
      resolution: "640x360",
      videoBitrate: "1M",
      audioBitrate: "128k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
      ],
    },
    standard: {
      resolution: "1280x720",
      videoBitrate: "4M",
      audioBitrate: "192k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
      ],
    },
    high: {
      resolution: "1920x1080",
      videoBitrate: "8M",
      audioBitrate: "256k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "256k",
      ],
    },
    ultra: {
      resolution: "3840x2160",
      videoBitrate: "20M",
      audioBitrate: "320k",
      ffmpegArgs: [
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "15",
        "-c:a", "aac",
        "-b:a", "320k",
      ],
    },
  };

  // Adjust resolution for aspect ratio
  const settings = { ...presets[preset] || presets.standard };

  if (aspectRatio === "9:16") {
    // Vertical video
    const [w, h] = settings.resolution.split("x");
    settings.resolution = `${h}x${w}`;
  } else if (aspectRatio === "1:1") {
    // Square video
    const h = settings.resolution.split("x")[1];
    settings.resolution = `${h}x${h}`;
  }

  return settings;
}
