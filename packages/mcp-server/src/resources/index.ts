import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "@vibe-edit/cli/engine";

// Resource definitions for MCP
export const resources = [
  {
    uri: "vibe://project/current",
    name: "Current Project State",
    description: "Full state of the currently active VibeEdit project",
    mimeType: "application/json",
  },
  {
    uri: "vibe://project/clips",
    name: "Project Clips",
    description: "List of all clips in the timeline",
    mimeType: "application/json",
  },
  {
    uri: "vibe://project/sources",
    name: "Media Sources",
    description: "List of all media sources in the project",
    mimeType: "application/json",
  },
  {
    uri: "vibe://project/tracks",
    name: "Timeline Tracks",
    description: "List of all tracks in the timeline",
    mimeType: "application/json",
  },
  {
    uri: "vibe://project/settings",
    name: "Project Settings",
    description: "Project configuration (resolution, fps, etc.)",
    mimeType: "application/json",
  },
];

// Current project path (set via environment or default)
let currentProjectPath: string | null = process.env.VIBE_PROJECT_PATH || null;

/**
 * Set the current project path
 */
export function setCurrentProject(path: string): void {
  currentProjectPath = path;
}

/**
 * Get the current project path
 */
export function getCurrentProjectPath(): string | null {
  return currentProjectPath;
}

/**
 * Load project from path
 */
async function loadProject(projectPath: string): Promise<Project> {
  const absPath = resolve(process.cwd(), projectPath);
  const content = await readFile(absPath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  return Project.fromJSON(data);
}

/**
 * Read resource content by URI
 */
export async function readResource(
  uri: string
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  // Parse URI to get resource type
  const match = uri.match(/^vibe:\/\/project\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid resource URI: ${uri}`);
  }

  const resourceType = match[1];

  // Check for project path in URI query or use current
  const projectPath = currentProjectPath;
  if (!projectPath) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: "No project loaded. Set VIBE_PROJECT_PATH environment variable or use project_create tool.",
          }),
        },
      ],
    };
  }

  try {
    const project = await loadProject(projectPath);
    let data: unknown;

    switch (resourceType) {
      case "current":
        data = project.toJSON();
        break;

      case "clips":
        data = project.getClips().map((clip) => ({
          id: clip.id,
          sourceId: clip.sourceId,
          trackId: clip.trackId,
          startTime: clip.startTime,
          duration: clip.duration,
          sourceStartTime: clip.sourceStartTime,
          effects: clip.effects,
        }));
        break;

      case "sources":
        data = project.getSources().map((source) => ({
          id: source.id,
          name: source.name,
          type: source.type,
          path: source.path,
          duration: source.duration,
          width: source.width,
          height: source.height,
        }));
        break;

      case "tracks":
        data = project.getTracks().map((track) => ({
          id: track.id,
          name: track.name,
          type: track.type,
          order: track.order,
          isMuted: track.isMuted,
          isLocked: track.isLocked,
          isVisible: track.isVisible,
        }));
        break;

      case "settings":
        data = {
          name: project.getName(),
          ...project.getSettings(),
        };
        break;

      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        },
      ],
    };
  }
}
