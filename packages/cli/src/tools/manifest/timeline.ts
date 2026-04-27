/**
 * @module manifest/timeline
 * @description Timeline editing tools — wraps the engine's Project methods
 * with auto load/save bookends.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { defineTool, type AnyTool } from "../define-tool.js";
import type { EffectType } from "@vibeframe/core";
import { loadProject, saveProject } from "./_project-io.js";

const MEDIA_TYPES: Record<string, "video" | "audio" | "image"> = {
  mp4: "video", webm: "video", mov: "video", avi: "video",
  mp3: "audio", wav: "audio", aac: "audio", ogg: "audio",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
};

export const timelineAddSourceTool = defineTool({
  name: "timeline_add_source",
  category: "timeline",
  cost: "free",
  description: "Add a media source (video, audio, image) to the project",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    mediaPath: z.string().describe("Path to the media file"),
    name: z.string().optional().describe("Optional name for the source"),
    duration: z.number().optional().describe("Duration of the media in seconds (default: 10)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const mediaPath = resolve(ctx.workingDirectory, args.mediaPath);
    const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
    const source = project.addSource({
      name: args.name ?? mediaPath.split("/").pop() ?? "media",
      type: MEDIA_TYPES[ext] ?? "video",
      url: mediaPath,
      duration: args.duration ?? 10,
    });
    await saveProject(absPath, project);
    return { success: true, data: { sourceId: source.id }, humanLines: [`Added source: ${source.id}`] };
  },
});

export const timelineAddClipTool = defineTool({
  name: "timeline_add_clip",
  category: "timeline",
  cost: "free",
  description: "Add a clip to the timeline from an existing source",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    sourceId: z.string().describe("ID of the media source"),
    trackId: z.string().optional().describe("ID of the track to add clip to (optional, uses first video track)"),
    startTime: z.number().optional().describe("Start time on timeline in seconds (default: 0)"),
    duration: z.number().optional().describe("Clip duration in seconds (optional, uses source duration)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const tracks = project.getTracks();
    const trackId = args.trackId ?? tracks.find((t) => t.type === "video")?.id ?? tracks[0]?.id;
    if (!trackId) return { success: false, error: "No tracks available. Add a track first." };
    const source = project.getSource(args.sourceId);
    const duration = args.duration ?? source?.duration ?? 10;
    const clip = project.addClip({
      sourceId: args.sourceId,
      trackId,
      startTime: args.startTime ?? 0,
      duration,
      sourceStartOffset: 0,
      sourceEndOffset: duration,
    });
    await saveProject(absPath, project);
    return { success: true, data: { clipId: clip.id }, humanLines: [`Added clip: ${clip.id}`] };
  },
});

export const timelineSplitClipTool = defineTool({
  name: "timeline_split_clip",
  category: "timeline",
  cost: "free",
  description: "Split a clip at a specific time",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip to split"),
    splitTime: z.number().describe("Time to split at (relative to clip start) in seconds"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const splitResult = project.splitClip(args.clipId, args.splitTime);
    await saveProject(absPath, project);
    if (!splitResult) return { success: false, error: "Failed to split clip" };
    return { success: true, data: { newClipId: splitResult[1].id }, humanLines: [`Split clip. New clip ID: ${splitResult[1].id}`] };
  },
});

export const timelineTrimClipTool = defineTool({
  name: "timeline_trim_clip",
  category: "timeline",
  cost: "free",
  description: "Trim a clip by adjusting its start or end",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip to trim"),
    trimStart: z.number().optional().describe("New source start offset in seconds"),
    trimEnd: z.number().optional().describe("New duration in seconds"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    if (args.trimStart !== undefined) project.trimClipStart(args.clipId, args.trimStart);
    if (args.trimEnd !== undefined) project.trimClipEnd(args.clipId, args.trimEnd);
    await saveProject(absPath, project);
    return { success: true, data: { clipId: args.clipId }, humanLines: ["Trimmed clip"] };
  },
});

export const timelineMoveClipTool = defineTool({
  name: "timeline_move_clip",
  category: "timeline",
  cost: "free",
  description: "Move a clip to a new position or track",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip to move"),
    newStartTime: z.number().optional().describe("New start time on timeline in seconds"),
    newTrackId: z.string().optional().describe("ID of the target track (optional)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const clip = project.getClips().find((c) => c.id === args.clipId);
    if (!clip) return { success: false, error: "Clip not found" };
    const newTrackId = args.newTrackId ?? clip.trackId;
    const newStartTime = args.newStartTime ?? clip.startTime;
    project.moveClip(args.clipId, newTrackId, newStartTime);
    await saveProject(absPath, project);
    return { success: true, data: { clipId: args.clipId }, humanLines: ["Moved clip"] };
  },
});

export const timelineDeleteClipTool = defineTool({
  name: "timeline_delete_clip",
  category: "timeline",
  cost: "free",
  description: "Delete a clip from the timeline",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip to delete"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const success = project.removeClip(args.clipId);
    await saveProject(absPath, project);
    return success
      ? { success: true, data: { clipId: args.clipId }, humanLines: ["Deleted clip"] }
      : { success: false, error: "Clip not found" };
  },
});

export const timelineDuplicateClipTool = defineTool({
  name: "timeline_duplicate_clip",
  category: "timeline",
  cost: "free",
  description: "Duplicate a clip on the timeline (optionally at a new start time)",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip to duplicate"),
    newStartTime: z.number().optional().describe("Start time for the duplicated clip (optional, places after original)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const newClip = project.duplicateClip(args.clipId, args.newStartTime);
    await saveProject(absPath, project);
    if (!newClip) return { success: false, error: "Failed to duplicate clip" };
    return { success: true, data: { newClipId: newClip.id }, humanLines: [`Duplicated clip. New clip ID: ${newClip.id}`] };
  },
});

export const timelineAddEffectTool = defineTool({
  name: "timeline_add_effect",
  category: "timeline",
  cost: "free",
  description: "Add an effect to a clip",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    clipId: z.string().describe("ID of the clip"),
    effectType: z.string().describe("Effect type: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia, invert"),
    startTime: z.number().optional().describe("Effect start time relative to clip (default: 0)"),
    duration: z.number().optional().describe("Effect duration in seconds (default: 1)"),
    intensity: z.number().optional().describe("Effect intensity 0-1 (default: 1)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const effect = project.addEffect(args.clipId, {
      type: args.effectType as EffectType,
      startTime: args.startTime ?? 0,
      duration: args.duration ?? 1,
      params: { intensity: args.intensity ?? 1 },
    });
    await saveProject(absPath, project);
    if (!effect) return { success: false, error: "Failed to add effect" };
    return { success: true, data: { effectId: effect.id }, humanLines: [`Added effect: ${effect.id}`] };
  },
});

export const timelineAddTrackTool = defineTool({
  name: "timeline_add_track",
  category: "timeline",
  cost: "free",
  description: "Add a new track to the timeline",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
    trackType: z.string().describe("Track type: video or audio"),
    name: z.string().optional().describe("Track name (optional)"),
  }),
  async execute(args, ctx) {
    const { project, absPath } = await loadProject(args.projectPath, ctx.workingDirectory);
    const trackType = args.trackType as "video" | "audio";
    const tracks = project.getTracks();
    const track = project.addTrack({
      type: trackType,
      name: args.name ?? `${trackType}-${tracks.length + 1}`,
      order: tracks.length,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });
    await saveProject(absPath, project);
    return { success: true, data: { trackId: track.id }, humanLines: [`Added track: ${track.id}`] };
  },
});

export const timelineListTool = defineTool({
  name: "timeline_list",
  category: "timeline",
  cost: "free",
  description: "List all sources, tracks, and clips in a project",
  schema: z.object({
    projectPath: z.string().describe("Path to the project file"),
  }),
  async execute(args, ctx) {
    const { project } = await loadProject(args.projectPath, ctx.workingDirectory);
    const data = {
      sources: project.getSources().map((s) => ({ id: s.id, name: s.name, type: s.type, duration: s.duration })),
      tracks: project.getTracks().map((t) => ({ id: t.id, name: t.name, type: t.type })),
      clips: project.getClips().map((c) => ({ id: c.id, sourceId: c.sourceId, trackId: c.trackId, startTime: c.startTime, duration: c.duration })),
    };
    return {
      success: true,
      data,
      humanLines: [`${data.sources.length} source(s) · ${data.tracks.length} track(s) · ${data.clips.length} clip(s)`],
    };
  },
});

export const timelineTools: readonly AnyTool[] = [
  timelineAddSourceTool as unknown as AnyTool,
  timelineAddClipTool as unknown as AnyTool,
  timelineSplitClipTool as unknown as AnyTool,
  timelineTrimClipTool as unknown as AnyTool,
  timelineMoveClipTool as unknown as AnyTool,
  timelineDeleteClipTool as unknown as AnyTool,
  timelineDuplicateClipTool as unknown as AnyTool,
  timelineAddEffectTool as unknown as AnyTool,
  timelineAddTrackTool as unknown as AnyTool,
  timelineListTool as unknown as AnyTool,
];
