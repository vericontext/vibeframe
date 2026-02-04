/**
 * Timeline Tools - Add sources, clips, tracks, effects, and edit timeline
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult, AgentContext } from "../types.js";
import type { MediaType, EffectType } from "@vibeframe/core/timeline";

const execAsync = promisify(exec);

// Helper to detect media type from file extension
function detectMediaType(path: string): MediaType {
  const ext = extname(path).toLowerCase();
  const videoExts = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
  const audioExts = [".mp3", ".wav", ".ogg", ".m4a", ".aac"];
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

  if (videoExts.includes(ext)) return "video";
  if (audioExts.includes(ext)) return "audio";
  if (imageExts.includes(ext)) return "image";
  return "video";
}

// Helper to get media duration using ffprobe
async function getMediaDuration(filePath: string, mediaType: MediaType): Promise<number> {
  if (mediaType === "image") {
    return 5; // Default 5 seconds for images
  }

  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 5 : duration;
  } catch {
    return 5;
  }
}

// Helper to resolve project path
async function resolveProjectPath(inputPath: string, cwd: string): Promise<string> {
  const filePath = resolve(cwd, inputPath);
  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist
  }
  return filePath;
}

// Helper to load project
async function loadProject(path: string, cwd: string): Promise<{ project: Project; filePath: string }> {
  const filePath = await resolveProjectPath(path, cwd);
  const content = await readFile(filePath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  const project = Project.fromJSON(data);
  return { project, filePath };
}

// Helper to save project
async function saveProject(project: Project, filePath: string): Promise<void> {
  await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
}

// Tool Definitions
const addSourceDef: ToolDefinition = {
  name: "timeline_add_source",
  description: "Add a media source (video, audio, or image) to the project",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      media: {
        type: "string",
        description: "Media file path to add",
      },
      name: {
        type: "string",
        description: "Source name (defaults to filename)",
      },
      type: {
        type: "string",
        description: "Media type (video, audio, image) - auto-detected if not specified",
        enum: ["video", "audio", "image"],
      },
      duration: {
        type: "number",
        description: "Duration in seconds (required for images, auto-detected for video/audio)",
      },
    },
    required: ["project", "media"],
  },
};

const addClipDef: ToolDefinition = {
  name: "timeline_add_clip",
  description: "Add a clip to the timeline from an existing source",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      sourceId: {
        type: "string",
        description: "Source ID to create clip from",
      },
      trackId: {
        type: "string",
        description: "Track ID (defaults to first matching track)",
      },
      startTime: {
        type: "number",
        description: "Start time in timeline (seconds)",
      },
      duration: {
        type: "number",
        description: "Clip duration (defaults to source duration)",
      },
      offset: {
        type: "number",
        description: "Source start offset (seconds)",
      },
    },
    required: ["project", "sourceId"],
  },
};

const addTrackDef: ToolDefinition = {
  name: "timeline_add_track",
  description: "Add a new track to the timeline",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      type: {
        type: "string",
        description: "Track type (video or audio)",
        enum: ["video", "audio"],
      },
      name: {
        type: "string",
        description: "Track name",
      },
    },
    required: ["project", "type"],
  },
};

const addEffectDef: ToolDefinition = {
  name: "timeline_add_effect",
  description: "Add an effect to a clip",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to add effect to",
      },
      effectType: {
        type: "string",
        description: "Effect type",
        enum: ["fadeIn", "fadeOut", "blur", "brightness", "contrast", "saturation", "speed", "volume"],
      },
      startTime: {
        type: "number",
        description: "Effect start time relative to clip (seconds)",
      },
      duration: {
        type: "number",
        description: "Effect duration (defaults to clip duration)",
      },
      params: {
        type: "object",
        description: "Effect-specific parameters",
      },
    },
    required: ["project", "clipId", "effectType"],
  },
};

const trimDef: ToolDefinition = {
  name: "timeline_trim",
  description: "Trim a clip (adjust start time or duration)",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to trim",
      },
      startTime: {
        type: "number",
        description: "New start time",
      },
      duration: {
        type: "number",
        description: "New duration",
      },
    },
    required: ["project", "clipId"],
  },
};

const splitDef: ToolDefinition = {
  name: "timeline_split",
  description: "Split a clip at a specific time, creating two clips",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to split",
      },
      time: {
        type: "number",
        description: "Split time relative to clip start (seconds)",
      },
    },
    required: ["project", "clipId", "time"],
  },
};

const moveDef: ToolDefinition = {
  name: "timeline_move",
  description: "Move a clip to a new position or track",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to move",
      },
      startTime: {
        type: "number",
        description: "New start time",
      },
      trackId: {
        type: "string",
        description: "New track ID",
      },
    },
    required: ["project", "clipId"],
  },
};

const deleteDef: ToolDefinition = {
  name: "timeline_delete",
  description: "Delete a clip from the timeline",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to delete",
      },
    },
    required: ["project", "clipId"],
  },
};

const duplicateDef: ToolDefinition = {
  name: "timeline_duplicate",
  description: "Duplicate a clip",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      clipId: {
        type: "string",
        description: "Clip ID to duplicate",
      },
      startTime: {
        type: "number",
        description: "Start time for duplicate (default: after original)",
      },
    },
    required: ["project", "clipId"],
  },
};

const listDef: ToolDefinition = {
  name: "timeline_list",
  description: "List timeline contents (sources, tracks, clips)",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      type: {
        type: "string",
        description: "What to list (all, sources, tracks, clips)",
        enum: ["all", "sources", "tracks", "clips"],
      },
    },
    required: ["project"],
  },
};

const clearDef: ToolDefinition = {
  name: "timeline_clear",
  description: "Clear timeline contents (remove clips, tracks, or sources)",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      what: {
        type: "string",
        description: "What to clear: clips (default), tracks, sources, or all",
        enum: ["clips", "tracks", "sources", "all"],
      },
      keepTracks: {
        type: "boolean",
        description: "When clearing 'all', keep default empty tracks (default: true)",
      },
    },
    required: ["project"],
  },
};

// Tool Handlers
const addSource: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const mediaPath = args.media as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);
    const absMediaPath = resolve(context.workingDirectory, mediaPath);

    const mediaName = (args.name as string) || basename(mediaPath);
    const mediaType = (args.type as MediaType) || detectMediaType(mediaPath);
    const duration = (args.duration as number) || await getMediaDuration(absMediaPath, mediaType);

    const source = project.addSource({
      name: mediaName,
      type: mediaType,
      url: absMediaPath,
      duration,
    });

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Source added: ${source.id}\nName: ${mediaName}\nType: ${mediaType}\nDuration: ${duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to add source: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const addClip: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const sourceId = args.sourceId as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const source = project.getSource(sourceId);
    if (!source) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Source not found: ${sourceId}`,
      };
    }

    // Find track
    let trackId = args.trackId as string | undefined;
    if (!trackId) {
      const trackType = source.type === "audio" ? "audio" : "video";
      const tracks = project.getTracksByType(trackType);
      if (tracks.length === 0) {
        return {
          toolCallId: "",
          success: false,
          output: "",
          error: `No ${trackType} track found. Create one first with timeline_add_track.`,
        };
      }
      trackId = tracks[0].id;
    }

    const startTime = (args.startTime as number) || 0;
    const offset = (args.offset as number) || 0;
    const duration = (args.duration as number) || source.duration;

    const clip = project.addClip({
      sourceId,
      trackId,
      startTime,
      duration,
      sourceStartOffset: offset,
      sourceEndOffset: offset + duration,
    });

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Clip added: ${clip.id}\nSource: ${source.name}\nTrack: ${trackId}\nStart: ${startTime}s\nDuration: ${duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to add clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const addTrack: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const type = args.type as MediaType;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const existingTracks = project.getTracksByType(type);
    const trackName = (args.name as string) || `${type.charAt(0).toUpperCase() + type.slice(1)} ${existingTracks.length + 1}`;
    const order = project.getTracks().length;

    const track = project.addTrack({
      name: trackName,
      type,
      order,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Track added: ${track.id}\nName: ${trackName}\nType: ${type}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to add track: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const addEffect: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;
  const effectType = args.effectType as EffectType;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    const startTime = (args.startTime as number) || 0;
    const duration = (args.duration as number) || clip.duration;
    const rawParams = (args.params as Record<string, unknown>) || {};
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        params[key] = value;
      }
    }

    const effect = project.addEffect(clipId, {
      type: effectType,
      startTime,
      duration,
      params,
    });

    if (!effect) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to add effect",
      };
    }

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Effect added: ${effect.id}\nType: ${effectType}\nStart: ${startTime}s\nDuration: ${duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to add effect: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const trim: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    if (args.startTime !== undefined) {
      project.trimClipStart(clipId, args.startTime as number);
    }
    if (args.duration !== undefined) {
      project.trimClipEnd(clipId, args.duration as number);
    }

    await saveProject(project, filePath);

    const updated = project.getClip(clipId)!;
    return {
      toolCallId: "",
      success: true,
      output: `Clip trimmed: ${clipId}\nStart: ${updated.startTime}s\nDuration: ${updated.duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to trim clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const split: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;
  const splitTime = args.time as number;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    if (splitTime <= 0 || splitTime >= clip.duration) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Invalid split time. Must be between 0 and ${clip.duration}s`,
      };
    }

    const result = project.splitClip(clipId, splitTime);
    if (!result) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to split clip",
      };
    }

    await saveProject(project, filePath);

    const [first, second] = result;
    return {
      toolCallId: "",
      success: true,
      output: `Clip split:\nFirst: ${first.id} (${first.duration.toFixed(2)}s)\nSecond: ${second.id} (${second.duration.toFixed(2)}s)`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to split clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const move: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    const newTime = args.startTime !== undefined ? (args.startTime as number) : clip.startTime;
    const newTrack = (args.trackId as string) || clip.trackId;

    const moved = project.moveClip(clipId, newTrack, newTime);
    if (!moved) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to move clip",
      };
    }

    await saveProject(project, filePath);

    const updated = project.getClip(clipId)!;
    return {
      toolCallId: "",
      success: true,
      output: `Clip moved: ${clipId}\nTrack: ${updated.trackId}\nStart: ${updated.startTime}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to move clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const deleteClip: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    const removed = project.removeClip(clipId);
    if (!removed) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to delete clip",
      };
    }

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Clip deleted: ${clipId}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to delete clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const duplicate: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const clipId = args.clipId as string;

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const clip = project.getClip(clipId);
    if (!clip) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Clip not found: ${clipId}`,
      };
    }

    const offsetTime = args.startTime as number | undefined;
    const duplicated = project.duplicateClip(clipId, offsetTime);

    if (!duplicated) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "Failed to duplicate clip",
      };
    }

    await saveProject(project, filePath);

    return {
      toolCallId: "",
      success: true,
      output: `Clip duplicated: ${duplicated.id}\nStart: ${duplicated.startTime}s\nDuration: ${duplicated.duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to duplicate clip: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const list: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const listType = (args.type as string) || "all";

  try {
    const { project } = await loadProject(projectPath, context.workingDirectory);
    const output: string[] = [];

    if (listType === "all" || listType === "sources") {
      output.push("## Sources");
      const sources = project.getSources();
      if (sources.length === 0) {
        output.push("  (none)");
      } else {
        for (const source of sources) {
          output.push(`  ${source.id}: ${source.name} (${source.type}, ${source.duration.toFixed(1)}s)`);
        }
      }
    }

    if (listType === "all" || listType === "tracks") {
      output.push("\n## Tracks");
      const tracks = project.getTracks();
      for (const track of tracks) {
        const status = [
          track.isMuted ? "muted" : null,
          track.isLocked ? "locked" : null,
          !track.isVisible ? "hidden" : null,
        ].filter(Boolean).join(", ");
        output.push(`  ${track.id}: ${track.name} (${track.type})${status ? ` [${status}]` : ""}`);
      }
    }

    if (listType === "all" || listType === "clips") {
      output.push("\n## Clips");
      const clips = project.getClips();
      if (clips.length === 0) {
        output.push("  (none)");
      } else {
        for (const clip of clips) {
          const source = project.getSource(clip.sourceId);
          const effects = clip.effects.length > 0 ? ` [effects: ${clip.effects.map((e) => e.type).join(", ")}]` : "";
          output.push(`  ${clip.id}: ${source?.name || "unknown"} @ ${clip.startTime}s (${clip.duration.toFixed(1)}s)${effects}`);
        }
      }
    }

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
      error: `Failed to list timeline: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const clear: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const what = (args.what as string) || "clips";
  const keepTracks = args.keepTracks !== false; // default true

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const removed = {
      clips: 0,
      tracks: 0,
      sources: 0,
    };

    // Remove clips
    if (what === "clips" || what === "all") {
      const clips = project.getClips();
      for (const clip of clips) {
        project.removeClip(clip.id);
        removed.clips++;
      }
    }

    // Remove tracks
    if (what === "tracks" || what === "all") {
      const tracks = project.getTracks();
      for (const track of tracks) {
        project.removeTrack(track.id);
        removed.tracks++;
      }

      // Re-add default tracks if keepTracks
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

    // Remove sources
    if (what === "sources" || what === "all") {
      const sources = project.getSources();
      for (const source of sources) {
        project.removeSource(source.id);
        removed.sources++;
      }
    }

    await saveProject(project, filePath);

    // Build output message
    const parts: string[] = [];
    if (removed.clips > 0) parts.push(`${removed.clips} clips`);
    if (removed.tracks > 0) parts.push(`${removed.tracks} tracks`);
    if (removed.sources > 0) parts.push(`${removed.sources} sources`);

    return {
      toolCallId: "",
      success: true,
      output: parts.length > 0 ? `Cleared: ${parts.join(", ")}` : "Nothing to clear",
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to clear timeline: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// Registration function
export function registerTimelineTools(registry: ToolRegistry): void {
  registry.register(addSourceDef, addSource);
  registry.register(addClipDef, addClip);
  registry.register(addTrackDef, addTrack);
  registry.register(addEffectDef, addEffect);
  registry.register(trimDef, trim);
  registry.register(splitDef, split);
  registry.register(moveDef, move);
  registry.register(deleteDef, deleteClip);
  registry.register(duplicateDef, duplicate);
  registry.register(listDef, list);
  registry.register(clearDef, clear);
}
