/**
 * @module manifest/_project-io
 * @description Shared load/save helpers for timeline JSON files. Used by
 * timeline + project manifest entries to read/write the on-disk timeline
 * state. Mirrors the helpers previously embedded in
 * `packages/mcp-server/src/tools/project.ts`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { Project, type ProjectFile } from "../../engine/index.js";
import { resolveTimelineFile } from "../../utils/project-resolver.js";

export async function loadProject(
  projectPath: string,
  cwd: string,
): Promise<{ project: Project; absPath: string }> {
  const absPath = await resolveTimelineFile(projectPath, cwd);
  const content = await readFile(absPath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  return { project: Project.fromJSON(data), absPath };
}

export async function saveProject(absPath: string, project: Project): Promise<void> {
  await writeFile(absPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
}
