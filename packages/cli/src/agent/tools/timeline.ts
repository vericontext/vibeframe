/**
 * Timeline Tools — agent-only `timeline_clear`.
 *
 * After v0.66 PR2 the source/clip/track/effect/trim/split/move/delete/
 * duplicate/list definitions live in the manifest
 * (`packages/cli/src/tools/manifest/timeline.ts`). Only `timeline_clear`
 * remains hand-written here — it's a candidate for a future agent-only
 * manifest pass.
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";

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

async function loadProject(path: string, cwd: string): Promise<{ project: Project; filePath: string }> {
  const filePath = await resolveProjectPath(path, cwd);
  const content = await readFile(filePath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  const project = Project.fromJSON(data);
  return { project, filePath };
}

async function saveProject(project: Project, filePath: string): Promise<void> {
  await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
}

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

const clear: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = (args.project || args.path) as string;
  const what = (args.what as string) || "clips";
  const keepTracks = args.keepTracks !== false; // default true

  try {
    const { project, filePath } = await loadProject(projectPath, context.workingDirectory);

    const removed = {
      clips: 0,
      tracks: 0,
      sources: 0,
    };

    if (what === "clips" || what === "all") {
      const clips = project.getClips();
      for (const clip of clips) {
        project.removeClip(clip.id);
        removed.clips++;
      }
    }

    if (what === "tracks" || what === "all") {
      const tracks = project.getTracks();
      for (const track of tracks) {
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
      const sources = project.getSources();
      for (const source of sources) {
        project.removeSource(source.id);
        removed.sources++;
      }
    }

    await saveProject(project, filePath);

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

export function registerTimelineTools(registry: ToolRegistry): void {
  registry.register(clearDef, clear);
}
