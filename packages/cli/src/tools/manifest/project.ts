/**
 * @module manifest/project
 * @description Workspace project listing for scene-based video projects.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { defineTool, type AnyTool, failedTool } from "../define-tool.js";
import { executeProjectList } from "../../commands/_shared/project-list.js";

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
      return failedTool(result, "project list failed");
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

export const projectTools: readonly AnyTool[] = [
  projectListTool as unknown as AnyTool,
];
