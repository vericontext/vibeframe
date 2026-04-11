import {
  executeGrade,
  executeSpeedRamp,
  executeReframe,
  executeInterpolate,
  executeUpscale,
} from "@vibeframe/cli/commands/edit-cmd";

export const aiEditAdvancedTools = [
  {
    name: "edit_grade",
    description: "Apply AI-generated color grading using Claude + FFmpeg. Use preset for free built-in grades, or style for custom AI-generated grades (needs ANTHROPIC_API_KEY).",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Input video file path" },
        style: { type: "string", description: "Custom style description (e.g., 'cinematic warm sunset')" },
        preset: {
          type: "string",
          enum: ["film-noir", "vintage", "cinematic-warm", "cool-tones", "high-contrast", "pastel", "cyberpunk", "horror"],
          description: "Built-in preset (no API key needed)",
        },
        output: { type: "string", description: "Output video file path" },
        analyzeOnly: { type: "boolean", description: "Show FFmpeg filter without applying" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "edit_speed_ramp",
    description: "Apply content-aware speed ramping. Analyzes speech with Whisper, plans speed changes with Claude, applies with FFmpeg. Requires OPENAI_API_KEY + ANTHROPIC_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Input video file path (must have audio)" },
        output: { type: "string", description: "Output video file path" },
        style: {
          type: "string",
          enum: ["dramatic", "smooth", "action"],
          description: "Speed ramp style (default: dramatic)",
        },
        minSpeed: { type: "number", description: "Minimum speed factor (default: 0.25)" },
        maxSpeed: { type: "number", description: "Maximum speed factor (default: 4.0)" },
        analyzeOnly: { type: "boolean", description: "Show keyframes without applying" },
        language: { type: "string", description: "Language code for transcription" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "edit_reframe",
    description: "Auto-reframe video to a different aspect ratio using smart cropping. Free (FFmpeg only).",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Input video file path" },
        aspect: { type: "string", description: "Target aspect ratio: 9:16, 1:1, 4:5 (default: 9:16)" },
        focus: {
          type: "string",
          enum: ["auto", "face", "center", "action"],
          description: "Focus mode (default: auto)",
        },
        output: { type: "string", description: "Output video file path" },
        analyzeOnly: { type: "boolean", description: "Show crop region without applying" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "edit_interpolate",
    description: "Create slow motion with AI frame interpolation using FFmpeg minterpolate. Free, no API key needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Input video file path" },
        output: { type: "string", description: "Output video file path" },
        factor: { type: "number", description: "Slow motion factor: 2, 4, or 8 (default: 2)" },
        fps: { type: "number", description: "Target output FPS (default: auto)" },
        quality: {
          type: "string",
          enum: ["fast", "quality"],
          description: "Interpolation quality (default: quality)",
        },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "edit_upscale",
    description: "Upscale video resolution using FFmpeg (Lanczos scaling). Free, no API key needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Input video file path" },
        output: { type: "string", description: "Output video file path" },
        scale: { type: "number", description: "Scale factor: 2 or 4 (default: 2)" },
        quality: {
          type: "string",
          enum: ["fast", "quality"],
          description: "Scaling quality (default: quality, uses Lanczos)",
        },
      },
      required: ["videoPath"],
    },
  },
];

export async function handleAiEditAdvancedToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "edit_grade": {
      const result = await executeGrade({
        videoPath: args.videoPath as string,
        style: args.style as string | undefined,
        preset: args.preset as string | undefined,
        output: args.output as string | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
      });
      if (!result.success) return `Color grading failed: ${result.error}`;
      return JSON.stringify({ success: true, outputPath: result.outputPath, style: result.style, description: result.description, ffmpegFilter: result.ffmpegFilter });
    }

    case "edit_speed_ramp": {
      const result = await executeSpeedRamp({
        videoPath: args.videoPath as string,
        output: args.output as string | undefined,
        style: args.style as "dramatic" | "smooth" | "action" | undefined,
        minSpeed: args.minSpeed as number | undefined,
        maxSpeed: args.maxSpeed as number | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
        language: args.language as string | undefined,
      });
      if (!result.success) return `Speed ramping failed: ${result.error}`;
      return JSON.stringify({ success: true, outputPath: result.outputPath, keyframeCount: result.keyframes?.length, avgSpeed: result.avgSpeed });
    }

    case "edit_reframe": {
      const result = await executeReframe({
        videoPath: args.videoPath as string,
        aspect: args.aspect as string | undefined,
        focus: args.focus as "auto" | "face" | "center" | "action" | undefined,
        output: args.output as string | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
      });
      if (!result.success) return `Reframe failed: ${result.error}`;
      return JSON.stringify({ success: true, outputPath: result.outputPath, sourceAspect: result.sourceAspect, targetAspect: result.targetAspect });
    }

    case "edit_interpolate": {
      const result = await executeInterpolate({
        videoPath: args.videoPath as string,
        output: args.output as string | undefined,
        factor: args.factor as number | undefined,
        fps: args.fps as number | undefined,
        quality: args.quality as "fast" | "quality" | undefined,
      });
      if (!result.success) return `Interpolation failed: ${result.error}`;
      return JSON.stringify({ success: true, outputPath: result.outputPath, originalFps: result.originalFps, targetFps: result.targetFps, factor: result.factor });
    }

    case "edit_upscale": {
      const result = await executeUpscale({
        videoPath: args.videoPath as string,
        output: args.output as string | undefined,
        scale: args.scale as number | undefined,
        quality: args.quality as "fast" | "quality" | undefined,
      });
      if (!result.success) return `Upscale failed: ${result.error}`;
      return JSON.stringify({ success: true, outputPath: result.outputPath, originalRes: result.originalRes, targetRes: result.targetRes });
    }

    default:
      throw new Error(`Unknown advanced edit tool: ${name}`);
  }
}
