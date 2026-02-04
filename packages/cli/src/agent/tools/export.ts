/**
 * Export Tools - Export projects to video, audio, or subtitles
 */

import { resolve, basename } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { runExport } from "../../commands/export.js";

// Tool Definitions
const exportVideoDef: ToolDefinition = {
  name: "export_video",
  description: "Export a project to a video file",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      output: {
        type: "string",
        description: "Output video file path",
      },
      format: {
        type: "string",
        description: "Output format (mp4, webm, mov)",
        enum: ["mp4", "webm", "mov"],
      },
      preset: {
        type: "string",
        description: "Quality preset (draft, standard, high, ultra)",
        enum: ["draft", "standard", "high", "ultra"],
      },
      overwrite: {
        type: "boolean",
        description: "Overwrite existing file",
      },
    },
    required: ["project"],
  },
};

const exportAudioDef: ToolDefinition = {
  name: "export_audio",
  description: "Export audio track from a project",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      output: {
        type: "string",
        description: "Output audio file path",
      },
      format: {
        type: "string",
        description: "Output format (mp3, wav, aac)",
        enum: ["mp3", "wav", "aac"],
      },
    },
    required: ["project"],
  },
};

const exportSubtitlesDef: ToolDefinition = {
  name: "export_subtitles",
  description: "Export subtitles from transcription",
  parameters: {
    type: "object",
    properties: {
      project: {
        type: "string",
        description: "Project file path",
      },
      output: {
        type: "string",
        description: "Output subtitle file path",
      },
      format: {
        type: "string",
        description: "Subtitle format (srt, vtt)",
        enum: ["srt", "vtt"],
      },
    },
    required: ["project"],
  },
};

// Tool Handlers
const exportVideo: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const format = (args.format as string) || "mp4";
  const preset = (args.preset as "draft" | "standard" | "high" | "ultra") || "standard";
  const overwrite = (args.overwrite as boolean) || false;

  // Determine output path
  const output = (args.output as string) ||
    `${basename(projectPath, ".vibe.json")}.${format}`;

  const absProjectPath = resolve(context.workingDirectory, projectPath);
  const absOutputPath = resolve(context.workingDirectory, output);

  try {
    const result = await runExport(absProjectPath, absOutputPath, {
      format: format as "mp4" | "webm" | "mov",
      preset,
      overwrite,
    });

    if (!result.success) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: result.message,
      };
    }

    return {
      toolCallId: "",
      success: true,
      output: `Video exported: ${output}\nFormat: ${format}\nPreset: ${preset}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to export video: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const exportAudio: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const format = (args.format as string) || "mp3";
  const output = (args.output as string) ||
    `${basename(projectPath, ".vibe.json")}.${format}`;

  try {
    // Audio export would be implemented similarly to video export
    // For now, provide a helpful message
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "Audio-only export not yet implemented. Use export_video and extract audio with FFmpeg: ffmpeg -i video.mp4 -vn -acodec mp3 audio.mp3",
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to export audio: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const exportSubtitles: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectPath = args.project as string;
  const format = (args.format as string) || "srt";
  const output = (args.output as string) ||
    `${basename(projectPath, ".vibe.json")}.${format}`;

  try {
    // Subtitle export would extract transcription data from project
    // For now, provide a helpful message
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "Subtitle export not yet implemented. Use ai_transcribe to generate subtitles from audio: ai_transcribe audio.mp3 --output subtitles.srt",
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to export subtitles: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// Registration function
export function registerExportTools(registry: ToolRegistry): void {
  registry.register(exportVideoDef, exportVideo);
  registry.register(exportAudioDef, exportAudio);
  registry.register(exportSubtitlesDef, exportSubtitles);
}
