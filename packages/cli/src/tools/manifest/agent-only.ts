/**
 * @module manifest/agent-only
 * @description Tools that only make sense inside the in-process agent REPL —
 * filesystem access (`fs_*`) and project-level batch operations (`batch_*`).
 *
 * These all use `surfaces: ["agent"]` so the MCP adapter filters them out.
 * MCP clients have their own host-side filesystem affordances and would
 * never call into our handler shell anyway.
 *
 * Dependencies are deliberately limited to Node `fs` + `@vibeframe/core`
 * (Project class) + `ffprobeDuration`. No AI provider SDKs — adding any
 * would balloon the mcp-server esbuild bundle even though the entries
 * never reach MCP at runtime.
 */

import { readFile, writeFile, readdir, stat, access } from "node:fs/promises";
import { resolve, join, basename, extname } from "node:path";
import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { MediaType, EffectType } from "@vibeframe/core/timeline";
import { ffprobeDuration } from "../../utils/exec-safe.js";

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

export const agentOnlyTools: readonly AnyTool[] = [
  fsListTool as unknown as AnyTool,
  fsReadTool as unknown as AnyTool,
  fsWriteTool as unknown as AnyTool,
  fsExistsTool as unknown as AnyTool,
  batchImportTool as unknown as AnyTool,
  batchConcatTool as unknown as AnyTool,
  batchApplyEffectTool as unknown as AnyTool,
];
