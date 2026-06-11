/**
 * @module manifest/project
 * @description Workspace project listing plus deprecated project lifecycle
 * aliases for timeline JSON state.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { defineTool, type AnyTool } from "../define-tool.js";
import { Project } from "../../engine/index.js";
import { executeProjectList } from "../../commands/_shared/project-list.js";
import { loadProject } from "./_project-io.js";

export const projectListTool = defineTool({
  name: "project_list",
  category: "project",
  cost: "free",
  title: "List Video Projects",
  annotations: { readOnly: true, openWorld: false },
  description:
    "List every VibeFrame video project in the workspace (directories with a STORYBOARD.md), newest activity first: beat count, storyboard duration, last build status, and the latest render. Directories starting with '_' (e.g. _archive) are skipped and reported as an archived count — move a project into _archive/ to retire it. Use this to answer \"what projects do I have?\" before init/build/render.",
  schema: z.object({
    dir: z
      .string()
      .optional()
      .describe(
        "Workspace directory to scan. Defaults to the surface's cwd; in MCP hosts this is the configured server workspace."
      ),
  }),
  async execute(args, ctx) {
    const result = await executeProjectList({
      workspaceDir: args.dir ? resolve(ctx.workingDirectory, args.dir) : ctx.workingDirectory,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "project list failed" };
    }
    return {
      success: true,
      data: {
        workspaceDir: result.workspaceDir,
        count: result.projects.length,
        archivedCount: result.archivedCount,
        projects: result.projects,
      },
      humanLines: [
        `📁 ${result.projects.length} project(s) in ${result.workspaceDir}` +
          (result.archivedCount > 0 ? ` (+${result.archivedCount} archived)` : ""),
        ...result.projects.map(
          (p) =>
            `   • ${p.name} — ${p.beats} beat(s), ~${p.storyboardDurationSec}s` +
            (p.buildStatus ? `, build: ${p.buildStatus}` : "") +
            (p.latestRender ? `, latest render: ${p.latestRender.file}` : "") +
            ` (updated ${p.updatedAt})`
        ),
      ],
    };
  },
});

export const projectCreateTool = defineTool({
  name: "project_create",
  category: "project",
  cost: "free",
  title: "Create Project",
  annotations: { readOnly: false, openWorld: false },
  description: "Deprecated alias for creating low-level timeline state. Prefer timeline_create.",
  schema: z.object({
    name: z.string().describe("Project name"),
    outputPath: z.string().optional().describe("Output file path (defaults to {name}.vibe.json for legacy compatibility)"),
    width: z.number().optional().describe("Video width in pixels (default: 1920)"),
    height: z.number().optional().describe("Video height in pixels (default: 1080)"),
    fps: z.number().optional().describe("Frames per second (default: 30)"),
  }),
  async execute(args, ctx) {
    const outputPath = resolve(ctx.workingDirectory, args.outputPath ?? `${args.name}.vibe.json`);
    const project = new Project(args.name);
    if (args.fps) project.setFrameRate(args.fps);
    await writeFile(outputPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
    return {
      success: true,
      data: { name: args.name, outputPath },
      humanLines: [`Created legacy timeline project "${args.name}" at ${outputPath}`],
    };
  },
});

export const projectInfoTool = defineTool({
  name: "project_info",
  category: "project",
  cost: "free",
  title: "Get Project Info",
  annotations: { readOnly: true, openWorld: false },
  description: "Deprecated alias for timeline_info. Legacy *.vibe.json files remain supported.",
  schema: z.object({
    projectPath: z.string().describe("Path to timeline.json, a timeline directory, or a legacy *.vibe.json file"),
  }),
  async execute(args, ctx) {
    const { project } = await loadProject(args.projectPath, ctx.workingDirectory);
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
    return {
      success: true,
      data: info,
      humanLines: [JSON.stringify(info, null, 2)],
    };
  },
});

export const projectTools: readonly AnyTool[] = [
  projectListTool as unknown as AnyTool,
  projectCreateTool as unknown as AnyTool,
  projectInfoTool as unknown as AnyTool,
];
