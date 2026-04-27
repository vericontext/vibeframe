import { executeAnalyze, executeGeminiVideo } from "@vibeframe/cli/commands/ai-analyze";
import { executeReview } from "@vibeframe/cli/commands/ai-review";
import { executeThumbnailBestFrame } from "@vibeframe/cli/commands/ai-image";
import { executeSuggestEdit } from "@vibeframe/cli/commands/ai-suggest-edit";

export const aiAnalysisTools = [
  {
    name: "analyze_media",
    description: "Analyze media (image, video, or YouTube URL) using Gemini AI. Requires GOOGLE_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Path to image/video or YouTube URL" },
        prompt: { type: "string", description: "Analysis prompt (e.g., 'Describe the scene', 'Count people')" },
        model: {
          type: "string",
          enum: ["flash", "flash-2.5", "pro"],
          description: "Gemini model variant (default: flash)",
        },
        fps: { type: "number", description: "Frames per second for video sampling (default: 1)" },
        start: { type: "number", description: "Start time in seconds for video analysis" },
        end: { type: "number", description: "End time in seconds for video analysis" },
        lowRes: { type: "boolean", description: "Use lower resolution for faster processing" },
      },
      required: ["source", "prompt"],
    },
  },
  {
    name: "analyze_video",
    description: "Analyze video content using Gemini AI with temporal understanding. Requires GOOGLE_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string", description: "Path to video file" },
        prompt: { type: "string", description: "Analysis prompt" },
        model: {
          type: "string",
          enum: ["flash", "flash-2.5", "pro"],
          description: "Gemini model variant (default: flash)",
        },
        fps: { type: "number", description: "Frames per second for sampling" },
        start: { type: "number", description: "Start time in seconds" },
        end: { type: "number", description: "End time in seconds" },
        lowRes: { type: "boolean", description: "Use lower resolution" },
      },
      required: ["source", "prompt"],
    },
  },
  {
    name: "analyze_review",
    description: "AI video review: analyzes quality, suggests fixes, and optionally auto-applies them. Requires GOOGLE_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the video file to review" },
        storyboardPath: { type: "string", description: "Path to storyboard.json for intent comparison" },
        autoApply: { type: "boolean", description: "Automatically apply suggested fixes (default: false)" },
        verify: { type: "boolean", description: "Re-review after applying fixes (default: false)" },
        model: {
          type: "string",
          enum: ["flash", "flash-2.5", "pro"],
          description: "Gemini model variant (default: flash)",
        },
        outputPath: { type: "string", description: "Output path for fixed video" },
      },
      required: ["videoPath"],
    },
  },
  {
    name: "generate_thumbnail",
    description: "Extract the best thumbnail frame from a video using Gemini AI analysis. Requires GOOGLE_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        videoPath: { type: "string", description: "Path to the video file" },
        outputPath: { type: "string", description: "Output path for the thumbnail image" },
        prompt: { type: "string", description: "Custom criteria for best frame selection" },
        model: { type: "string", description: "Gemini model variant" },
      },
      required: ["videoPath", "outputPath"],
    },
  },
  {
    name: "analyze_suggest",
    description: "Get natural-language edit suggestions for a project from Gemini. Returns suggestions array with type/confidence/clipIds. With `apply: true`, applies the first suggestion in place. Requires GOOGLE_API_KEY.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectPath: { type: "string", description: "Project file path (.vibe.json)" },
        instruction: { type: "string", description: "Natural-language instruction (e.g. 'trim all clips to 5 seconds', 'add transitions between every clip')" },
        apply:       { type: "boolean", description: "Apply the first suggestion in place" },
      },
      required: ["projectPath", "instruction"],
    },
  },
];

export async function handleAiAnalysisToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "analyze_media": {
      const result = await executeAnalyze({
        source: args.source as string,
        prompt: args.prompt as string,
        model: args.model as "flash" | "flash-2.5" | "pro" | undefined,
        fps: args.fps as number | undefined,
        start: args.start as number | undefined,
        end: args.end as number | undefined,
        lowRes: args.lowRes as boolean | undefined,
      });
      if (!result.success) return `Analysis failed: ${result.error}`;
      return JSON.stringify({
        response: result.response,
        model: result.model,
        sourceType: result.sourceType,
        totalTokens: result.totalTokens,
      });
    }

    case "analyze_video": {
      const result = await executeGeminiVideo({
        source: args.source as string,
        prompt: args.prompt as string,
        model: args.model as "flash" | "flash-2.5" | "pro" | undefined,
        fps: args.fps as number | undefined,
        start: args.start as number | undefined,
        end: args.end as number | undefined,
        lowRes: args.lowRes as boolean | undefined,
      });
      if (!result.success) return `Video analysis failed: ${result.error}`;
      return JSON.stringify({
        response: result.response,
        model: result.model,
        totalTokens: result.totalTokens,
      });
    }

    case "analyze_review": {
      const result = await executeReview({
        videoPath: args.videoPath as string,
        storyboardPath: args.storyboardPath as string | undefined,
        autoApply: args.autoApply as boolean | undefined,
        verify: args.verify as boolean | undefined,
        model: args.model as "flash" | "flash-2.5" | "pro" | undefined,
        outputPath: args.outputPath as string | undefined,
      });
      if (!result.success) return `Review failed: ${result.error}`;
      return JSON.stringify({
        feedback: result.feedback,
        appliedFixes: result.appliedFixes,
        verificationScore: result.verificationScore,
        outputPath: result.outputPath,
      });
    }

    case "generate_thumbnail": {
      const result = await executeThumbnailBestFrame({
        videoPath: args.videoPath as string,
        outputPath: args.outputPath as string,
        prompt: args.prompt as string | undefined,
        model: args.model as string | undefined,
      });
      if (!result.success) return `Thumbnail extraction failed: ${result.error}`;
      return JSON.stringify({
        outputPath: result.outputPath,
        timestamp: result.timestamp,
        reason: result.reason,
      });
    }

    case "analyze_suggest": {
      const result = await executeSuggestEdit({
        projectPath: args.projectPath as string,
        instruction: args.instruction as string,
        apply: args.apply as boolean | undefined,
      });
      if (!result.success) return `Suggest failed: ${result.error}`;
      return JSON.stringify({
        success: true,
        suggestionCount: result.suggestions?.length ?? 0,
        suggestions: result.suggestions,
        applied: result.applied,
        appliedSuggestion: result.appliedSuggestion,
        outputPath: result.outputPath,
      });
    }

    default:
      throw new Error(`Unknown AI analysis tool: ${name}`);
  }
}
