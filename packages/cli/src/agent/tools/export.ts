/**
 * Export Tools — agent-only `export_audio`, `export_subtitles` stubs.
 *
 * After v0.66 PR2 the working `export_video` definition lives in the
 * manifest. The remaining two are still stubs ("not yet implemented");
 * they're kept here until we either remove them entirely or wire them up.
 */

import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";

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

const exportAudio: ToolHandler = async (_args, _context): Promise<ToolResult> => {
  return {
    toolCallId: "",
    success: false,
    output: "",
    error: "Audio-only export not yet implemented. Use export_video and extract audio with FFmpeg: ffmpeg -i video.mp4 -vn -acodec mp3 audio.mp3",
  };
};

const exportSubtitles: ToolHandler = async (_args, _context): Promise<ToolResult> => {
  return {
    toolCallId: "",
    success: false,
    output: "",
    error: "Subtitle export not yet implemented. Use audio_transcribe to generate subtitles from audio.",
  };
};

export function registerExportTools(registry: ToolRegistry): void {
  registry.register(exportAudioDef, exportAudio);
  registry.register(exportSubtitlesDef, exportSubtitles);
}
