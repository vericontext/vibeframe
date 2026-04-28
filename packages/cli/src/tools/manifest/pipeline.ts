/**
 * @module manifest/pipeline
 * @description Pipeline tools.
 *   pipeline_highlights, pipeline_auto_shorts (long-form → clips),
 *   pipeline_run (YAML pipeline executor — wraps top-level `vibe run`),
 *   pipeline_regenerate_scene (scene re-render against an existing
 *     storyboard.{yaml,json} on disk).
 *
 * `pipeline_script_to_video` was retired alongside the CLI subcommand —
 * the skill-driven `scene_build` flow replaces it (idempotent, cheaper,
 * per-beat editable).
 */

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import { executeRegenerateScene } from "../../commands/ai-script-pipeline.js";
import {
  executeHighlights,
  executeAutoShorts,
} from "../../commands/ai-highlights.js";
import { loadPipeline, executePipeline } from "../../pipeline/index.js";

export const pipelineHighlightsTool = defineTool({
  name: "pipeline_highlights",
  category: "pipeline",
  cost: "low",
  description:
    "Extract highlight clips from a longer video using AI analysis. Requires OPENAI_API_KEY+ANTHROPIC_API_KEY or GOOGLE_API_KEY (with --use-gemini).",
  schema: z.object({
    media: z.string().describe("Path to the input video file"),
    output: z.string().optional().describe("Output path for the highlights compilation"),
    project: z.string().optional().describe("Path to .vibe.json project to add highlights to"),
    duration: z.number().optional().describe("Maximum duration per highlight in seconds (default: 30)"),
    count: z.number().optional().describe("Maximum number of highlights to extract (default: 5)"),
    threshold: z.number().optional().describe("Minimum confidence threshold 0-1 (default: 0.7)"),
    criteria: z.enum(["emotional", "informative", "funny", "all"]).optional().describe("Highlight selection criteria (default: all)"),
    language: z.string().optional().describe("Language code (default: en)"),
    useGemini: z.boolean().optional().describe("Use Gemini for analysis (requires GOOGLE_API_KEY)"),
    lowRes: z.boolean().optional().describe("Use lower resolution for faster analysis"),
  }),
  async execute(args) {
    const result = await executeHighlights(args);
    if (!result.success) return { success: false, error: result.error ?? "Highlights failed" };
    return {
      success: true,
      data: {
        highlights: result.highlights.length,
        totalDuration: result.totalDuration,
        totalHighlightDuration: result.totalHighlightDuration,
        outputPath: result.outputPath,
        projectPath: result.projectPath,
      },
      humanLines: [`✅ ${result.highlights.length} highlights extracted${result.outputPath ? ` → ${result.outputPath}` : ""}`],
    };
  },
});

export const pipelineAutoShortsTool = defineTool({
  name: "pipeline_auto_shorts",
  category: "pipeline",
  cost: "medium",
  description:
    "Automatically generate short-form content (Reels/TikTok/Shorts) from a longer video. Same API key requirements as pipeline_highlights.",
  schema: z.object({
    video: z.string().describe("Path to the input video file"),
    outputDir: z.string().optional().describe("Output directory for shorts"),
    duration: z.number().optional().describe("Maximum duration per short in seconds (default: 60)"),
    count: z.number().optional().describe("Number of shorts to generate (default: 3)"),
    aspect: z.enum(["9:16", "1:1"]).optional().describe("Output aspect ratio (default: 9:16)"),
    addCaptions: z.boolean().optional().describe("Add auto-generated captions (default: false)"),
    captionStyle: z.enum(["minimal", "bold", "animated"]).optional().describe("Caption style if enabled"),
    analyzeOnly: z.boolean().optional().describe("Only analyze without generating shorts"),
    language: z.string().optional().describe("Language code (default: en)"),
    useGemini: z.boolean().optional().describe("Use Gemini for analysis"),
    lowRes: z.boolean().optional().describe("Use lower resolution"),
  }),
  async execute(args) {
    const result = await executeAutoShorts(args);
    if (!result.success) return { success: false, error: result.error ?? "Auto-shorts failed" };
    return {
      success: true,
      data: {
        shorts: result.shorts.length,
        shortsDetails: result.shorts.map((s) => ({
          index: s.index,
          duration: s.duration,
          confidence: s.confidence,
          reason: s.reason,
          outputPath: s.outputPath,
        })),
      },
      humanLines: [`✅ ${result.shorts.length} shorts generated`],
    };
  },
});

// MCP-only by design — wraps top-level `vibe run <pipeline>`. CLI is hand-written.
export const pipelineRunTool = defineTool({
  name: "pipeline_run",
  category: "pipeline",
  cost: "very-high",
  surfaces: ["mcp"],
  description:
    "Execute a declarative YAML pipeline (Video as Code). Accepts either a file path or inline YAML. Supports dry-run, resume-from-checkpoint, and budget limits. Cost depends on the steps — use dryRun: true first to preview.",
  schema: z.object({
    pipelinePath: z.string().optional().describe("Path to a pipeline YAML file. Mutually exclusive with pipelineYaml."),
    pipelineYaml: z.string().optional().describe("Inline YAML pipeline content. Mutually exclusive with pipelinePath."),
    outputDir: z.string().optional().describe("Directory for step outputs (default: pipeline's dir)"),
    dryRun: z.boolean().optional().describe("Validate and show execution plan without running (default: false)"),
    resume: z.boolean().optional().describe("Resume from last checkpoint, skipping completed steps"),
    failFast: z.boolean().optional().describe("Stop on first failed step (default: continue)"),
    budgetUsd: z.number().optional().describe("Abort if upper-bound cost estimate exceeds this USD amount"),
    budgetTokens: z.number().optional().describe("Abort if provider token usage exceeds this count"),
    maxErrors: z.number().optional().describe("Abort if failed step count exceeds this"),
    effort: z.enum(["low", "medium", "high", "xhigh"]).optional().describe("LLM effort level (Opus 4.7 Task Budgets)"),
  }),
  async execute(args) {
    if (!args.pipelinePath && !args.pipelineYaml) {
      return { success: false, error: "must provide either pipelinePath or pipelineYaml" };
    }
    if (args.pipelinePath && args.pipelineYaml) {
      return { success: false, error: "pipelinePath and pipelineYaml are mutually exclusive" };
    }

    let resolvedPath = args.pipelinePath;
    let tempPath: string | undefined;
    if (args.pipelineYaml) {
      tempPath = join(tmpdir(), `vibe-mcp-pipeline-${Date.now()}.yaml`);
      await writeFile(tempPath, args.pipelineYaml, "utf-8");
      resolvedPath = tempPath;
    }

    try {
      const manifest = await loadPipeline(resolvedPath!);
      if (args.effort) manifest.effort = args.effort;

      const budget: Record<string, number> = {};
      if (typeof args.budgetUsd === "number") budget.costUsd = args.budgetUsd;
      if (typeof args.budgetTokens === "number") budget.tokens = args.budgetTokens;
      if (typeof args.maxErrors === "number") budget.maxToolErrors = args.maxErrors;

      const result = await executePipeline(manifest, {
        outputDir: args.outputDir,
        dryRun: args.dryRun,
        resume: args.resume,
        failFast: args.failFast,
        budget: Object.keys(budget).length > 0 ? budget : undefined,
      });

      return {
        success: result.success,
        data: {
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
        },
        humanLines: [`Pipeline ${result.name}: ${result.completedSteps}/${result.totalSteps}`],
        error: result.error,
      };
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
  },
});

export const pipelineRegenerateSceneTool = defineTool({
  name: "pipeline_regenerate_scene",
  category: "pipeline",
  cost: "high",
  description:
    "Regenerate specific scenes against an existing storyboard.{yaml,json} on disk. Can regenerate video, image, or narration independently.",
  schema: z.object({
    projectDir: z.string().describe("Path to the project output directory containing storyboard.json"),
    scenes: z.array(z.number()).describe("1-indexed scene numbers to regenerate"),
    videoOnly: z.boolean().optional().describe("Only regenerate video (keep existing image)"),
    narrationOnly: z.boolean().optional().describe("Only regenerate narration audio"),
    imageOnly: z.boolean().optional().describe("Only regenerate scene image"),
    generator: z.enum(["kling", "runway", "veo"]).optional().describe("Video generation provider"),
    imageProvider: z.enum(["gemini", "openai", "grok"]).optional().describe("Image generation provider"),
    voice: z.string().optional().describe("ElevenLabs voice name or ID"),
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("Video aspect ratio"),
    retries: z.number().optional().describe("Max retries per video generation call (default: 2)"),
  }),
  async execute(args) {
    const result = await executeRegenerateScene(args);
    if (!result.success) return { success: false, error: result.error ?? "Regenerate scene failed" };
    return {
      success: true,
      data: { regeneratedScenes: result.regeneratedScenes },
      humanLines: [`✅ Regenerated ${result.regeneratedScenes?.length ?? 0} scene(s)`],
    };
  },
});

export const pipelineTools: readonly AnyTool[] = [
  pipelineHighlightsTool as unknown as AnyTool,
  pipelineAutoShortsTool as unknown as AnyTool,
  pipelineRunTool as unknown as AnyTool,
  pipelineRegenerateSceneTool as unknown as AnyTool,
];
