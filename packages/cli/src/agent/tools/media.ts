/**
 * Media Tools — agent-only FFmpeg wrappers (info / compress / convert / concat).
 *
 * After v0.66 PR2 the detect_* / audio_transcribe / audio_isolate /
 * audio_voice_clone / audio_dub / audio_duck definitions live in the
 * manifest (`packages/cli/src/tools/manifest`). The four tools that remain
 * here are pure FFmpeg wrappers with no manifest entry yet — they're
 * candidates for a future agent-only manifest pass.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import { execSafe } from "../../utils/exec-safe.js";

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

const mediaInfo: ToolHandler = async (args, context): Promise<ToolResult> => {
  const mediaPath = args.path as string;

  try {
    const absPath = resolve(context.workingDirectory, mediaPath);

    // Get detailed info using ffprobe
    const { stdout } = await execSafe("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath], { maxBuffer: 10 * 1024 * 1024 });

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

const compress: ToolHandler = async (args, context): Promise<ToolResult> => {
  const inputPath = args.input as string;
  const quality = (args.quality as string) || "medium";

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

    await execSafe("ffmpeg", ["-i", absInput, "-c:v", "libx264", "-crf", String(crf), "-preset", "medium", "-c:a", "aac", "-b:a", "128k", outputPath, "-y"], { maxBuffer: 50 * 1024 * 1024 });

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

    let videoCodecName = "copy";
    let audioCodecName = "copy";

    if (codec) {
      const codecMap: Record<string, string> = {
        h264: "libx264",
        h265: "libx265",
        vp9: "libvpx-vp9",
        av1: "libaom-av1",
      };
      videoCodecName = codecMap[codec] || codec;
    }

    if (audioCodec) {
      const audioCodecMap: Record<string, string> = {
        aac: "aac",
        mp3: "libmp3lame",
        opus: "libopus",
      };
      audioCodecName = audioCodecMap[audioCodec] || audioCodec;
    }

    await execSafe("ffmpeg", ["-i", absInput, "-c:v", videoCodecName, "-c:a", audioCodecName, absOutput, "-y"], { maxBuffer: 50 * 1024 * 1024 });

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
      const ffmpegArgs: string[] = [];
      for (const i of inputs) {
        ffmpegArgs.push("-i", resolve(context.workingDirectory, i));
      }
      const filterComplex = inputs.map((_, i) => `[${i}:v][${i}:a]`).join("");
      ffmpegArgs.push("-filter_complex", `${filterComplex}concat=n=${inputs.length}:v=1:a=1[outv][outa]`, "-map", "[outv]", "-map", "[outa]", absOutput, "-y");
      await execSafe("ffmpeg", ffmpegArgs, { maxBuffer: 100 * 1024 * 1024 });
    } else {
      // Concat demuxer method - fast but requires same codec
      const tempList = resolve(context.workingDirectory, `concat-list-${Date.now()}.txt`);
      const listContent = inputs
        .map((i) => `file '${resolve(context.workingDirectory, i)}'`)
        .join("\n");
      await writeFile(tempList, listContent, "utf-8");

      await execSafe("ffmpeg", ["-f", "concat", "-safe", "0", "-i", tempList, "-c", "copy", absOutput, "-y"], { maxBuffer: 100 * 1024 * 1024 });

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

export function registerMediaTools(registry: ToolRegistry): void {
  registry.register(mediaInfoDef, mediaInfo);
  registry.register(compressDef, compress);
  registry.register(convertDef, convert);
  registry.register(concatDef, concat);
}
