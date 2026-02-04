/**
 * Project Tools - Create, open, save, and manage projects
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "../../engine/index.js";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult, AgentContext } from "../types.js";

// Tool Definitions
const projectCreateDef: ToolDefinition = {
  name: "project_create",
  description: "Create a new video project",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Project name",
      },
      output: {
        type: "string",
        description: "Output file path (default: ./project.vibe.json)",
      },
      aspectRatio: {
        type: "string",
        description: "Aspect ratio (16:9, 9:16, 1:1, 4:5)",
        enum: ["16:9", "9:16", "1:1", "4:5"],
      },
      fps: {
        type: "number",
        description: "Frame rate (default: 30)",
      },
    },
    required: ["name"],
  },
};

const projectInfoDef: ToolDefinition = {
  name: "project_info",
  description: "Get information about a project",
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

// Helper function to resolve project path
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

// Tool Handlers
const projectCreate: ToolHandler = async (args, context): Promise<ToolResult> => {
  const name = args.name as string;
  const output = (args.output as string) || "./project.vibe.json";
  const aspectRatio = (args.aspectRatio as string) || "16:9";
  const fps = (args.fps as number) || 30;

  try {
    const project = new Project(name);
    project.setAspectRatio(aspectRatio as "16:9" | "9:16" | "1:1" | "4:5");
    project.setFrameRate(fps);

    const outputPath = resolve(context.workingDirectory, output);
    const data = JSON.stringify(project.toJSON(), null, 2);
    await writeFile(outputPath, data, "utf-8");

    // Update context
    context.projectPath = outputPath;

    return {
      toolCallId: "",
      success: true,
      output: `Project created: ${outputPath}\nName: ${name}\nAspect Ratio: ${aspectRatio}\nFrame Rate: ${fps} fps`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to create project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const projectInfo: ToolHandler = async (args, context): Promise<ToolResult> => {
  const path = args.path as string;

  try {
    const filePath = await resolveProjectPath(path, context.workingDirectory);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    const summary = project.getSummary();
    const meta = project.getMeta();

    const info = [
      `Project: ${summary.name}`,
      `Duration: ${summary.duration.toFixed(1)}s`,
      `Aspect Ratio: ${summary.aspectRatio}`,
      `Frame Rate: ${summary.frameRate} fps`,
      `Tracks: ${summary.trackCount}`,
      `Clips: ${summary.clipCount}`,
      `Sources: ${summary.sourceCount}`,
      `Created: ${meta.createdAt.toLocaleString()}`,
      `Updated: ${meta.updatedAt.toLocaleString()}`,
    ].join("\n");

    return {
      toolCallId: "",
      success: true,
      output: info,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to load project: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const projectSet: ToolHandler = async (args, context): Promise<ToolResult> => {
  const path = args.path as string;
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
  const path = args.path as string;

  try {
    const filePath = await resolveProjectPath(path, context.workingDirectory);
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    const project = Project.fromJSON(data);

    // Update context
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

    // Update timestamp and save
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

// Registration function
export function registerProjectTools(registry: ToolRegistry): void {
  registry.register(projectCreateDef, projectCreate);
  registry.register(projectInfoDef, projectInfo);
  registry.register(projectSetDef, projectSet);
  registry.register(projectOpenDef, projectOpen);
  registry.register(projectSaveDef, projectSave);
}
