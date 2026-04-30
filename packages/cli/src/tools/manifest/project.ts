/**
 * @module manifest/project
 * @description Deprecated project lifecycle aliases for timeline JSON state.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { defineTool, type AnyTool } from "../define-tool.js";
import { Project } from "../../engine/index.js";
import { loadProject } from "./_project-io.js";

export const projectCreateTool = defineTool({
  name: "project_create",
  category: "project",
  cost: "free",
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
  projectCreateTool as unknown as AnyTool,
  projectInfoTool as unknown as AnyTool,
];
