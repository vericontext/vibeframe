import { resolve } from "node:path";
import type { EffectType } from "@vibeframe/core";
import { loadProject, saveProject } from "./project.js";

export const timelineTools = [
  {
    name: "timeline_add_source",
    description: "Add a media source (video, audio, image) to the project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the project file" },
        mediaPath: { type: "string", description: "Path to the media file" },
        name: { type: "string", description: "Optional name for the source" },
        duration: { type: "number", description: "Duration of the media in seconds (default: 10)" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        sourceId: { type: "string", description: "ID of the media source" },
        trackId: { type: "string", description: "ID of the track to add clip to (optional, uses first video track)" },
        startTime: { type: "number", description: "Start time on timeline in seconds (default: 0)" },
        duration: { type: "number", description: "Clip duration in seconds (optional, uses source duration)" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip to split" },
        splitTime: { type: "number", description: "Time to split at (relative to clip start) in seconds" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip to trim" },
        trimStart: { type: "number", description: "New source start offset in seconds" },
        trimEnd: { type: "number", description: "New duration in seconds" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip to move" },
        newStartTime: { type: "number", description: "New start time on timeline in seconds" },
        newTrackId: { type: "string", description: "ID of the target track (optional)" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip to delete" },
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
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip to duplicate" },
        newStartTime: { type: "number", description: "Start time for the duplicated clip (optional, places after original)" },
      },
      required: ["projectPath", "clipId"],
    },
  },
  {
    name: "timeline_add_effect",
    description: "Add an effect to a clip",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the project file" },
        clipId: { type: "string", description: "ID of the clip" },
        effectType: { type: "string", description: "Effect type: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia, invert" },
        startTime: { type: "number", description: "Effect start time relative to clip (default: 0)" },
        duration: { type: "number", description: "Effect duration in seconds (default: 1)" },
        intensity: { type: "number", description: "Effect intensity 0-1 (default: 1)" },
      },
      required: ["projectPath", "clipId", "effectType"],
    },
  },
  {
    name: "timeline_add_track",
    description: "Add a new track to the timeline",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the project file" },
        trackType: { type: "string", description: "Track type: video or audio" },
        name: { type: "string", description: "Track name (optional)" },
      },
      required: ["projectPath", "trackType"],
    },
  },
  {
    name: "timeline_list",
    description: "List all sources, tracks, and clips in a project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the project file" },
      },
      required: ["projectPath"],
    },
  },
];

export async function handleTimelineToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
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
      return `Added source: ${source.id}`;
    }

    case "timeline_add_clip": {
      const project = await loadProject(args.projectPath as string);
      const sourceId = args.sourceId as string;
      const tracks = project.getTracks();
      const trackId = (args.trackId as string) || tracks.find(t => t.type === "video")?.id || tracks[0]?.id;
      if (!trackId) throw new Error("No tracks available. Add a track first.");
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
      return `Added clip: ${clip.id}`;
    }

    case "timeline_split_clip": {
      const project = await loadProject(args.projectPath as string);
      const splitResult = project.splitClip(args.clipId as string, args.splitTime as number);
      await saveProject(args.projectPath as string, project);
      return splitResult ? `Split clip. New clip ID: ${splitResult[1].id}` : "Failed to split clip";
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
      return "Trimmed clip";
    }

    case "timeline_move_clip": {
      const project = await loadProject(args.projectPath as string);
      const clip = project.getClips().find(c => c.id === args.clipId);
      if (!clip) throw new Error("Clip not found");
      const newTrackId = (args.newTrackId as string) || clip.trackId;
      const newStartTime = (args.newStartTime as number) ?? clip.startTime;
      project.moveClip(args.clipId as string, newTrackId, newStartTime);
      await saveProject(args.projectPath as string, project);
      return "Moved clip";
    }

    case "timeline_delete_clip": {
      const project = await loadProject(args.projectPath as string);
      const success = project.removeClip(args.clipId as string);
      await saveProject(args.projectPath as string, project);
      return success ? "Deleted clip" : "Clip not found";
    }

    case "timeline_duplicate_clip": {
      const project = await loadProject(args.projectPath as string);
      const newClip = project.duplicateClip(args.clipId as string, args.newStartTime as number | undefined);
      await saveProject(args.projectPath as string, project);
      return newClip ? `Duplicated clip. New clip ID: ${newClip.id}` : "Failed to duplicate clip";
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
      return effect ? `Added effect: ${effect.id}` : "Failed to add effect";
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
      return `Added track: ${track.id}`;
    }

    case "timeline_list": {
      const project = await loadProject(args.projectPath as string);
      const data = {
        sources: project.getSources().map(s => ({
          id: s.id, name: s.name, type: s.type, duration: s.duration,
        })),
        tracks: project.getTracks().map(t => ({
          id: t.id, name: t.name, type: t.type,
        })),
        clips: project.getClips().map(c => ({
          id: c.id, sourceId: c.sourceId, trackId: c.trackId, startTime: c.startTime, duration: c.duration,
        })),
      };
      return JSON.stringify(data, null, 2);
    }

    default:
      throw new Error(`Unknown timeline tool: ${name}`);
  }
}
