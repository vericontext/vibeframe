/**
 * @module manifest/agent-only
 * @description Tools that only make sense inside the in-process agent REPL —
 * filesystem access (`fs_*`), project-level batch operations (`batch_*`),
 * and FFmpeg-driven media wrappers (`media_*`).
 *
 * These all use `surfaces: ["agent"]` so the MCP adapter filters them out.
 * MCP clients have their own host-side filesystem affordances and would
 * never call into our handler shell anyway.
 *
 * Dependencies are deliberately limited to Node `fs` + `@vibeframe/core`
 * (Project class) + `execSafe`/`ffprobeDuration`. No AI provider SDKs —
 * adding any would balloon the mcp-server esbuild bundle even though the
 * entries never reach MCP at runtime.
 */

import { readFile, writeFile, readdir, stat, access, unlink } from "node:fs/promises";
import { resolve, join, basename, extname } from "node:path";
import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { MediaType, EffectType } from "@vibeframe/core/timeline";
import { execSafe, ffprobeDuration } from "../../utils/exec-safe.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function matchPattern(filename: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return regex.test(filename);
}

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)}${units[unit]}`;
}

function detectMediaType(filePath: string): MediaType {
  const ext = extname(filePath).toLowerCase();
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"].includes(ext)) return "audio";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) return "image";
  return "video";
}

function isMediaFile(filePath: string): boolean {
  const mediaExts = [
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
    ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ];
  return mediaExts.includes(extname(filePath).toLowerCase());
}

async function getMediaDuration(filePath: string): Promise<number> {
  try {
    return await ffprobeDuration(filePath);
  } catch {
    return 0;
  }
}

// ─── fs_* ──────────────────────────────────────────────────────────────────

export const fsListTool = defineTool({
  name: "fs_list",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "List files and directories in a path",
  schema: z.object({
    path: z.string().optional().describe("Directory path (default: current directory)"),
    pattern: z.string().optional().describe("Filter pattern (e.g., *.mp4, *.json)"),
  }),
  async execute(args, ctx) {
    const dirPath = args.path ?? ".";
    try {
      const absPath = resolve(ctx.workingDirectory, dirPath);
      const entries = await readdir(absPath, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (args.pattern && !matchPattern(entry.name, args.pattern)) continue;
        const fullPath = join(absPath, entry.name);
        const stats = await stat(fullPath);
        if (entry.isDirectory()) {
          results.push(`[DIR]  ${entry.name}/`);
        } else {
          results.push(`[FILE] ${entry.name} (${formatSize(stats.size)})`);
        }
      }
      const lines =
        results.length === 0
          ? [args.pattern ? `No files matching "${args.pattern}" in ${dirPath}` : `Directory is empty: ${dirPath}`]
          : [`Contents of ${dirPath}:`, ...results];
      return { success: true, data: { entries: results.length }, humanLines: lines };
    } catch (error) {
      return { success: false, error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

export const fsReadTool = defineTool({
  name: "fs_read",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Read contents of a text file",
  schema: z.object({
    path: z.string().describe("File path to read"),
  }),
  async execute(args, ctx) {
    try {
      const absPath = resolve(ctx.workingDirectory, args.path);
      const content = await readFile(absPath, "utf-8");
      const maxLength = 4000;
      const truncated = content.length > maxLength;
      const output = truncated ? content.substring(0, maxLength) + "\n... (truncated)" : content;
      return { success: true, data: { length: content.length, truncated }, humanLines: [`Contents of ${args.path}:`, output] };
    } catch (error) {
      return { success: false, error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

export const fsWriteTool = defineTool({
  name: "fs_write",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Write content to a file",
  schema: z.object({
    path: z.string().describe("File path to write"),
    content: z.string().describe("Content to write"),
  }),
  async execute(args, ctx) {
    try {
      const absPath = resolve(ctx.workingDirectory, args.path);
      await writeFile(absPath, args.content, "utf-8");
      return { success: true, data: { bytes: args.content.length }, humanLines: [`File written: ${args.path} (${formatSize(args.content.length)})`] };
    } catch (error) {
      return { success: false, error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

export const fsExistsTool = defineTool({
  name: "fs_exists",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Check if a file or directory exists",
  schema: z.object({
    path: z.string().describe("Path to check"),
  }),
  async execute(args, ctx) {
    const absPath = resolve(ctx.workingDirectory, args.path);
    try {
      await access(absPath);
      const stats = await stat(absPath);
      const type = stats.isDirectory() ? "directory" : "file";
      return { success: true, data: { exists: true, type }, humanLines: [`${type} exists: ${args.path}`] };
    } catch {
      return { success: true, data: { exists: false }, humanLines: [`Does not exist: ${args.path}`] };
    }
  },
});

// ─── batch_* ───────────────────────────────────────────────────────────────

export const batchImportTool = defineTool({
  name: "batch_import",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description:
    "Import multiple media files from a directory into a project. Scans directory for video, audio, and image files.",
  schema: z.object({
    project: z.string().describe("Project file path"),
    directory: z.string().describe("Directory containing media files to import"),
    recursive: z.boolean().optional().describe("Search subdirectories recursively (default: false)"),
    filter: z.string().optional().describe("Filter files by extension, comma-separated (e.g., '.mp4,.mov')"),
    imageDuration: z.number().optional().describe("Default duration for images in seconds (default: 5)"),
  }),
  async execute(args, ctx) {
    try {
      const filePath = resolve(ctx.workingDirectory, args.project);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);
      const dirPath = resolve(ctx.workingDirectory, args.directory);
      const filterExts = args.filter ? args.filter.split(",").map((e) => e.trim().toLowerCase()) : null;
      const imageDuration = args.imageDuration ?? 5;
      const recursive = args.recursive ?? false;

      const mediaFiles: string[] = [];
      const scanDir = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = join(dir, entry.name);
          if (entry.isDirectory() && recursive) {
            await scanDir(entryPath);
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            const matchesFilter = !filterExts || filterExts.includes(ext);
            if (matchesFilter && isMediaFile(entryPath)) mediaFiles.push(entryPath);
          }
        }
      };
      await scanDir(dirPath);

      if (mediaFiles.length === 0) {
        return { success: false, error: "No media files found in directory" };
      }

      mediaFiles.sort();
      const addedSources: { id: string; name: string; type: MediaType }[] = [];
      for (const mediaFile of mediaFiles) {
        const mediaName = basename(mediaFile);
        const mediaType = detectMediaType(mediaFile);
        let duration = imageDuration;
        if (mediaType !== "image") {
          const actualDuration = await getMediaDuration(mediaFile);
          if (actualDuration > 0) duration = actualDuration;
        }
        const source = project.addSource({ name: mediaName, type: mediaType, url: mediaFile, duration });
        addedSources.push({ id: source.id, name: mediaName, type: mediaType });
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      return {
        success: true,
        data: { count: addedSources.length, sources: addedSources },
        humanLines: [
          `Imported ${addedSources.length} media files:`,
          "",
          ...addedSources.map((s) => `  + ${s.name} (${s.type})`),
        ],
      };
    } catch (error) {
      return { success: false, error: `Failed to import files: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

export const batchConcatTool = defineTool({
  name: "batch_concat",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Concatenate multiple sources into sequential clips on the timeline",
  schema: z.object({
    project: z.string().describe("Project file path"),
    sourceIds: z.array(z.string()).optional().describe("Source IDs to concatenate. If empty with useAll=true, uses all sources."),
    useAll: z.boolean().optional().describe("Use all sources in the project (default: false)"),
    trackId: z.string().optional().describe("Track to place clips on (auto-selects if not specified)"),
    startTime: z.number().optional().describe("Starting time in seconds (default: 0)"),
    gap: z.number().optional().describe("Gap between clips in seconds (default: 0)"),
  }),
  async execute(args, ctx) {
    try {
      const filePath = resolve(ctx.workingDirectory, args.project);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);
      const sourceIds = args.sourceIds ?? [];
      const useAll = args.useAll ?? false;
      const startTime = args.startTime ?? 0;
      const gap = args.gap ?? 0;

      const sourcesToConcat = useAll
        ? project.getSources()
        : sourceIds.map((id) => project.getSource(id)).filter(Boolean);

      if (!sourcesToConcat || sourcesToConcat.length === 0) {
        return { success: false, error: "No sources to concatenate. Provide sourceIds or use useAll=true." };
      }

      let targetTrackId = args.trackId;
      if (!targetTrackId) {
        const firstSource = sourcesToConcat[0]!;
        const trackType = firstSource.type === "audio" ? "audio" : "video";
        const tracks = project.getTracksByType(trackType);
        if (tracks.length === 0) {
          return { success: false, error: `No ${trackType} track found. Create one first.` };
        }
        targetTrackId = tracks[0].id;
      }

      let currentTime = startTime;
      const createdClips: { id: string; sourceName: string; startTime: number; duration: number }[] = [];
      for (const source of sourcesToConcat) {
        if (!source) continue;
        const clip = project.addClip({
          sourceId: source.id,
          trackId: targetTrackId,
          startTime: currentTime,
          duration: source.duration,
          sourceStartOffset: 0,
          sourceEndOffset: source.duration,
        });
        createdClips.push({ id: clip.id, sourceName: source.name, startTime: currentTime, duration: source.duration });
        currentTime += source.duration + gap;
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const totalDuration = currentTime - gap - startTime;
      return {
        success: true,
        data: { clips: createdClips.length, totalDuration },
        humanLines: [
          `Created ${createdClips.length} clips (total: ${totalDuration.toFixed(1)}s):`,
          "",
          ...createdClips.map((c) => `  ${c.sourceName} @ ${c.startTime.toFixed(1)}s (${c.duration.toFixed(1)}s)`),
        ],
      };
    } catch (error) {
      return { success: false, error: `Failed to concatenate: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

export const batchApplyEffectTool = defineTool({
  name: "batch_apply_effect",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Apply an effect to multiple clips at once",
  schema: z.object({
    project: z.string().describe("Project file path"),
    clipIds: z.array(z.string()).optional().describe("Clip IDs to apply effect to. If empty with useAll=true, applies to all clips."),
    useAll: z.boolean().optional().describe("Apply to all clips in the project (default: false)"),
    effectType: z
      .enum(["fadeIn", "fadeOut", "blur", "brightness", "contrast", "saturation", "speed", "volume"])
      .describe("Effect type to apply"),
    duration: z.number().optional().describe("Effect duration in seconds (default: entire clip)"),
    params: z.record(z.unknown()).optional().describe("Effect-specific parameters"),
  }),
  async execute(args, ctx) {
    try {
      const filePath = resolve(ctx.workingDirectory, args.project);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);
      const clipIds = args.clipIds ?? [];
      const useAll = args.useAll ?? false;
      const rawParams = args.params ?? {};

      const targetClips = useAll
        ? project.getClips()
        : clipIds.map((id) => project.getClip(id)).filter(Boolean);

      if (!targetClips || targetClips.length === 0) {
        return { success: false, error: "No clips to apply effect to. Provide clipIds or use useAll=true." };
      }

      const params: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          params[key] = value;
        }
      }

      const appliedEffects: { clipId: string; effectId: string }[] = [];
      for (const clip of targetClips) {
        if (!clip) continue;
        const effectDuration = args.duration ?? clip.duration;
        const effect = project.addEffect(clip.id, {
          type: args.effectType as EffectType,
          startTime: 0,
          duration: effectDuration,
          params,
        });
        if (effect) appliedEffects.push({ clipId: clip.id, effectId: effect.id });
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      return {
        success: true,
        data: { applied: appliedEffects.length, effectType: args.effectType },
        humanLines: [`Applied ${args.effectType} effect to ${appliedEffects.length} clips`],
      };
    } catch (error) {
      return { success: false, error: `Failed to apply effect: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

// ─── timeline_clear ────────────────────────────────────────────────────────

async function resolveProjectPath(inputPath: string, cwd: string): Promise<string> {
  const filePath = resolve(cwd, inputPath);
  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist — caller surfaces the error
  }
  return filePath;
}

export const timelineClearTool = defineTool({
  name: "timeline_clear",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Clear timeline contents (remove clips, tracks, or sources)",
  schema: z.object({
    project: z.string().describe("Project file path"),
    what: z
      .enum(["clips", "tracks", "sources", "all"])
      .optional()
      .describe("What to clear: clips (default), tracks, sources, or all"),
    keepTracks: z
      .boolean()
      .optional()
      .describe("When clearing 'all', keep default empty tracks (default: true)"),
  }),
  async execute(args, ctx) {
    try {
      const filePath = await resolveProjectPath(args.project, ctx.workingDirectory);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      const what = args.what ?? "clips";
      const keepTracks = args.keepTracks ?? true;
      const removed = { clips: 0, tracks: 0, sources: 0 };

      if (what === "clips" || what === "all") {
        for (const clip of project.getClips()) {
          project.removeClip(clip.id);
          removed.clips++;
        }
      }

      if (what === "tracks" || what === "all") {
        for (const track of project.getTracks()) {
          project.removeTrack(track.id);
          removed.tracks++;
        }
        if (what === "all" && keepTracks) {
          project.addTrack({
            name: "Video 1",
            type: "video",
            order: 1,
            isMuted: false,
            isLocked: false,
            isVisible: true,
          });
          project.addTrack({
            name: "Audio 1",
            type: "audio",
            order: 0,
            isMuted: false,
            isLocked: false,
            isVisible: true,
          });
        }
      }

      if (what === "sources" || what === "all") {
        for (const source of project.getSources()) {
          project.removeSource(source.id);
          removed.sources++;
        }
      }

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      const parts: string[] = [];
      if (removed.clips > 0) parts.push(`${removed.clips} clips`);
      if (removed.tracks > 0) parts.push(`${removed.tracks} tracks`);
      if (removed.sources > 0) parts.push(`${removed.sources} sources`);

      return {
        success: true,
        data: { removed },
        humanLines: [parts.length > 0 ? `Cleared: ${parts.join(", ")}` : "Nothing to clear"],
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear timeline: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

// ─── export_audio / export_subtitles ───────────────────────────────────────
// These are intentional stubs: the canonical paths are export_video + FFmpeg
// extraction (audio) and audio_transcribe (subtitles). They live in the
// manifest so the surface is explicit and discoverable; the handler just
// surfaces the redirect message.

export const exportAudioTool = defineTool({
  name: "export_audio",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description:
    "Export audio track from a project. Not implemented — use export_video then strip audio with FFmpeg.",
  schema: z.object({
    project: z.string().describe("Project file path"),
    output: z.string().optional().describe("Output audio file path"),
    format: z.enum(["mp3", "wav", "aac"]).optional().describe("Output format (mp3, wav, aac)"),
  }),
  async execute() {
    return {
      success: false,
      error:
        "Audio-only export not yet implemented. Use export_video and extract audio with FFmpeg: ffmpeg -i video.mp4 -vn -acodec mp3 audio.mp3",
    };
  },
});

export const exportSubtitlesTool = defineTool({
  name: "export_subtitles",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description:
    "Export subtitles from transcription. Not implemented — use audio_transcribe to generate subtitles from audio.",
  schema: z.object({
    project: z.string().describe("Project file path"),
    output: z.string().optional().describe("Output subtitle file path"),
    format: z.enum(["srt", "vtt"]).optional().describe("Subtitle format (srt, vtt)"),
  }),
  async execute() {
    return {
      success: false,
      error:
        "Subtitle export not yet implemented. Use audio_transcribe to generate subtitles from audio.",
    };
  },
});

// ─── media_* ───────────────────────────────────────────────────────────────

export const mediaInfoTool = defineTool({
  name: "media_info",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Get information about a media file (duration, resolution, codec, etc.)",
  schema: z.object({
    path: z.string().describe("Media file path"),
  }),
  async execute(args, ctx) {
    try {
      const absPath = resolve(ctx.workingDirectory, args.path);
      const { stdout } = await execSafe(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const info = JSON.parse(stdout) as {
        format?: { duration?: string; size?: string; bit_rate?: string };
        streams?: Array<{
          codec_type?: string;
          codec_name?: string;
          width?: number;
          height?: number;
          r_frame_rate?: string;
          sample_rate?: string;
          channels?: number;
        }>;
      };
      const format = info.format ?? {};
      const streams = info.streams ?? [];

      const lines: string[] = [`File: ${args.path}`];
      const data: Record<string, unknown> = { path: args.path };

      if (format.duration) {
        const duration = parseFloat(format.duration);
        lines.push(`Duration: ${duration.toFixed(2)}s`);
        data.duration = duration;
      }
      if (format.size) {
        const sizeBytes = parseInt(format.size);
        lines.push(`Size: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`);
        data.sizeBytes = sizeBytes;
      }
      if (format.bit_rate) {
        const bitrate = parseInt(format.bit_rate);
        lines.push(`Bitrate: ${(bitrate / 1_000_000).toFixed(2)} Mbps`);
        data.bitrate = bitrate;
      }

      const videoStreams: Array<Record<string, unknown>> = [];
      const audioStreams: Array<Record<string, unknown>> = [];
      for (const stream of streams) {
        if (stream.codec_type === "video") {
          lines.push(`\nVideo:`);
          lines.push(`  Resolution: ${stream.width}x${stream.height}`);
          lines.push(`  Codec: ${stream.codec_name}`);
          let fps: number | undefined;
          if (stream.r_frame_rate) {
            const [num, den] = stream.r_frame_rate.split("/");
            const parsed = parseInt(num) / parseInt(den);
            if (Number.isFinite(parsed)) {
              fps = parsed;
              lines.push(`  Frame Rate: ${parsed.toFixed(2)} fps`);
            }
          }
          videoStreams.push({
            width: stream.width,
            height: stream.height,
            codec: stream.codec_name,
            fps,
          });
        } else if (stream.codec_type === "audio") {
          lines.push(`\nAudio:`);
          lines.push(`  Codec: ${stream.codec_name}`);
          lines.push(`  Sample Rate: ${stream.sample_rate} Hz`);
          lines.push(`  Channels: ${stream.channels}`);
          audioStreams.push({
            codec: stream.codec_name,
            sampleRate: stream.sample_rate,
            channels: stream.channels,
          });
        }
      }
      data.video = videoStreams;
      data.audio = audioStreams;

      return { success: true, data, humanLines: lines };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get media info: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const mediaCompressTool = defineTool({
  name: "media_compress",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Compress a video or audio file using FFmpeg",
  schema: z.object({
    input: z.string().describe("Input media file path"),
    output: z.string().optional().describe("Output file path (default: input-compressed.ext)"),
    quality: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Quality preset: low, medium (default), high"),
    maxSize: z.string().optional().describe("Target max file size (e.g., '10M', '100M')"),
  }),
  async execute(args, ctx) {
    try {
      const absInput = resolve(ctx.workingDirectory, args.input);
      const ext = args.input.split(".").pop() || "mp4";
      const baseName = args.input.replace(/\.[^/.]+$/, "");
      const outputPath = args.output
        ? resolve(ctx.workingDirectory, args.output)
        : resolve(ctx.workingDirectory, `${baseName}-compressed.${ext}`);

      const crfValues: Record<string, number> = { low: 28, medium: 23, high: 18 };
      const crf = crfValues[args.quality ?? "medium"];

      await execSafe(
        "ffmpeg",
        [
          "-i", absInput,
          "-c:v", "libx264", "-crf", String(crf), "-preset", "medium",
          "-c:a", "aac", "-b:a", "128k",
          outputPath, "-y",
        ],
        { maxBuffer: 50 * 1024 * 1024 },
      );

      const inputBuf = await readFile(absInput);
      const outputBuf = await readFile(outputPath);
      const inputSize = inputBuf.length;
      const outputSize = outputBuf.length;
      const reduction = ((inputSize - outputSize) / inputSize) * 100;

      return {
        success: true,
        data: { inputSize, outputSize, reductionPct: reduction, output: outputPath },
        humanLines: [
          `Compressed: ${args.input} → ${outputPath}`,
          `Size: ${formatSize(inputSize)} → ${formatSize(outputSize)} (${reduction.toFixed(1)}% reduction)`,
        ],
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to compress: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const mediaConvertTool = defineTool({
  name: "media_convert",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Convert media file to a different format using FFmpeg",
  schema: z.object({
    input: z.string().describe("Input media file path"),
    output: z.string().describe("Output file path with desired extension (e.g., 'video.webm')"),
    codec: z.string().optional().describe("Video codec (h264, h265, vp9, av1)"),
    audioCodec: z.string().optional().describe("Audio codec (aac, mp3, opus)"),
  }),
  async execute(args, ctx) {
    try {
      const absInput = resolve(ctx.workingDirectory, args.input);
      const absOutput = resolve(ctx.workingDirectory, args.output);

      const codecMap: Record<string, string> = {
        h264: "libx264",
        h265: "libx265",
        vp9: "libvpx-vp9",
        av1: "libaom-av1",
      };
      const audioCodecMap: Record<string, string> = {
        aac: "aac",
        mp3: "libmp3lame",
        opus: "libopus",
      };

      const videoCodecName = args.codec ? (codecMap[args.codec] ?? args.codec) : "copy";
      const audioCodecName = args.audioCodec ? (audioCodecMap[args.audioCodec] ?? args.audioCodec) : "copy";

      await execSafe(
        "ffmpeg",
        ["-i", absInput, "-c:v", videoCodecName, "-c:a", audioCodecName, absOutput, "-y"],
        { maxBuffer: 50 * 1024 * 1024 },
      );

      return {
        success: true,
        data: { input: args.input, output: args.output, videoCodec: videoCodecName, audioCodec: audioCodecName },
        humanLines: [`Converted: ${args.input} → ${args.output}`],
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to convert: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const mediaConcatTool = defineTool({
  name: "media_concat",
  category: "agent-only",
  cost: "free",
  surfaces: ["agent"],
  description: "Concatenate multiple media files into one using FFmpeg",
  schema: z.object({
    inputs: z.array(z.string()).describe("Array of input file paths to concatenate"),
    output: z.string().describe("Output file path"),
    reencode: z
      .boolean()
      .optional()
      .describe("Re-encode files (slower but works with different codecs)"),
  }),
  async execute(args, ctx) {
    if (args.inputs.length < 2) {
      return {
        success: false,
        error: "At least 2 input files required for concatenation",
      };
    }

    try {
      const absOutput = resolve(ctx.workingDirectory, args.output);

      if (args.reencode) {
        const ffmpegArgs: string[] = [];
        for (const i of args.inputs) {
          ffmpegArgs.push("-i", resolve(ctx.workingDirectory, i));
        }
        const filterComplex = args.inputs.map((_, i) => `[${i}:v][${i}:a]`).join("");
        ffmpegArgs.push(
          "-filter_complex",
          `${filterComplex}concat=n=${args.inputs.length}:v=1:a=1[outv][outa]`,
          "-map", "[outv]", "-map", "[outa]",
          absOutput, "-y",
        );
        await execSafe("ffmpeg", ffmpegArgs, { maxBuffer: 100 * 1024 * 1024 });
      } else {
        const tempList = resolve(ctx.workingDirectory, `concat-list-${Date.now()}.txt`);
        const listContent = args.inputs
          .map((i) => `file '${resolve(ctx.workingDirectory, i)}'`)
          .join("\n");
        await writeFile(tempList, listContent, "utf-8");
        try {
          await execSafe(
            "ffmpeg",
            ["-f", "concat", "-safe", "0", "-i", tempList, "-c", "copy", absOutput, "-y"],
            { maxBuffer: 100 * 1024 * 1024 },
          );
        } finally {
          await unlink(tempList).catch(() => {});
        }
      }

      return {
        success: true,
        data: { count: args.inputs.length, output: args.output },
        humanLines: [`Concatenated ${args.inputs.length} files → ${args.output}`],
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to concatenate: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const agentOnlyTools: readonly AnyTool[] = [
  fsListTool as unknown as AnyTool,
  fsReadTool as unknown as AnyTool,
  fsWriteTool as unknown as AnyTool,
  fsExistsTool as unknown as AnyTool,
  batchImportTool as unknown as AnyTool,
  batchConcatTool as unknown as AnyTool,
  batchApplyEffectTool as unknown as AnyTool,
  timelineClearTool as unknown as AnyTool,
  exportAudioTool as unknown as AnyTool,
  exportSubtitlesTool as unknown as AnyTool,
  mediaInfoTool as unknown as AnyTool,
  mediaCompressTool as unknown as AnyTool,
  mediaConvertTool as unknown as AnyTool,
  mediaConcatTool as unknown as AnyTool,
];
