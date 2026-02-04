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

// Media Manipulation Tools

const compressDef: ToolDefinition = {
  name: "media_compress",
  description: "Compress a video or audio file using FFmpeg",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Input media file path",
      },
      output: {
        type: "string",
        description: "Output file path (default: input-compressed.ext)",
      },
      quality: {
        type: "string",
        description: "Quality preset: low, medium (default), high",
        enum: ["low", "medium", "high"],
      },
      maxSize: {
        type: "string",
        description: "Target max file size (e.g., '10M', '100M')",
      },
    },
    required: ["input"],
  },
};

const convertDef: ToolDefinition = {
  name: "media_convert",
  description: "Convert media file to a different format using FFmpeg",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Input media file path",
      },
      output: {
        type: "string",
        description: "Output file path with desired extension (e.g., 'video.webm')",
      },
      codec: {
        type: "string",
        description: "Video codec (h264, h265, vp9, av1)",
      },
      audioCodec: {
        type: "string",
        description: "Audio codec (aac, mp3, opus)",
      },
    },
    required: ["input", "output"],
  },
};

const concatDef: ToolDefinition = {
  name: "media_concat",
  description: "Concatenate multiple media files into one using FFmpeg",
  parameters: {
    type: "object",
    properties: {
      inputs: {
        type: "array",
        items: { type: "string", description: "Input file path" },
        description: "Array of input file paths to concatenate",
      },
      output: {
        type: "string",
        description: "Output file path",
      },
      reencode: {
        type: "boolean",
        description: "Re-encode files (slower but works with different codecs)",
      },
    },
    required: ["inputs", "output"],
  },
};

const compress: ToolHandler = async (args, context): Promise<ToolResult> => {
  const inputPath = args.input as string;
  const quality = (args.quality as string) || "medium";
  const maxSize = args.maxSize as string | undefined;

  try {
    const absInput = resolve(context.workingDirectory, inputPath);
    const ext = inputPath.split(".").pop() || "mp4";
    const baseName = inputPath.replace(/\.[^/.]+$/, "");
    const outputPath = args.output
      ? resolve(context.workingDirectory, args.output as string)
      : resolve(context.workingDirectory, `${baseName}-compressed.${ext}`);

    // Quality presets (CRF values - lower = better quality, larger file)
    const crfValues: Record<string, number> = {
      low: 28,
      medium: 23,
      high: 18,
    };
    const crf = crfValues[quality] || 23;

    let cmd: string;
    if (maxSize) {
      // Two-pass encoding for target size
      cmd = `ffmpeg -i "${absInput}" -c:v libx264 -crf ${crf} -preset medium -c:a aac -b:a 128k "${outputPath}" -y`;
    } else {
      cmd = `ffmpeg -i "${absInput}" -c:v libx264 -crf ${crf} -preset medium -c:a aac -b:a 128k "${outputPath}" -y`;
    }

    const { stderr } = await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

    // Get file sizes for comparison
    const inputStats = await readFile(absInput);
    const outputStats = await readFile(outputPath);
    const inputSize = inputStats.length;
    const outputSize = outputStats.length;
    const reduction = (((inputSize - outputSize) / inputSize) * 100).toFixed(1);

    return {
      toolCallId: "",
      success: true,
      output: `Compressed: ${inputPath} → ${outputPath}\nSize: ${formatSize(inputSize)} → ${formatSize(outputSize)} (${reduction}% reduction)`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to compress: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const convert: ToolHandler = async (args, context): Promise<ToolResult> => {
  const inputPath = args.input as string;
  const outputPath = args.output as string;
  const codec = args.codec as string | undefined;
  const audioCodec = args.audioCodec as string | undefined;

  try {
    const absInput = resolve(context.workingDirectory, inputPath);
    const absOutput = resolve(context.workingDirectory, outputPath);

    // Build codec options
    let videoOpt = "-c:v copy";
    let audioOpt = "-c:a copy";

    if (codec) {
      const codecMap: Record<string, string> = {
        h264: "libx264",
        h265: "libx265",
        vp9: "libvpx-vp9",
        av1: "libaom-av1",
      };
      videoOpt = `-c:v ${codecMap[codec] || codec}`;
    }

    if (audioCodec) {
      const audioCodecMap: Record<string, string> = {
        aac: "aac",
        mp3: "libmp3lame",
        opus: "libopus",
      };
      audioOpt = `-c:a ${audioCodecMap[audioCodec] || audioCodec}`;
    }

    const cmd = `ffmpeg -i "${absInput}" ${videoOpt} ${audioOpt} "${absOutput}" -y`;
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });

    return {
      toolCallId: "",
      success: true,
      output: `Converted: ${inputPath} → ${outputPath}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to convert: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const concat: ToolHandler = async (args, context): Promise<ToolResult> => {
  const inputs = args.inputs as string[];
  const outputPath = args.output as string;
  const reencode = args.reencode as boolean || false;

  if (!inputs || inputs.length < 2) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: "At least 2 input files required for concatenation",
    };
  }

  try {
    const absOutput = resolve(context.workingDirectory, outputPath);

    if (reencode) {
      // Re-encode method - works with different codecs
      const inputArgs = inputs
        .map((i) => `-i "${resolve(context.workingDirectory, i)}"`)
        .join(" ");
      const filterComplex = inputs.map((_, i) => `[${i}:v][${i}:a]`).join("");
      const cmd = `ffmpeg ${inputArgs} -filter_complex "${filterComplex}concat=n=${inputs.length}:v=1:a=1[outv][outa]" -map "[outv]" -map "[outa]" "${absOutput}" -y`;
      await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });
    } else {
      // Concat demuxer method - fast but requires same codec
      const tempList = resolve(context.workingDirectory, `concat-list-${Date.now()}.txt`);
      const listContent = inputs
        .map((i) => `file '${resolve(context.workingDirectory, i)}'`)
        .join("\n");
      await writeFile(tempList, listContent, "utf-8");

      const cmd = `ffmpeg -f concat -safe 0 -i "${tempList}" -c copy "${absOutput}" -y`;
      await execAsync(cmd, { maxBuffer: 100 * 1024 * 1024 });

      // Clean up temp file
      const { unlink } = await import("node:fs/promises");
      await unlink(tempList).catch(() => {});
    }

    return {
      toolCallId: "",
      success: true,
      output: `Concatenated ${inputs.length} files → ${outputPath}`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `Failed to concatenate: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

// Helper function
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

// Registration function
export function registerMediaTools(registry: ToolRegistry): void {
  registry.register(mediaInfoDef, mediaInfo);
  registry.register(detectScenesDef, detectScenes);
  registry.register(detectSilenceDef, detectSilence);
  registry.register(detectBeatsDef, detectBeats);
  registry.register(transcribeDef, transcribe);
  registry.register(compressDef, compress);
  registry.register(convertDef, convert);
  registry.register(concatDef, concat);
}
