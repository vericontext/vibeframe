import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Project, type ProjectFile } from "@vibeframe/cli/engine";

// Helper to load project
async function loadProject(projectPath: string): Promise<Project> {
  const absPath = resolve(process.cwd(), projectPath);
  const content = await readFile(absPath, "utf-8");
  const data: ProjectFile = JSON.parse(content);
  return Project.fromJSON(data);
}

// Helper to save project
async function saveProject(projectPath: string, project: Project): Promise<void> {
  const absPath = resolve(process.cwd(), projectPath);
  await writeFile(absPath, JSON.stringify(project.toJSON(), null, 2), "utf-8");
}

export { loadProject, saveProject };

export const projectTools = [
  {
    name: "project_create",
    description: "Create a new VibeFrame project file",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Project name" },
        outputPath: { type: "string", description: "Output file path (defaults to {name}.vibe.json)" },
        width: { type: "number", description: "Video width in pixels (default: 1920)" },
        height: { type: "number", description: "Video height in pixels (default: 1080)" },
        fps: { type: "number", description: "Frames per second (default: 30)" },
      },
      required: ["name"],
    },
  },
  {
    name: "project_info",
    description: "Get information about a VibeFrame project",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the .vibe.json project file" },
      },
      required: ["projectPath"],
    },
  },
];

export async function handleProjectToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "project_create": {
      const projectName = args.name as string;
      const outputPath = (args.outputPath as string) || `${projectName}.vibe.json`;
      const project = new Project(projectName);
      if (args.fps) {
        project.setFrameRate(args.fps as number);
      }
      await saveProject(outputPath, project);
      return `Created project "${projectName}" at ${outputPath}`;
    }

    case "project_info": {
      const project = await loadProject(args.projectPath as string);
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
      return JSON.stringify(info, null, 2);
    }

    default:
      throw new Error(`Unknown project tool: ${name}`);
  }
}
