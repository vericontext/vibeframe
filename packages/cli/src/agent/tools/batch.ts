/**
 * Batch Tools - Batch operations for processing multiple items
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, basename, extname, join } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { MediaType, EffectType } from "@vibeframe/core/timeline";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Helper functions
function detectMediaType(filePath: string): MediaType {
  const ext = extname(filePath).toLowerCase();
  const videoExts = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
  const audioExts = [".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  return "video";
}

function isMediaFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const mediaExts = [
    ".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v",
    ".mp3", ".wav", ".aac", ".flac", ".ogg", ".m4a",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ];
  return mediaExts.includes(ext);
}

async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// Tool Definitions

const batchImportDef: ToolDefinition = {
  name: "batch_import",
  description: "Import multiple media files from a directory into a project. Scans directory for video, audio, and image files.",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      directory: {
        type: "string",
        description: "Directory containing media files to import",
      },
      recursive: {
        type: "boolean",
        description: "Search subdirectories recursively (default: false)",
      },
      filter: {
        type: "string",
        description: "Filter files by extension, comma-separated (e.g., '.mp4,.mov')",
      },
      imageDuration: {
        type: "number",
        description: "Default duration for images in seconds (default: 5)",
      },
    },
    required: ["project", "directory"],
  },
};

const batchConcatDef: ToolDefinition = {
  name: "batch_concat",
  description: "Concatenate multiple sources into sequential clips on the timeline",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      sourceIds: {
        type: "array",
        items: { type: "string", description: "Source ID" },
        description: "Source IDs to concatenate. If empty with useAll=true, uses all sources.",
      },
      useAll: {
        type: "boolean",
        description: "Use all sources in the project (default: false)",
      },
      trackId: {
        type: "string",
        description: "Track to place clips on (auto-selects if not specified)",
      },
      startTime: {
        type: "number",
        description: "Starting time in seconds (default: 0)",
      },
      gap: {
        type: "number",
        description: "Gap between clips in seconds (default: 0)",
      },
    },
    required: ["project"],
  },
};

const batchApplyEffectDef: ToolDefinition = {
  name: "batch_apply_effect",
  description: "Apply an effect to multiple clips at once",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipIds: {
        type: "array",
        items: { type: "string", description: "Clip ID" },
        description: "Clip IDs to apply effect to. If empty with useAll=true, applies to all clips.",
      },
      useAll: {
        type: "boolean",
        description: "Apply to all clips in the project (default: false)",
      },
      effectType: {
        type: "string",
        description: "Effect type to apply",
        enum: ["fadeIn", "fadeOut", "blur", "brightness", "contrast", "saturation", "speed", "volume"],
      },
      duration: {
        type: "number",
        description: "Effect duration in seconds (default: entire clip)",
      },
      params: {
        type: "object",
        description: "Effect-specific parameters",
      },
    },
    required: ["project", "effectType"],
  },
};

// Tool Handlers

const batchImport: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const directory = args.directory as string;
  const recursive = args.recursive as boolean || false;
  const filterStr = args.filter as string | undefined;
  const imageDuration = (args.imageDuration as number) || 5;

  try {
    const filePath = resolve(context.workingDirectory, projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const dirPath = resolve(context.workingDirectory, directory);
    const filterExts = filterStr
      ? filterStr.split(",").map((e) => e.trim().toLowerCase())
      : null;

    // Collect media files
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

          if (matchesFilter && isMediaFile(entryPath)) {
            mediaFiles.push(entryPath);
          }
        }
      }
    };

    await scanDir(dirPath);

    if (mediaFiles.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "No media files found in directory",
      };
    }

    // Sort files alphabetically
    mediaFiles.sort();

    const addedSources: { id: string; name: string; type: MediaType }[] = [];

    for (const mediaFile of mediaFiles) {
      const mediaName = basename(mediaFile);
      const mediaType = detectMediaType(mediaFile);
      let duration = imageDuration;

      // Get actual duration for video/audio
      if (mediaType !== "image") {
        const actualDuration = await getMediaDuration(mediaFile);
        if (actualDuration > 0) {
          duration = actualDuration;
        }
      }

      const source = project.addSource({
        name: mediaName,
        type: mediaType,
        url: mediaFile,
        duration,
      });

      addedSources.push({ id: source.id, name: mediaName, type: mediaType });
    }

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    // Build output
    const output = [
      `Imported ${addedSources.length} media files:`,
      "",
      ...addedSources.map((s) => `  + ${s.name} (${s.type})`),
    ];

    return {
      toolCallId: "",
      success: true,
      output: output.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to import files: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const batchConcat: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const sourceIds = args.sourceIds as string[] || [];
  const useAll = args.useAll as boolean || false;
  const trackId = args.trackId as string | undefined;
  const startTime = (args.startTime as number) || 0;
  const gap = (args.gap as number) || 0;

  try {
    const filePath = resolve(context.workingDirectory, projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    // Get sources to concatenate
    let sourcesToConcat = useAll
      ? project.getSources()
      : sourceIds.map((id) => project.getSource(id)).filter(Boolean);

    if (!sourcesToConcat || sourcesToConcat.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "No sources to concatenate. Provide sourceIds or use useAll=true.",
      };
    }

    // Find or determine track
    let targetTrackId = trackId;
    if (!targetTrackId) {
      // Find first matching track type
      const firstSource = sourcesToConcat[0]!;
      const trackType = firstSource.type === "audio" ? "audio" : "video";
      const tracks = project.getTracksByType(trackType);
      if (tracks.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `No ${trackType} track found. Create one first.`,
        };
      }
      targetTrackId = tracks[0].id;
    }

    // Create clips
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

      createdClips.push({
        id: clip.id,
        sourceName: source.name,
        startTime: currentTime,
        duration: source.duration,
      });

      currentTime += source.duration + gap;
    }

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    // Build output
    const totalDuration = currentTime - gap - startTime;
    const output = [
      `Created ${createdClips.length} clips (total: ${totalDuration.toFixed(1)}s):`,
      "",
      ...createdClips.map((c) => `  ${c.sourceName} @ ${c.startTime.toFixed(1)}s (${c.duration.toFixed(1)}s)`),
    ];

    return {
      toolCallId: "",
      success: true,
      output: output.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to concatenate: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const batchApplyEffect: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipIds = args.clipIds as string[] || [];
  const useAll = args.useAll as boolean || false;
  const effectType = args.effectType as EffectType;
  const duration = args.duration as number | undefined;
  const rawParams = (args.params as Record<string, unknown>) || {};

  try {
    const filePath = resolve(context.workingDirectory, projectPath);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    // Get clips to apply effect to
    let targetClips = useAll
      ? project.getClips()
      : clipIds.map((id) => project.getClip(id)).filter(Boolean);

    if (!targetClips || targetClips.length === 0) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "No clips to apply effect to. Provide clipIds or use useAll=true.",
      };
    }

    // Prepare params
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        params[key] = value;
      }
    }

    // Apply effects
    const appliedEffects: { clipId: string; effectId: string }[] = [];

    for (const clip of targetClips) {
      if (!clip) continue;

      const effectDuration = duration ?? clip.duration;
      const effect = project.addEffect(clip.id, {
        type: effectType,
        startTime: 0,
        duration: effectDuration,
        params,
      });

      if (effect) {
        appliedEffects.push({ clipId: clip.id, effectId: effect.id });
      }
    }

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    return {
      toolCallId: "",
      success: true,
      output: `Applied ${effectType} effect to ${appliedEffects.length} clips`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to apply effect: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// Registration function
export function registerBatchTools(registry: ToolRegistry): void {
  registry.register(batchImportDef, batchImport);
  registry.register(batchConcatDef, batchConcat);
  registry.register(batchApplyEffectDef, batchApplyEffect);
}
