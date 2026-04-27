/**
 * @module manifest/export
 * @description Export tool — renders a `.vibe.json` project to MP4/WebM/MOV
 * via FFmpeg.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { defineTool, type AnyTool } from "../define-tool.js";
import { runExport } from "../../commands/export.js";

export const exportVideoTool = defineTool({
  name: "export_video",
  category: "export",
  cost: "free",
  description:
    "Export a VibeFrame project to a video file (MP4, WebM, or MOV). Requires FFmpeg.",
  schema: z.object({
    projectPath: z.string().describe("Path to the .vibe.json project file"),
    outputPath: z.string().describe("Output video file path (e.g., output.mp4)"),
    preset: z.enum(["draft", "standard", "high", "ultra"]).optional().describe("Quality preset (default: standard)"),
    format: z.enum(["mp4", "webm", "mov"]).optional().describe("Output format (default: mp4)"),
    overwrite: z.boolean().optional().describe("Overwrite existing output file (default: false)"),
  }),
  async execute(args, ctx) {
    const projectPath = resolve(ctx.workingDirectory, args.projectPath);
    const outputPath = resolve(ctx.workingDirectory, args.outputPath);
    const result = await runExport(projectPath, outputPath, {
      preset: args.preset,
      format: args.format,
      overwrite: args.overwrite,
    });
    if (!result.success) return { success: false, error: result.message ?? "Export failed" };
    return {
      success: true,
      data: { outputPath: result.outputPath ?? outputPath },
      humanLines: [`✅ Exported video: ${result.outputPath ?? outputPath}`],
    };
  },
});

export const exportTools: readonly AnyTool[] = [exportVideoTool as unknown as AnyTool];
