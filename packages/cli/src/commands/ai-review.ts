/**
 * @module ai-review
 *
 * AI-powered video quality review and auto-fix using Gemini.
 *
 * CLI command: review
 *
 * Execute function:
 *   executeReview - Analyze video quality across 5 categories and optionally auto-fix
 *
 * @dependencies Gemini (Google), FFmpeg (auto-fix filters)
 */

import { Command } from "commander";
import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { GeminiProvider } from "@vibeframe/ai-providers";
import { getApiKey, loadEnv } from "../utils/api-key.js";
import { execSafe } from "../utils/exec-safe.js";
import type { VideoReviewFeedback } from "./ai-edit.js";

/** Options for {@link executeReview}. */
export interface ReviewOptions {
  /** Path to the video file to review */
  videoPath: string;
  /** Optional storyboard JSON for context-aware review */
  storyboardPath?: string;
  /** Automatically apply fixable corrections via FFmpeg */
  autoApply?: boolean;
  /** Run a verification pass after applying fixes */
  verify?: boolean;
  /** Gemini model shorthand (default: "flash") */
  model?: "flash" | "flash-2.5" | "pro";
  /** Output path for the fixed video (auto-apply mode) */
  outputPath?: string;
}

/** Result from {@link executeReview}. */
export interface ReviewResult {
  /** Whether the review completed successfully */
  success: boolean;
  /** Structured review feedback with per-category scores */
  feedback?: VideoReviewFeedback;
  /** Descriptions of fixes that were auto-applied */
  appliedFixes?: string[];
  /** Post-fix verification quality score 1-10 */
  verificationScore?: number;
  /** Path to the reviewed/fixed output video */
  outputPath?: string;
  /** Error message on failure */
  error?: string;
}

function parseReviewFeedback(response: string): VideoReviewFeedback | null {
  let cleaned = response.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.overallScore !== "number" || !parsed.categories) {
      return null;
    }
    return parsed as VideoReviewFeedback;
  } catch {
    return null;
  }
}

/**
 * Review video quality using Gemini AI and optionally auto-fix issues.
 *
 * Analyzes 5 quality categories (pacing, color, text readability, audio-visual
 * sync, composition) and returns scored feedback. When auto-apply is enabled,
 * applies fixable corrections via FFmpeg filters.
 *
 * @param options - Review configuration
 * @returns Result with structured feedback and optional fix details
 */
export async function executeReview(options: ReviewOptions): Promise<ReviewResult> {
  const { videoPath, storyboardPath, autoApply = false, verify = false, model = "flash" } = options;

  const absVideoPath = resolve(process.cwd(), videoPath);
  if (!existsSync(absVideoPath)) {
    return { success: false, error: `Video not found: ${absVideoPath}` };
  }

  const apiKey = process.env.GOOGLE_API_KEY || (await getApiKey("GOOGLE_API_KEY", "Google"));
  if (!apiKey) {
    return { success: false, error: "Google API key required for Gemini video review" };
  }

  let storyboardContext = "";
  if (storyboardPath) {
    const absStoryboardPath = resolve(process.cwd(), storyboardPath);
    if (existsSync(absStoryboardPath)) {
      const content = await readFile(absStoryboardPath, "utf-8");
      storyboardContext = `\n\nOriginal storyboard for reference:\n${content}`;
    }
  }

  const modelMap: Record<string, string> = {
    flash: "gemini-3-flash-preview",
    "flash-2.5": "gemini-2.5-flash",
    pro: "gemini-2.5-pro",
  };
  const modelId = modelMap[model] || modelMap.flash;

  const reviewPrompt = `You are a professional video editor reviewing this video for quality. Analyze the video and return a JSON review with the following structure. Return ONLY valid JSON, no extra text.

{
  "overallScore": <number 1-10>,
  "categories": {
    "pacing": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> },
    "color": { "score": <1-10>, "issues": ["..."], "fixable": <boolean>, "suggestedFilter": "<ffmpeg filter or null>" },
    "textReadability": { "score": <1-10>, "issues": ["..."], "fixable": <boolean>, "suggestions": ["..."] },
    "audioVisualSync": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> },
    "composition": { "score": <1-10>, "issues": ["..."], "fixable": <boolean> }
  },
  "autoFixable": [
    { "type": "color_grade"|"text_overlay_adjust"|"speed_adjust"|"crop", "description": "...", "ffmpegFilter": "..." }
  ],
  "recommendations": ["..."]
}

Score each category 1-10. For fixable issues, provide an FFmpeg filter in autoFixable. Be specific and practical.${storyboardContext}`;

  const gemini = new GeminiProvider();
  await gemini.initialize({ apiKey });

  const videoData = await readFile(absVideoPath);
  const analysisResult = await gemini.analyzeVideo(videoData, reviewPrompt, {
    model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro",
  });

  if (!analysisResult.success || !analysisResult.response) {
    return { success: false, error: analysisResult.error || "Gemini video analysis failed" };
  }

  const feedback = parseReviewFeedback(analysisResult.response);
  if (!feedback) {
    return {
      success: false,
      error: "Failed to parse review feedback from Gemini response",
    };
  }

  const result: ReviewResult = {
    success: true,
    feedback,
    appliedFixes: [],
  };

  if (autoApply && feedback.autoFixable.length > 0) {
    let currentInput = absVideoPath;
    const outputBase = options.outputPath
      ? resolve(process.cwd(), options.outputPath)
      : absVideoPath.replace(/(\.[^.]+)$/, "-reviewed$1");

    for (const fix of feedback.autoFixable) {
      if (fix.type === "color_grade" && fix.ffmpegFilter) {
        try {
          const tempOutput = outputBase.replace(/(\.[^.]+)$/, `-fix-${result.appliedFixes!.length}$1`);
          await execSafe("ffmpeg", ["-i", currentInput, "-vf", fix.ffmpegFilter, "-c:a", "copy", tempOutput, "-y"], { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });
          currentInput = tempOutput;
          result.appliedFixes!.push(`${fix.type}: ${fix.description}`);
        } catch {
          // Skip failed fix, continue with others
        }
      } else if (fix.type === "text_overlay_adjust") {
        result.appliedFixes!.push(`${fix.type}: ${fix.description} (manual adjustment recommended)`);
      }
    }

    if (currentInput !== absVideoPath) {
      const finalOutput = outputBase;
      try {
        await rename(currentInput, finalOutput);
        result.outputPath = finalOutput;
      } catch {
        result.outputPath = currentInput;
      }
    }
  }

  if (verify && result.outputPath) {
    const verifyVideoData = await readFile(result.outputPath);
    const verifyResult = await gemini.analyzeVideo(
      verifyVideoData,
      "Rate this video overall quality on a scale of 1-10. Return ONLY a JSON object: {\"score\": <number>}",
      { model: modelId as "gemini-3-flash-preview" | "gemini-2.5-flash" | "gemini-2.5-pro" }
    );

    if (verifyResult.success && verifyResult.response) {
      try {
        let cleaned = verifyResult.response.trim();
        if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
        if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
        if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
        const parsed = JSON.parse(cleaned.trim());
        result.verificationScore = parsed.score;
      } catch {
        // Verification parse failed, not critical
      }
    }
  }

  return result;
}

export function registerReviewCommand(aiCommand: Command): void {
  aiCommand
    .command("review")
    .description("Review video quality using Gemini AI and optionally auto-fix issues")
    .argument("<video>", "Video file path")
    .option("-s, --storyboard <path>", "Storyboard JSON file for context")
    .option("--auto-apply", "Automatically apply fixable corrections")
    .option("--verify", "Run verification pass after applying fixes")
    .option("-m, --model <model>", "Gemini model: flash (default), flash-2.5, pro", "flash")
    .option("-o, --output <path>", "Output video file path (for auto-apply)")
    .action(async (videoPath: string, options) => {
      try {
        loadEnv();

        const spinner = ora("Reviewing video with Gemini...").start();

        const result = await executeReview({
          videoPath,
          storyboardPath: options.storyboard,
          autoApply: options.autoApply,
          verify: options.verify,
          model: options.model,
          outputPath: options.output,
        });

        if (!result.success) {
          spinner.fail(chalk.red(result.error || "Video review failed"));
          process.exit(1);
        }

        spinner.succeed(chalk.green("Video review complete"));
        console.log();

        const fb = result.feedback!;
        console.log(chalk.bold.cyan("Video Review"));
        console.log(chalk.dim("─".repeat(60)));
        console.log(`Overall Score: ${chalk.bold(fb.overallScore >= 7 ? chalk.green(String(fb.overallScore)) : fb.overallScore >= 5 ? chalk.yellow(String(fb.overallScore)) : chalk.red(String(fb.overallScore)))}/10`);
        console.log();

        const categories = [
          ["Pacing", fb.categories.pacing],
          ["Color", fb.categories.color],
          ["Text Readability", fb.categories.textReadability],
          ["Audio-Visual Sync", fb.categories.audioVisualSync],
          ["Composition", fb.categories.composition],
        ] as const;

        for (const [name, cat] of categories) {
          const scoreColor = cat.score >= 7 ? chalk.green : cat.score >= 5 ? chalk.yellow : chalk.red;
          const fixable = cat.fixable ? chalk.dim(" [fixable]") : "";
          console.log(`  ${name.padEnd(20)} ${scoreColor(String(cat.score).padStart(2))}/10${fixable}`);
          if (cat.issues.length > 0) {
            for (const issue of cat.issues) {
              console.log(chalk.dim(`    - ${issue}`));
            }
          }
        }

        if (result.appliedFixes && result.appliedFixes.length > 0) {
          console.log();
          console.log(chalk.bold.green("Applied Fixes:"));
          for (const fix of result.appliedFixes) {
            console.log(chalk.green(`  + ${fix}`));
          }
          if (result.outputPath) {
            console.log(chalk.green(`  Output: ${result.outputPath}`));
          }
        }

        if (result.verificationScore !== undefined) {
          console.log();
          console.log(chalk.bold(`Verification Score: ${result.verificationScore}/10`));
        }

        if (fb.recommendations.length > 0) {
          console.log();
          console.log(chalk.bold("Recommendations:"));
          for (const rec of fb.recommendations) {
            console.log(chalk.dim(`  * ${rec}`));
          }
        }
        console.log();
      } catch (error) {
        console.error(chalk.red("Video review failed"));
        console.error(error);
        process.exit(1);
      }
    });
}
