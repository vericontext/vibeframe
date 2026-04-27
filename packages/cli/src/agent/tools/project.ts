/**
 * Project Tools — agent-only `project_set`, `project_open`, `project_save`.
 *
 * After v0.66 PR2 the `project_create` and `project_info` definitions live
 * in the manifest. The remaining three operate on `AgentContext` (mutating
 * `context.projectPath` for open/save) so they're staying agent-only until
 * the manifest's ExecuteContext gains projectPath plumbing.
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";

const projectSetDef: ToolDefinition = {
  name: "project_set",
  description: "Update project settings",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project file path",
      },
      name: {
        type: "string",
        description: "New project name",
      },
      aspectRatio: {
        type: "string",
        description: "New aspect ratio",
        enum: ["16:9", "9:16", "1:1", "4:5"],
      },
      fps: {
        type: "number",
        description: "New frame rate",
      },
    },
    required: ["path"],
  },
};

const projectOpenDef: ToolDefinition = {
  name: "project_open",
  description: "Open an existing project and set it as the current context",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project file path",
      },
    },
    required: ["path"],
  },
};

const projectSaveDef: ToolDefinition = {
  name: "project_save",
  description: "Save the current project",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project file path (uses context if not provided)",
      },
    },
    required: [],
  },
};

async function resolveProjectPath(inputPath: string, cwd: string): Promise<string> {
  const filePath = resolve(cwd, inputPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist - will be handled by caller
  }

  return filePath;
}

const projectSet: ToolHandler = async (args, context): Promise<ToolResult> => {
  const path = (args.path || args.project) as string;
  const updates: string[] = [];

  try {
    const filePath = await resolveProjectPath(path, context.workingDirectory);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    if (args.name) {
      project.setName(args.name as string);
      updates.push(`Name: ${args.name}`);
    }
    if (args.aspectRatio) {
      project.setAspectRatio(args.aspectRatio as "16:9" | "9:16" | "1:1" | "4:5");
      updates.push(`Aspect Ratio: ${args.aspectRatio}`);
    }
    if (args.fps) {
      project.setFrameRate(args.fps as number);
      updates.push(`Frame Rate: ${args.fps} fps`);
    }

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    return {
      toolCallId: "",
      success: true,
      output: `Project updated:\n${updates.join("\n")}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to update project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const projectOpen: ToolHandler = async (args, context): Promise<ToolResult> => {
  const path = (args.path || args.project) as string;

  try {
    const filePath = await resolveProjectPath(path, context.workingDirectory);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    context.projectPath = filePath;

    const summary = project.getSummary();
    return {
      toolCallId: "",
      success: true,
      output: `Project opened: ${filePath}\nName: ${summary.name}\nClips: ${summary.clipCount}\nDuration: ${summary.duration.toFixed(1)}s`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to open project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const projectSave: ToolHandler = async (args, context): Promise<ToolResult> => {
  const path = (args.path as string) || context.projectPath;

  if (!path) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "No project path specified and no project in context",
    };
  }

  try {
    const filePath = await resolveProjectPath(path, context.workingDirectory);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    return {
      toolCallId: "",
      success: true,
      output: `Project saved: ${filePath}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to save project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

export function registerProjectTools(registry: ToolRegistry): void {
  registry.register(projectSetDef, projectSet);
  registry.register(projectOpenDef, projectOpen);
  registry.register(projectSaveDef, projectSave);
}
