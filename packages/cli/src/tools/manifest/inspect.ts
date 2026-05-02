/**
 * @module manifest/analyze
 * @description Analysis tools (Gemini-driven media analysis + AI review +
 * suggest-edit). `generate_thumbnail` is treated as an analyze tool in the
 * legacy ai-analysis.ts file but lives in the generate manifest because its
 * name is `generate_*`.
 */

import { z } from "zod";
import { resolve } from "node:path";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  executeAnalyze,
  executeGeminiVideo,
} from "../../commands/ai-analyze.js";
import { executeReview } from "../../commands/ai-review.js";
import { executeSuggestEdit } from "../../commands/ai-suggest-edit.js";
import { inspectProject } from "../../commands/_shared/scene-inspect.js";
import { inspectRender, previewInspectRender } from "../../commands/_shared/render-inspect.js";

// ── inspect_project ────────────────────────────────────────────────────────

export const inspectProjectTool = defineTool({
  name: "inspect_project",
  category: "analyze",
  cost: "free",
  description:
    "Local project inspection: checks STORYBOARD.md, DESIGN.md, config, build-report, scene lint, composition files, and referenced assets. Writes review-report.json by default.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    beat: z.string().optional().describe("Inspect only one storyboard beat where beat-scoped checks apply."),
    outputPath: z.string().optional().describe("Optional review report path. Defaults to <project>/review-report.json."),
    report: z.boolean().optional().describe("Write review-report.json. Default true."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const result = await inspectProject({
      projectDir,
      beatId: args.beat,
      outputPath: args.outputPath ? resolve(ctx.workingDirectory, args.outputPath) : undefined,
      writeReport: args.report !== false,
    });
    return {
      success: result.status !== "fail",
      data: result as unknown as Record<string, unknown>,
      error: result.status === "fail" ? `${result.issues.filter((issue) => issue.severity === "error").length} project inspection error(s)` : undefined,
      humanLines: [
        `${result.status === "pass" ? "✅" : result.status === "warn" ? "⚠️" : "❌"} Project inspection ${result.status} — score ${result.score}/100`,
        ...(result.reportPath ? [`report: ${result.reportPath}`] : []),
      ],
    };
  },
});

// ── inspect_render ─────────────────────────────────────────────────────────

export const inspectRenderTool = defineTool({
  name: "inspect_render",
  category: "analyze",
  cost: "low",
  description:
    "Render inspection: runs cheap local video checks by default, optionally adds Gemini AI review with ai: true, and writes review-report.json by default.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    beat: z.string().optional().describe("Inspect a render for one storyboard beat."),
    videoPath: z.string().optional().describe("Rendered video path. Defaults to build-report outputPath or latest renders/* video."),
    outputPath: z.string().optional().describe("Optional review report path. Defaults to <project>/review-report.json."),
    report: z.boolean().optional().describe("Write review-report.json. Default true."),
    ai: z.boolean().optional().describe("Also run Gemini video review and merge findings into review-report.json. Default false."),
    model: z.enum(["flash", "flash-2.5", "pro"]).optional().describe("Gemini model variant for ai review. Default flash."),
    dryRun: z.boolean().optional().describe("Preview resolved inputs without probing video or calling Gemini."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    if (args.dryRun) {
      const result = await previewInspectRender({
        projectDir,
        beatId: args.beat,
        videoPath: args.videoPath ? resolve(ctx.workingDirectory, args.videoPath) : undefined,
        outputPath: args.outputPath ? resolve(ctx.workingDirectory, args.outputPath) : undefined,
        writeReport: args.report !== false,
        ai: args.ai === true,
        model: args.model,
      });
      return {
        success: true,
        data: result as unknown as Record<string, unknown>,
        humanLines: [
          `Render inspection dry-run — ${result.videoPath ? "render found" : "render missing"}`,
          ...(result.reportPath ? [`report: ${result.reportPath}`] : []),
        ],
      };
    }
    const result = await inspectRender({
      projectDir,
      beatId: args.beat,
      videoPath: args.videoPath ? resolve(ctx.workingDirectory, args.videoPath) : undefined,
      outputPath: args.outputPath ? resolve(ctx.workingDirectory, args.outputPath) : undefined,
      writeReport: args.report !== false,
      ai: args.ai === true,
      model: args.model,
    });
    return {
      success: result.status !== "fail",
      data: result as unknown as Record<string, unknown>,
      error: result.status === "fail" ? `${result.issues.filter((issue) => issue.severity === "error").length} render inspection error(s)` : undefined,
      humanLines: [
        `${result.status === "pass" ? "✅" : result.status === "warn" ? "⚠️" : "❌"} Render inspection ${result.status} — score ${result.score}/100`,
        ...(result.reportPath ? [`report: ${result.reportPath}`] : []),
      ],
    };
  },
});

// ── inspect_media ───────────────────────────────────────────────────────────

export const analyzeMediaTool = defineTool({
  name: "inspect_media",
  category: "analyze",
  cost: "low",
  description:
    "Analyze media (image, video, or YouTube URL) using Gemini AI. Requires GOOGLE_API_KEY.",
  schema: z.object({
    source: z.string().describe("Path to image/video or YouTube URL"),
    prompt: z.string().describe("Analysis prompt (e.g., 'Describe the scene', 'Count people')"),
    model: z.enum(["flash", "flash-2.5", "pro"]).optional().describe("Gemini model variant (default: flash)"),
    fps: z.number().optional().describe("Frames per second for video sampling (default: 1)"),
    start: z.number().optional().describe("Start time in seconds for video analysis"),
    end: z.number().optional().describe("End time in seconds for video analysis"),
    lowRes: z.boolean().optional().describe("Use lower resolution for faster processing"),
  }),
  async execute(args) {
    const result = await executeAnalyze(args);
    if (!result.success) return { success: false, error: result.error ?? "Analysis failed" };
    return {
      success: true,
      data: {
        response: result.response,
        model: result.model,
        totalTokens: result.totalTokens,
      },
      humanLines: [`✅ Analyzed (${result.model})`],
    };
  },
});

// ── inspect_video ───────────────────────────────────────────────────────────

export const analyzeVideoTool = defineTool({
  name: "inspect_video",
  category: "analyze",
  cost: "low",
  description:
    "Analyze video content using Gemini AI with temporal understanding. Requires GOOGLE_API_KEY.",
  schema: z.object({
    source: z.string().describe("Path to video file"),
    prompt: z.string().describe("Analysis prompt"),
    model: z.enum(["flash", "flash-2.5", "pro"]).optional().describe("Gemini model variant (default: flash)"),
    fps: z.number().optional().describe("Frames per second for sampling"),
    start: z.number().optional().describe("Start time in seconds"),
    end: z.number().optional().describe("End time in seconds"),
    lowRes: z.boolean().optional().describe("Use lower resolution"),
  }),
  async execute(args) {
    const result = await executeGeminiVideo(args);
    if (!result.success) return { success: false, error: result.error ?? "Analysis failed" };
    return {
      success: true,
      data: {
        response: result.response,
        model: result.model,
        totalTokens: result.totalTokens,
      },
      humanLines: [`✅ Analyzed video (${result.model})`],
    };
  },
});

// ── inspect_review ──────────────────────────────────────────────────────────

export const analyzeReviewTool = defineTool({
  name: "inspect_review",
  category: "analyze",
  cost: "low",
  description:
    "AI video review: analyzes quality, suggests fixes, and optionally auto-applies them. Requires GOOGLE_API_KEY.",
  schema: z.object({
    videoPath: z.string().describe("Path to the video file to review"),
    storyboardPath: z.string().optional().describe("Path to storyboard.json for intent comparison"),
    autoApply: z.boolean().optional().describe("Automatically apply suggested fixes (default: false)"),
    verify: z.boolean().optional().describe("Re-review after applying fixes (default: false)"),
    model: z.enum(["flash", "flash-2.5", "pro"]).optional().describe("Gemini model variant (default: flash)"),
    outputPath: z.string().optional().describe("Output path for fixed video"),
  }),
  async execute(args) {
    const result = await executeReview(args);
    if (!result.success) return { success: false, error: result.error ?? "Review failed" };
    return {
      success: true,
      data: {
        feedback: result.feedback,
        appliedFixes: result.appliedFixes,
        verificationScore: result.verificationScore,
        outputPath: result.outputPath,
      },
      humanLines: [`✅ Review complete${result.outputPath ? ` → ${result.outputPath}` : ""}`],
    };
  },
});

// ── inspect_suggest ─────────────────────────────────────────────────────────

export const analyzeSuggestTool = defineTool({
  name: "inspect_suggest",
  category: "analyze",
  cost: "low",
  description:
    "Get natural-language edit suggestions for a project from Gemini. Returns suggestions array with type/confidence/clipIds. With `apply: true`, applies the first suggestion in place. Requires GOOGLE_API_KEY.",
  schema: z.object({
    projectPath: z.string().describe("Path to timeline.json, a timeline directory, or a legacy *.vibe.json file"),
    instruction: z.string().describe("Natural-language instruction (e.g. 'trim all clips to 5 seconds', 'add transitions between every clip')"),
    apply: z.boolean().optional().describe("Apply the first suggestion in place"),
  }),
  async execute(args) {
    const result = await executeSuggestEdit(args);
    if (!result.success) return { success: false, error: result.error ?? "Suggest failed" };
    return {
      success: true,
      data: {
        suggestionCount: result.suggestions?.length ?? 0,
        suggestions: result.suggestions,
        applied: result.applied,
        appliedSuggestion: result.appliedSuggestion,
        outputPath: result.outputPath,
      },
      humanLines: [
        `Found ${result.suggestions?.length ?? 0} suggestion(s)`,
        ...(result.suggestions ?? []).map(
          (s, i) =>
            `  [${i + 1}] ${s.type.toUpperCase()} (conf ${(s.confidence * 100).toFixed(0)}%) — ${s.description}`,
        ),
        ...(result.applied ? [`Applied first suggestion → ${result.outputPath}`] : []),
      ],
    };
  },
});

export const inspectTools: readonly AnyTool[] = [
  inspectProjectTool as unknown as AnyTool,
  inspectRenderTool as unknown as AnyTool,
  analyzeMediaTool as unknown as AnyTool,
  analyzeVideoTool as unknown as AnyTool,
  analyzeReviewTool as unknown as AnyTool,
  analyzeSuggestTool as unknown as AnyTool,
];
