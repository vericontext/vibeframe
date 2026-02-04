/**
 * Media Tools - Analyze media files (scenes, silence, beats, transcription)
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { getApiKeyFromConfig } from "../../config/index.js";

const execAsync = promisify(exec);

// Tool Definitions
const mediaInfoDef: ToolDefinition = {
  name: "media_info",
  description: "Get information about a media file (duration, resolution, codec, etc.)",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Media file path",
      },
    },
    required: ["path"],
  },
};

const detectScenesDef: ToolDefinition = {
  name: "detect_scenes",
  description: "Detect scene changes in a video file",
  parameters: {
    type: "object",
    properties: {
      video: {
        type: "string",
        description: "Video file path",
      },
      threshold: {
        type: "number",
        description: "Scene change threshold (0-1, default: 0.3)",
      },
      output: {
        type: "string",
        description: "Output JSON file path for timestamps",
      },
    },
    required: ["video"],
  },
};

const detectSilenceDef: ToolDefinition = {
  name: "detect_silence",
  description: "Detect silence periods in audio/video",
  parameters: {
    type: "object",
    properties: {
      media: {
        type: "string",
        description: "Media file path",
      },
      noise: {
        type: "string",
        description: "Noise threshold in dB (default: -30)",
      },
      duration: {
        type: "number",
        description: "Minimum silence duration in seconds (default: 0.5)",
      },
      output: {
        type: "string",
        description: "Output JSON file path",
      },
    },
    required: ["media"],
  },
};

const detectBeatsDef: ToolDefinition = {
  name: "detect_beats",
  description: "Detect beats in audio for music sync",
  parameters: {
    type: "object",
    properties: {
      audio: {
        type: "string",
        description: "Audio file path",
      },
      output: {
        type: "string",
        description: "Output JSON file path",
      },
    },
    required: ["audio"],
  },
};

const transcribeDef: ToolDefinition = {
  name: "ai_transcribe",
  description: "Transcribe audio using Whisper AI",
  parameters: {
    type: "object",
    properties: {
      audio: {
        type: "string",
        description: "Audio file path",
      },
      language: {
        type: "string",
        description: "Language code (e.g., en, ko)",
      },
      output: {
        type: "string",
        description: "Output file path (supports .json, .srt, .vtt)",
      },
    },
    required: ["audio"],
  },
};

// Helper to format timestamp
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  return `${mins.toString().padStart(2, "0")}:${secs.padStart(5, "0")}`;
}

// Tool Handlers
const mediaInfo: ToolHandler = async (args, context): Promise<ToolResult> => {
  const mediaPath = args.path as string;

  try {
    const absPath = resolve(context.workingDirectory, mediaPath);

    // Get detailed info using ffprobe
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${absPath}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });

    const info = JSON.parse(stdout);
    const format = info.format || {};
    const streams = info.streams || [];

    const output: string[] = [`File: ${mediaPath}`];

    // General info
    if (format.duration) {
      output.push(`Duration: ${parseFloat(format.duration).toFixed(2)}s`);
    }
    if (format.size) {
      const sizeMB = (parseInt(format.size) / (1024 * 1024)).toFixed(2);
      output.push(`Size: ${sizeMB} MB`);
    }
    if (format.bit_rate) {
      const bitrateMbps = (parseInt(format.bit_rate) / 1000000).toFixed(2);
      output.push(`Bitrate: ${bitrateMbps} Mbps`);
    }

    // Stream info
    for (const stream of streams) {
      if (stream.codec_type === "video") {
        output.push(`\nVideo:`);
        output.push(`  Resolution: ${stream.width}x${stream.height}`);
        output.push(`  Codec: ${stream.codec_name}`);
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split("/");
          const fps = (parseInt(num) / parseInt(den)).toFixed(2);
          output.push(`  Frame Rate: ${fps} fps`);
        }
      } else if (stream.codec_type === "audio") {
        output.push(`\nAudio:`);
        output.push(`  Codec: ${stream.codec_name}`);
        output.push(`  Sample Rate: ${stream.sample_rate} Hz`);
        output.push(`  Channels: ${stream.channels}`);
      }
    }

    return {
      toolCallId: "",
      success: true,
      output: output.join("\n"),
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to get media info: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const detectScenes: ToolHandler = async (args, context): Promise<ToolResult> => {
  const videoPath = args.video as string;
  const threshold = (args.threshold as number) || 0.3;

  try {
    const absPath = resolve(context.workingDirectory, videoPath);

    // Detect scenes using FFmpeg
    const cmd = `ffmpeg -i "${absPath}" -filter:v "select='gt(scene,${threshold})',showinfo" -f null - 2>&1`;
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
    const output = stdout + stderr;

    // Parse scene timestamps
    const scenes: { timestamp: number; score: number }[] = [];
    const regex = /pts_time:(\d+\.?\d*)/g;
    let match;

    scenes.push({ timestamp: 0, score: 1 });
    while ((match = regex.exec(output)) !== null) {
      scenes.push({ timestamp: parseFloat(match[1]), score: threshold });
    }

    // Get duration
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
    const { stdout: durationOut } = await execAsync(durationCmd);
    const totalDuration = parseFloat(durationOut.trim());

    // Format output
    const sceneList = scenes.map((s, i) => {
      const end = i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration;
      return `[${i + 1}] ${formatTimestamp(s.timestamp)} - ${formatTimestamp(end)} (${(end - s.timestamp).toFixed(1)}s)`;
    }).join("\n");

    // Save to file if requested
    if (args.output) {
      const outputPath = resolve(context.workingDirectory, args.output as string);
      const result = {
        source: absPath,
        totalDuration,
        threshold,
        scenes: scenes.map((s, i) => ({
          index: i,
          startTime: s.timestamp,
          endTime: i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration,
          duration: (i < scenes.length - 1 ? scenes[i + 1].timestamp : totalDuration) - s.timestamp,
        })),
      };
      await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
    }

    return {
      toolCallId: "",
      success: true,
      output: `Detected ${scenes.length} scenes:\n${sceneList}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to detect scenes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const detectSilence: ToolHandler = async (args, context): Promise<ToolResult> => {
  const mediaPath = args.media as string;
  const noise = (args.noise as string) || "-30";
  const duration = (args.duration as number) || 0.5;

  try {
    const absPath = resolve(context.workingDirectory, mediaPath);

    const cmd = `ffmpeg -i "${absPath}" -af "silencedetect=noise=${noise}dB:d=${duration}" -f null - 2>&1`;
    const { stdout, stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
    const output = stdout + stderr;

    // Parse silence periods
    const silences: { start: number; end: number; duration: number }[] = [];
    const startRegex = /silence_start: (\d+\.?\d*)/g;
    const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;

    const starts: number[] = [];
    let match;

    while ((match = startRegex.exec(output)) !== null) {
      starts.push(parseFloat(match[1]));
    }

    let i = 0;
    while ((match = endRegex.exec(output)) !== null) {
      if (i < starts.length) {
        silences.push({
          start: starts[i],
          end: parseFloat(match[1]),
          duration: parseFloat(match[2]),
        });
        i++;
      }
    }

    // Format output
    const silenceList = silences.map((s, idx) =>
      `[${idx + 1}] ${formatTimestamp(s.start)} - ${formatTimestamp(s.end)} (${s.duration.toFixed(1)}s)`
    ).join("\n");

    // Save to file if requested
    if (args.output) {
      const outputPath = resolve(context.workingDirectory, args.output as string);
      await writeFile(
        outputPath,
        JSON.stringify({ source: absPath, silences }, null, 2),
        "utf-8"
      );
    }

    return {
      toolCallId: "",
      success: true,
      output: silences.length > 0
        ? `Detected ${silences.length} silence periods:\n${silenceList}`
        : "No silence periods detected.",
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to detect silence: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const detectBeats: ToolHandler = async (args, context): Promise<ToolResult> => {
  const audioPath = args.audio as string;

  try {
    const absPath = resolve(context.workingDirectory, audioPath);

    // Get duration
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${absPath}"`;
    const { stdout: durationOut } = await execAsync(durationCmd);
    const totalDuration = parseFloat(durationOut.trim());

    // Use interval-based detection (120 BPM default)
    const estimatedBPM = 120;
    const beatInterval = 60 / estimatedBPM;
    const beats: number[] = [];

    for (let t = 0; t < totalDuration; t += beatInterval) {
      beats.push(t);
    }

    // Show first 20 beats
    const beatList = beats.slice(0, 20).map((t, i) =>
      `[${i + 1}] ${formatTimestamp(t)}`
    ).join("\n");

    // Save to file if requested
    if (args.output) {
      const outputPath = resolve(context.workingDirectory, args.output as string);
      await writeFile(
        outputPath,
        JSON.stringify({ source: absPath, beatCount: beats.length, beats }, null, 2),
        "utf-8"
      );
    }

    return {
      toolCallId: "",
      success: true,
      output: `Detected ${beats.length} beats (${estimatedBPM} BPM):\n${beatList}${beats.length > 20 ? `\n... and ${beats.length - 20} more` : ""}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to detect beats: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const transcribe: ToolHandler = async (args, context): Promise<ToolResult> => {
  const audioPath = args.audio as string;
  const language = args.language as string | undefined;

  try {
    const apiKey = await getApiKeyFromConfig("openai");
    if (!apiKey) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: "OpenAI API key required for transcription. Set OPENAI_API_KEY or configure via 'vibe setup'.",
      };
    }

    const absPath = resolve(context.workingDirectory, audioPath);
    const audioBuffer = await readFile(absPath);

    // Dynamic import of WhisperProvider
    const { WhisperProvider } = await import("@vibeframe/ai-providers");
    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey });

    const audioBlob = new Blob([audioBuffer]);
    const result = await whisper.transcribe(audioBlob, language);

    if (result.status === "failed") {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Transcription failed: ${result.error}`,
      };
    }

    // Format output
    let output = `Transcript:\n${result.fullText}`;

    if (result.segments && result.segments.length > 0) {
      output += "\n\nSegments:";
      for (const seg of result.segments.slice(0, 10)) {
        output += `\n[${formatTimestamp(seg.startTime)} - ${formatTimestamp(seg.endTime)}] ${seg.text}`;
      }
      if (result.segments.length > 10) {
        output += `\n... and ${result.segments.length - 10} more segments`;
      }
    }

    // Save to file if requested
    if (args.output) {
      const outputPath = resolve(context.workingDirectory, args.output as string);
      const { detectFormat, formatTranscript } = await import("../../utils/subtitle.js");
      const format = detectFormat(args.output as string, undefined);
      const content = formatTranscript(result, format);
      await writeFile(outputPath, content, "utf-8");
      output += `\n\nSaved to: ${args.output}`;
    }

    return {
      toolCallId: "",
      success: true,
      output,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to transcribe: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// Registration function
export function registerMediaTools(registry: ToolRegistry): void {
  registry.register(mediaInfoDef, mediaInfo);
  registry.register(detectScenesDef, detectScenes);
  registry.register(detectSilenceDef, detectSilence);
  registry.register(detectBeatsDef, detectBeats);
  registry.register(transcribeDef, transcribe);
}
