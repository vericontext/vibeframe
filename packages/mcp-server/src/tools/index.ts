import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "@vibeframe/cli/engine";
import type { EffectType } from "@vibeframe/core";

// Tool definitions for MCP
export const tools = [
  // Project Management
  {
    name: "project_create",
    description: "Create a new VibeFrame project file",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Project name",
        },
        outputPath: {
          type: "string",
          description: "Output file path (defaults to {name}.vibe.json)",
        },
        width: {
          type: "number",
          description: "Video width in pixels (default: 1920)",
        },
        height: {
          type: "number",
          description: "Video height in pixels (default: 1080)",
        },
        fps: {
          type: "number",
          description: "Frames per second (default: 30)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "project_info",
    description: "Get information about a VibeFrame project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the .vibe.json project file",
        },
      },
      required: ["projectPath"],
    },
  },

  // Timeline Operations
  {
    name: "timeline_add_source",
    description: "Add a media source (video, audio, image) to the project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        mediaPath: {
          type: "string",
          description: "Path to the media file",
        },
        name: {
          type: "string",
          description: "Optional name for the source",
        },
        duration: {
          type: "number",
          description: "Duration of the media in seconds (default: 10)",
        },
      },
      required: ["projectPath", "mediaPath"],
    },
  },
  {
    name: "timeline_add_clip",
    description: "Add a clip to the timeline from an existing source",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        sourceId: {
          type: "string",
          description: "ID of the media source",
        },
        trackId: {
          type: "string",
          description: "ID of the track to add clip to (optional, uses first video track)",
        },
        startTime: {
          type: "number",
          description: "Start time on timeline in seconds (default: 0)",
        },
        duration: {
          type: "number",
          description: "Clip duration in seconds (optional, uses source duration)",
        },
      },
      required: ["projectPath", "sourceId"],
    },
  },
  {
    name: "timeline_split_clip",
    description: "Split a clip at a specific time",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip to split",
        },
        splitTime: {
          type: "number",
          description: "Time to split at (relative to clip start) in seconds",
        },
      },
      required: ["projectPath", "clipId", "splitTime"],
    },
  },
  {
    name: "timeline_trim_clip",
    description: "Trim a clip by adjusting its start or end",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip to trim",
        },
        trimStart: {
          type: "number",
          description: "New source start offset in seconds",
        },
        trimEnd: {
          type: "number",
          description: "New duration in seconds",
        },
      },
      required: ["projectPath", "clipId"],
    },
  },
  {
    name: "timeline_move_clip",
    description: "Move a clip to a new position or track",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip to move",
        },
        newStartTime: {
          type: "number",
          description: "New start time on timeline in seconds",
        },
        newTrackId: {
          type: "string",
          description: "ID of the target track (optional)",
        },
      },
      required: ["projectPath", "clipId"],
    },
  },
  {
    name: "timeline_delete_clip",
    description: "Delete a clip from the timeline",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip to delete",
        },
      },
      required: ["projectPath", "clipId"],
    },
  },
  {
    name: "timeline_duplicate_clip",
    description: "Duplicate a clip",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip to duplicate",
        },
        newStartTime: {
          type: "number",
          description: "Start time for the duplicated clip (optional, places after original)",
        },
      },
      required: ["projectPath", "clipId"],
    },
  },

  // Effects
  {
    name: "timeline_add_effect",
    description: "Add an effect to a clip",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        clipId: {
          type: "string",
          description: "ID of the clip",
        },
        effectType: {
          type: "string",
          description: "Effect type: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia, invert",
        },
        startTime: {
          type: "number",
          description: "Effect start time relative to clip (default: 0)",
        },
        duration: {
          type: "number",
          description: "Effect duration in seconds (default: 1)",
        },
        intensity: {
          type: "number",
          description: "Effect intensity 0-1 (default: 1)",
        },
      },
      required: ["projectPath", "clipId", "effectType"],
    },
  },

  // Tracks
  {
    name: "timeline_add_track",
    description: "Add a new track to the timeline",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
        trackType: {
          type: "string",
          description: "Track type: video or audio",
        },
        name: {
          type: "string",
          description: "Track name (optional)",
        },
      },
      required: ["projectPath", "trackType"],
    },
  },

  // List contents
  {
    name: "timeline_list",
    description: "List all sources, tracks, and clips in a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: {
          type: "string",
          description: "Path to the project file",
        },
      },
      required: ["projectPath"],
    },
  },
];

// Helper to load project
async function loadProject(projectPath: string): Promise<Project> {
  const absPath = resolve(process.cwd(), projectPath);
  const content = await readFile(absPath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  return Project.fromJSON(data);
}

// Helper to save project
async function saveProject(projectPath: string, project: Project): Promise<void> {
  const absPath = resolve(process.cwd(), projectPath);
  await writeFile(absPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
}

// Tool call handler
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    let result: string;

    switch (name) {
      case "project_create": {
        const projectName = args.name as string;
        const outputPath = (args.outputPath as string) || `${projectName}.vibe.json`;
        const project = new Project(projectName);
        if (args.fps) {
          project.setFrameRate(args.fps as number);
        }
        await saveProject(outputPath, project);
        result = `Created project "${projectName}" at ${outputPath}`;
        break;
      }

      case "project_info": {
        const project = await loadProject(args.projectPath as string);
        const meta = project.getMeta();
        const info = {
          name: meta.name,
          aspectRatio: meta.aspectRatio,
          frameRate: meta.frameRate,
          duration: meta.duration,
          sources: project.getSources().length,
          tracks: project.getTracks().length,
          clips: project.getClips().length,
        };
        result = JSON.stringify(info, null, 2);
        break;
      }

      case "timeline_add_source": {
        const project = await loadProject(args.projectPath as string);
        const mediaPath = resolve(process.cwd(), args.mediaPath as string);
        const ext = mediaPath.split(".").pop()?.toLowerCase() || "";
        const mediaTypes: Record<string, "video" | "audio" | "image"> = {
          mp4: "video", webm: "video", mov: "video", avi: "video",
          mp3: "audio", wav: "audio", aac: "audio", ogg: "audio",
          jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
        };
        const source = project.addSource({
          name: (args.name as string) || mediaPath.split("/").pop() || "media",
          type: mediaTypes[ext] || "video",
          url: mediaPath,
          duration: (args.duration as number) || 10,
        });
        await saveProject(args.projectPath as string, project);
        result = `Added source: ${source.id}`;
        break;
      }

      case "timeline_add_clip": {
        const project = await loadProject(args.projectPath as string);
        const sourceId = args.sourceId as string;
        const tracks = project.getTracks();
        const trackId = (args.trackId as string) || tracks.find(t => t.type === "video")?.id || tracks[0]?.id;

        if (!trackId) {
          throw new Error("No tracks available. Add a track first.");
        }

        const source = project.getSource(sourceId);
        const duration = (args.duration as number) || source?.duration || 10;

        const clip = project.addClip({
          sourceId,
          trackId,
          startTime: (args.startTime as number) || 0,
          duration,
          sourceStartOffset: 0,
          sourceEndOffset: duration,
        });
        await saveProject(args.projectPath as string, project);
        result = `Added clip: ${clip.id}`;
        break;
      }

      case "timeline_split_clip": {
        const project = await loadProject(args.projectPath as string);
        const splitResult = project.splitClip(args.clipId as string, args.splitTime as number);
        await saveProject(args.projectPath as string, project);
        result = splitResult ? `Split clip. New clip ID: ${splitResult[1].id}` : "Failed to split clip";
        break;
      }

      case "timeline_trim_clip": {
        const project = await loadProject(args.projectPath as string);
        if (args.trimStart !== undefined) {
          project.trimClipStart(args.clipId as string, args.trimStart as number);
        }
        if (args.trimEnd !== undefined) {
          project.trimClipEnd(args.clipId as string, args.trimEnd as number);
        }
        await saveProject(args.projectPath as string, project);
        result = "Trimmed clip";
        break;
      }

      case "timeline_move_clip": {
        const project = await loadProject(args.projectPath as string);
        const clip = project.getClips().find(c => c.id === args.clipId);
        if (!clip) throw new Error("Clip not found");

        const newTrackId = (args.newTrackId as string) || clip.trackId;
        const newStartTime = (args.newStartTime as number) ?? clip.startTime;
        project.moveClip(args.clipId as string, newTrackId, newStartTime);
        await saveProject(args.projectPath as string, project);
        result = "Moved clip";
        break;
      }

      case "timeline_delete_clip": {
        const project = await loadProject(args.projectPath as string);
        const success = project.removeClip(args.clipId as string);
        await saveProject(args.projectPath as string, project);
        result = success ? "Deleted clip" : "Clip not found";
        break;
      }

      case "timeline_duplicate_clip": {
        const project = await loadProject(args.projectPath as string);
        const newClip = project.duplicateClip(args.clipId as string, args.newStartTime as number | undefined);
        await saveProject(args.projectPath as string, project);
        result = newClip ? `Duplicated clip. New clip ID: ${newClip.id}` : "Failed to duplicate clip";
        break;
      }

      case "timeline_add_effect": {
        const project = await loadProject(args.projectPath as string);
        const effect = project.addEffect(args.clipId as string, {
          type: args.effectType as EffectType,
          startTime: (args.startTime as number) || 0,
          duration: (args.duration as number) || 1,
          params: { intensity: (args.intensity as number) || 1 },
        });
        await saveProject(args.projectPath as string, project);
        result = effect ? `Added effect: ${effect.id}` : "Failed to add effect";
        break;
      }

      case "timeline_add_track": {
        const project = await loadProject(args.projectPath as string);
        const trackType = args.trackType as "video" | "audio";
        const tracks = project.getTracks();
        const track = project.addTrack({
          type: trackType,
          name: (args.name as string) || `${trackType}-${tracks.length + 1}`,
          order: tracks.length,
          isMuted: false,
          isLocked: false,
          isVisible: true,
        });
        await saveProject(args.projectPath as string, project);
        result = `Added track: ${track.id}`;
        break;
      }

      case "timeline_list": {
        const project = await loadProject(args.projectPath as string);
        const data = {
          sources: project.getSources().map(s => ({
            id: s.id,
            name: s.name,
            type: s.type,
            duration: s.duration,
          })),
          tracks: project.getTracks().map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
          })),
          clips: project.getClips().map(c => ({
            id: c.id,
            sourceId: c.sourceId,
            trackId: c.trackId,
            startTime: c.startTime,
            duration: c.duration,
          })),
        };
        result = JSON.stringify(data, null, 2);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}
