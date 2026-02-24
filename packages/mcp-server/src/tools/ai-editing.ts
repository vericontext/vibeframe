import {
  executeSilenceCut,
  executeCaption,
  executeFade,
  executeNoiseReduce,
  executeJumpCut,
  executeTextOverlay,
  executeTranslateSrt,
} from "@vibeframe/cli/commands/ai-edit";

export const aiEditingTools = [
  {
    name: "edit_silence_cut",
    description: "Remove silent segments from a video using FFmpeg or Gemini AI detection. No API key needed for FFmpeg mode.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        outputPath: { type: "string", description: "Path for the output video" },
        noiseThreshold: { type: "number", description: "Silence detection threshold in dB (default: -30)" },
        minDuration: { type: "number", description: "Minimum silence duration in seconds to cut (default: 0.5)" },
        padding: { type: "number", description: "Padding around cuts in seconds (default: 0.1)" },
        analyzeOnly: { type: "boolean", description: "Only analyze without cutting (default: false)" },
        useGemini: { type: "boolean", description: "Use Gemini AI for smart silence detection (requires GOOGLE_API_KEY)" },
      },
      required: ["videoPath", "outputPath"],
    },
  },
  {
    name: "edit_caption",
    description: "Transcribe audio and burn styled captions into video. Requires OPENAI_API_KEY for Whisper transcription.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        outputPath: { type: "string", description: "Path for the output video" },
        style: {
          type: "string",
          enum: ["minimal", "bold", "outline", "karaoke"],
          description: "Caption style (default: minimal)",
        },
        fontSize: { type: "number", description: "Font size (default: 24)" },
        fontColor: { type: "string", description: "Font color (default: white)" },
        language: { type: "string", description: "Language code for transcription (default: en)" },
        position: {
          type: "string",
          enum: ["top", "center", "bottom"],
          description: "Caption position (default: bottom)",
        },
      },
      required: ["videoPath", "outputPath"],
    },
  },
  {
    name: "edit_fade",
    description: "Apply fade in/out effects to video and/or audio. No API key needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        outputPath: { type: "string", description: "Path for the output video" },
        fadeIn: { type: "number", description: "Fade-in duration in seconds (default: 1)" },
        fadeOut: { type: "number", description: "Fade-out duration in seconds (default: 1)" },
        audioOnly: { type: "boolean", description: "Apply fade to audio only" },
        videoOnly: { type: "boolean", description: "Apply fade to video only" },
      },
      required: ["videoPath", "outputPath"],
    },
  },
  {
    name: "edit_noise_reduce",
    description: "Reduce audio/video noise using FFmpeg filters. No API key needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        inputPath: { type: "string", description: "Path to the input media file" },
        outputPath: { type: "string", description: "Path for the output file" },
        strength: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Noise reduction strength (default: medium)",
        },
        noiseFloor: { type: "number", description: "Noise floor in dB" },
      },
      required: ["inputPath", "outputPath"],
    },
  },
  {
    name: "edit_jump_cut",
    description: "Remove filler words (um, uh, like, etc.) from video using Whisper transcription. Requires OPENAI_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        outputPath: { type: "string", description: "Path for the output video" },
        fillers: {
          type: "array",
          items: { type: "string" },
          description: "Custom filler words to detect (default: um, uh, like, you know, etc.)",
        },
        padding: { type: "number", description: "Padding around cuts in seconds (default: 0.05)" },
        language: { type: "string", description: "Language code (default: en)" },
        analyzeOnly: { type: "boolean", description: "Only analyze without cutting" },
      },
      required: ["videoPath", "outputPath"],
    },
  },
  {
    name: "edit_text_overlay",
    description: "Apply text overlays on video using FFmpeg drawtext. No API key needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        outputPath: { type: "string", description: "Path for the output video" },
        texts: {
          type: "array",
          items: { type: "string" },
          description: "Text strings to overlay",
        },
        style: {
          type: "string",
          enum: ["lower-third", "center-bold", "subtitle", "minimal"],
          description: "Text overlay style (default: lower-third)",
        },
        fontSize: { type: "number", description: "Font size" },
        fontColor: { type: "string", description: "Font color (default: white)" },
        fadeDuration: { type: "number", description: "Fade duration for text appearance in seconds" },
        startTime: { type: "number", description: "Start time for overlay in seconds" },
        endTime: { type: "number", description: "End time for overlay in seconds" },
      },
      required: ["videoPath", "outputPath", "texts"],
    },
  },
  {
    name: "edit_translate_srt",
    description: "Translate SRT subtitle files using Claude or OpenAI. Requires ANTHROPIC_API_KEY or OPENAI_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        srtPath: { type: "string", description: "Path to the input SRT file" },
        outputPath: { type: "string", description: "Path for the translated SRT file" },
        targetLanguage: { type: "string", description: "Target language (e.g., ko, ja, es, fr)" },
        provider: {
          type: "string",
          enum: ["claude", "openai"],
          description: "Translation provider (default: claude)",
        },
        sourceLanguage: { type: "string", description: "Source language (auto-detected if omitted)" },
      },
      required: ["srtPath", "outputPath", "targetLanguage"],
    },
  },
];

export async function handleAiEditingToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "edit_silence_cut": {
      const result = await executeSilenceCut({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        noiseThreshold: args.noiseThreshold as number | undefined,
        minDuration: args.minDuration as number | undefined,
        padding: args.padding as number | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
        useGemini: args.useGemini as boolean | undefined,
      });
      if (!result.success) return `Silence cut failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        method: result.method,
        totalDuration: result.totalDuration,
        silentDuration: result.silentDuration,
        silentPeriods: result.silentPeriods?.length,
      });
    }

    case "edit_caption": {
      const result = await executeCaption({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        style: args.style as "minimal" | "bold" | "outline" | "karaoke" | undefined,
        fontSize: args.fontSize as number | undefined,
        fontColor: args.fontColor as string | undefined,
        language: args.language as string | undefined,
        position: args.position as "top" | "center" | "bottom" | undefined,
      });
      if (!result.success) return `Caption failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        srtPath: result.srtPath,
        segmentCount: result.segmentCount,
      });
    }

    case "edit_fade": {
      const result = await executeFade({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        fadeIn: args.fadeIn as number | undefined,
        fadeOut: args.fadeOut as number | undefined,
        audioOnly: args.audioOnly as boolean | undefined,
        videoOnly: args.videoOnly as boolean | undefined,
      });
      if (!result.success) return `Fade failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        totalDuration: result.totalDuration,
        fadeInApplied: result.fadeInApplied,
        fadeOutApplied: result.fadeOutApplied,
      });
    }

    case "edit_noise_reduce": {
      const result = await executeNoiseReduce({
        inputPath: args.inputPath as string,
        outputPath: args.outputPath as string,
        strength: args.strength as "low" | "medium" | "high" | undefined,
        noiseFloor: args.noiseFloor as number | undefined,
      });
      if (!result.success) return `Noise reduction failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        inputDuration: result.inputDuration,
      });
    }

    case "edit_jump_cut": {
      const result = await executeJumpCut({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        fillers: args.fillers as string[] | undefined,
        padding: args.padding as number | undefined,
        language: args.language as string | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
      });
      if (!result.success) return `Jump cut failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        totalDuration: result.totalDuration,
        fillerCount: result.fillerCount,
        fillerDuration: result.fillerDuration,
      });
    }

    case "edit_text_overlay": {
      const result = await executeTextOverlay({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        texts: args.texts as string[],
        style: args.style as "lower-third" | "center-bold" | "subtitle" | "minimal" | undefined,
        fontSize: args.fontSize as number | undefined,
        fontColor: args.fontColor as string | undefined,
        fadeDuration: args.fadeDuration as number | undefined,
        startTime: args.startTime as number | undefined,
        endTime: args.endTime as number | undefined,
      });
      if (!result.success) return `Text overlay failed: ${result.error}`;
      return JSON.stringify({ outputPath: result.outputPath });
    }

    case "edit_translate_srt": {
      const result = await executeTranslateSrt({
        srtPath: args.srtPath as string,
        outputPath: args.outputPath as string,
        targetLanguage: args.targetLanguage as string,
        provider: args.provider as "claude" | "openai" | undefined,
        sourceLanguage: args.sourceLanguage as string | undefined,
      });
      if (!result.success) return `Translation failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        segmentCount: result.segmentCount,
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
      });
    }

    default:
      throw new Error(`Unknown AI editing tool: ${name}`);
  }
}
