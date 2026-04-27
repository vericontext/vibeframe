import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeScriptToVideo } from "@vibeframe/cli/commands/ai-script-pipeline";
import { executeHighlights, executeAutoShorts } from "@vibeframe/cli/commands/ai-highlights";
import { loadPipeline, executePipeline } from "@vibeframe/cli/pipeline";

export const aiPipelineTools = [
  {
    name: "pipeline_script_to_video",
    description: "[DEPRECATED v0.63 — prefer scene_build] Full script-to-video pipeline: script -> storyboard -> images -> voiceover -> video. Kept for backwards compatibility, but scene_build is the supported one-shot driver (cheaper, cached, deterministic). Requires multiple API keys depending on providers chosen.",
    inputSchema: {
      type: "object" as const,
      properties: {
        script: { type: "string", description: "Video script text or path to script file" },
        outputDir: { type: "string", description: "Output directory for generated assets" },
        duration: { type: "number", description: "Target video duration in seconds" },
        voice: { type: "string", description: "ElevenLabs voice name (default: Rachel)" },
        generator: {
          type: "string",
          enum: ["runway", "kling"],
          description: "Video generation provider (default: kling)",
        },
        imageProvider: {
          type: "string",
          enum: ["openai", "gemini", "grok"],
          description: "Image generation provider (default: gemini)",
        },
        aspectRatio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1"],
          description: "Video aspect ratio (default: 16:9)",
        },
        imagesOnly: { type: "boolean", description: "Generate only images, skip video generation" },
        noVoiceover: { type: "boolean", description: "Skip voiceover generation" },
        creativity: {
          type: "string",
          enum: ["low", "high"],
          description: "Storyboard creativity level",
        },
        storyboardProvider: {
          type: "string",
          enum: ["claude", "openai", "gemini"],
          description: "LLM provider for storyboard generation (default: claude)",
        },
        noTextOverlay: { type: "boolean", description: "Skip text overlays" },
        textStyle: {
          type: "string",
          enum: ["lower-third", "center-bold", "subtitle", "minimal"],
          description: "Text overlay style",
        },
        review: { type: "boolean", description: "Run AI review after generation" },
        reviewAutoApply: { type: "boolean", description: "Auto-apply review fixes" },
      },
      required: ["script"],
    },
  },
  {
    name: "pipeline_highlights",
    description: "Extract highlight clips from a longer video using AI analysis. Requires OPENAI_API_KEY+ANTHROPIC_API_KEY or GOOGLE_API_KEY (with --use-gemini).",
    inputSchema: {
      type: "object" as const,
      properties: {
        media: { type: "string", description: "Path to the input video file" },
        output: { type: "string", description: "Output path for the highlights compilation" },
        project: { type: "string", description: "Path to .vibe.json project to add highlights to" },
        duration: { type: "number", description: "Maximum duration per highlight in seconds (default: 30)" },
        count: { type: "number", description: "Maximum number of highlights to extract (default: 5)" },
        threshold: { type: "number", description: "Minimum confidence threshold 0-1 (default: 0.7)" },
        criteria: {
          type: "string",
          enum: ["emotional", "informative", "funny", "all"],
          description: "Highlight selection criteria (default: all)",
        },
        language: { type: "string", description: "Language code (default: en)" },
        useGemini: { type: "boolean", description: "Use Gemini for analysis (requires GOOGLE_API_KEY)" },
        lowRes: { type: "boolean", description: "Use lower resolution for faster analysis" },
      },
      required: ["media"],
    },
  },
  {
    name: "pipeline_run",
    description: "Execute a declarative YAML pipeline (Video as Code). Accepts either a file path or inline YAML. Supports dry-run, resume-from-checkpoint, and budget limits. Cost depends on the steps — use dryRun: true first to preview.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pipelinePath: {
          type: "string",
          description: "Path to a pipeline YAML file. Mutually exclusive with pipelineYaml.",
        },
        pipelineYaml: {
          type: "string",
          description: "Inline YAML pipeline content. Mutually exclusive with pipelinePath.",
        },
        outputDir: { type: "string", description: "Directory for step outputs (default: pipeline's dir)" },
        dryRun: { type: "boolean", description: "Validate and show execution plan without running (default: false)" },
        resume: { type: "boolean", description: "Resume from last checkpoint, skipping completed steps" },
        failFast: { type: "boolean", description: "Stop on first failed step (default: continue)" },
        budgetUsd: { type: "number", description: "Abort if upper-bound cost estimate exceeds this USD amount" },
        budgetTokens: { type: "number", description: "Abort if provider token usage exceeds this count" },
        maxErrors: { type: "number", description: "Abort if failed step count exceeds this" },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "xhigh"],
          description: "LLM effort level (Opus 4.7 Task Budgets)",
        },
      },
    },
  },
  {
    name: "pipeline_auto_shorts",
    description: "Automatically generate short-form content (Reels/TikTok/Shorts) from a longer video. Same API key requirements as pipeline_highlights.",
    inputSchema: {
      type: "object" as const,
      properties: {
        video: { type: "string", description: "Path to the input video file" },
        outputDir: { type: "string", description: "Output directory for shorts" },
        duration: { type: "number", description: "Maximum duration per short in seconds (default: 60)" },
        count: { type: "number", description: "Number of shorts to generate (default: 3)" },
        aspect: {
          type: "string",
          enum: ["9:16", "1:1"],
          description: "Output aspect ratio (default: 9:16)",
        },
        addCaptions: { type: "boolean", description: "Add auto-generated captions (default: false)" },
        captionStyle: {
          type: "string",
          enum: ["minimal", "bold", "animated"],
          description: "Caption style if enabled",
        },
        analyzeOnly: { type: "boolean", description: "Only analyze without generating shorts" },
        language: { type: "string", description: "Language code (default: en)" },
        useGemini: { type: "boolean", description: "Use Gemini for analysis" },
        lowRes: { type: "boolean", description: "Use lower resolution" },
      },
      required: ["video"],
    },
  },
];

export async function handleAiPipelineToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "pipeline_script_to_video": {
      const result = await executeScriptToVideo({
        script: args.script as string,
        outputDir: args.outputDir as string | undefined,
        duration: args.duration as number | undefined,
        voice: args.voice as string | undefined,
        generator: args.generator as "runway" | "kling" | undefined,
        imageProvider: args.imageProvider as "openai" | "dalle" | "gemini" | undefined,
        aspectRatio: args.aspectRatio as "16:9" | "9:16" | "1:1" | undefined,
        imagesOnly: args.imagesOnly as boolean | undefined,
        noVoiceover: args.noVoiceover as boolean | undefined,
        creativity: args.creativity as "low" | "high" | undefined,
        storyboardProvider: args.storyboardProvider as "claude" | "openai" | "gemini" | undefined,
        noTextOverlay: args.noTextOverlay as boolean | undefined,
        textStyle: args.textStyle as "lower-third" | "center-bold" | "subtitle" | "minimal" | undefined,
        review: args.review as boolean | undefined,
        reviewAutoApply: args.reviewAutoApply as boolean | undefined,
      });
      if (!result.success) return `Script-to-video failed: ${result.error}`;
      return JSON.stringify({
        outputDir: result.outputDir,
        scenes: result.scenes,
        storyboardPath: result.storyboardPath,
        projectPath: result.projectPath,
        images: result.images?.length,
        videos: result.videos?.length,
        totalDuration: result.totalDuration,
        failedScenes: result.failedScenes,
      });
    }

    case "pipeline_highlights": {
      const result = await executeHighlights({
        media: args.media as string,
        output: args.output as string | undefined,
        project: args.project as string | undefined,
        duration: args.duration as number | undefined,
        count: args.count as number | undefined,
        threshold: args.threshold as number | undefined,
        criteria: args.criteria as "emotional" | "informative" | "funny" | "all" | undefined,
        language: args.language as string | undefined,
        useGemini: args.useGemini as boolean | undefined,
        lowRes: args.lowRes as boolean | undefined,
      });
      if (!result.success) return `Highlights extraction failed: ${result.error}`;
      return JSON.stringify({
        highlights: result.highlights.length,
        totalDuration: result.totalDuration,
        totalHighlightDuration: result.totalHighlightDuration,
        outputPath: result.outputPath,
        projectPath: result.projectPath,
      });
    }

    case "pipeline_run": {
      const pipelinePath = args.pipelinePath as string | undefined;
      const pipelineYaml = args.pipelineYaml as string | undefined;
      if (!pipelinePath && !pipelineYaml) {
        return "pipeline_run failed: must provide either pipelinePath or pipelineYaml";
      }
      if (pipelinePath && pipelineYaml) {
        return "pipeline_run failed: pipelinePath and pipelineYaml are mutually exclusive";
      }

      let resolvedPath = pipelinePath;
      let tempPath: string | undefined;
      if (pipelineYaml) {
        tempPath = join(tmpdir(), `vibe-mcp-pipeline-${Date.now()}.yaml`);
        await writeFile(tempPath, pipelineYaml, "utf-8");
        resolvedPath = tempPath;
      }

      try {
        const manifest = await loadPipeline(resolvedPath!);
        if (args.effort) {
          manifest.effort = args.effort as "low" | "medium" | "high" | "xhigh";
        }

        const budget: Record<string, number> = {};
        if (typeof args.budgetUsd === "number") budget.costUsd = args.budgetUsd;
        if (typeof args.budgetTokens === "number") budget.tokens = args.budgetTokens;
        if (typeof args.maxErrors === "number") budget.maxToolErrors = args.maxErrors;

        const result = await executePipeline(manifest, {
          outputDir: args.outputDir as string | undefined,
          dryRun: args.dryRun as boolean | undefined,
          resume: args.resume as boolean | undefined,
          failFast: args.failFast as boolean | undefined,
          budget: Object.keys(budget).length > 0 ? budget : undefined,
        });

        return JSON.stringify({
          success: result.success,
          name: result.name,
          completedSteps: result.completedSteps,
          totalSteps: result.totalSteps,
          totalDuration: result.totalDuration,
          outputDir: result.outputDir,
          error: result.error,
          budget: result.budget,
          steps: result.steps.map((s) => ({
            id: s.id,
            action: s.action,
            success: s.success,
            output: s.output,
            duration: s.duration,
            error: s.error,
          })),
        });
      } finally {
        if (tempPath) {
          try {
            const { unlink } = await import("node:fs/promises");
            await unlink(tempPath);
          } catch {
            // best-effort cleanup
          }
        }
      }
    }

    case "pipeline_auto_shorts": {
      const result = await executeAutoShorts({
        video: args.video as string,
        outputDir: args.outputDir as string | undefined,
        duration: args.duration as number | undefined,
        count: args.count as number | undefined,
        aspect: args.aspect as "9:16" | "1:1" | undefined,
        addCaptions: args.addCaptions as boolean | undefined,
        captionStyle: args.captionStyle as "minimal" | "bold" | "animated" | undefined,
        analyzeOnly: args.analyzeOnly as boolean | undefined,
        language: args.language as string | undefined,
        useGemini: args.useGemini as boolean | undefined,
        lowRes: args.lowRes as boolean | undefined,
      });
      if (!result.success) return `Auto-shorts failed: ${result.error}`;
      return JSON.stringify({
        shorts: result.shorts.length,
        shortsDetails: result.shorts.map(s => ({
          index: s.index,
          duration: s.duration,
          confidence: s.confidence,
          reason: s.reason,
          outputPath: s.outputPath,
        })),
      });
    }

    default:
      throw new Error(`Unknown AI pipeline tool: ${name}`);
  }
}
