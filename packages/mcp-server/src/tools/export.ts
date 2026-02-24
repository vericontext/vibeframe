import { runExport } from "@vibeframe/cli/commands/export";

export const exportTools = [
  {
    name: "export_video",
    description: "Export a VibeFrame project to a video file (MP4, WebM, or MOV). Requires FFmpeg.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Path to the .vibe.json project file" },
        outputPath: { type: "string", description: "Output video file path (e.g., output.mp4)" },
        preset: {
          type: "string",
          enum: ["draft", "standard", "high", "ultra"],
          description: "Quality preset (default: standard)",
        },
        format: {
          type: "string",
          enum: ["mp4", "webm", "mov"],
          description: "Output format (default: mp4)",
        },
        overwrite: { type: "boolean", description: "Overwrite existing output file (default: false)" },
      },
      required: ["projectPath", "outputPath"],
    },
  },
];

export async function handleExportToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "export_video": {
      const result = await runExport(
        args.projectPath as string,
        args.outputPath as string,
        {
          preset: args.preset as "draft" | "standard" | "high" | "ultra" | undefined,
          format: args.format as "mp4" | "webm" | "mov" | undefined,
          overwrite: args.overwrite as boolean | undefined,
        }
      );
      return result.success
        ? `Exported video: ${result.outputPath || args.outputPath}`
        : `Export failed: ${result.message}`;
    }

    default:
      throw new Error(`Unknown export tool: ${name}`);
  }
}
