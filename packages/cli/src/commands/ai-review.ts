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

import { readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { GeminiProvider, resolveGeminiTextModel } from "@vibeframe/ai-providers";
import { getApiKey } from "../utils/api-key.js";
import { execSafe } from "../utils/exec-safe.js";
import type { VideoReviewFeedback } from "./ai-edit.js";

/** Options for {@link executeReview}. */
export interface ReviewOptions {
  /** Path to the video file to review */
  videoPath: string;
  /** Optional storyboard JSON for context-aware review */
  storyboardPath?: string;
  /** Optional project context for beat-aware review */
  projectContext?: string;
  /** Automatically apply fixable corrections via FFmpeg */
  autoApply?: boolean;
  /** Run a verification pass after applying fixes */
  verify?: boolean;
  /** Gemini model shorthand (default: "flash") */
  model?: string;
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
  const {
    videoPath,
    storyboardPath,
    projectContext,
    autoApply = false,
    verify = false,
    model = "flash",
  } = options;

  const absVideoPath = resolve(process.cwd(), videoPath);
  if (!existsSync(absVideoPath)) {
    return { success: false, error: `Video not found: ${absVideoPath}` };
  }

  const apiKey = process.env.GOOGLE_API_KEY || (await getApiKey("GOOGLE_API_KEY", "Google"));
  if (!apiKey) {
    return {
      success: false,
      error:
        "Google API key required for Gemini video review. Run 'vibe setup' or set GOOGLE_API_KEY in .env",
    };
  }

  let storyboardContext = "";
  if (storyboardPath) {
    const absStoryboardPath = resolve(process.cwd(), storyboardPath);
    if (existsSync(absStoryboardPath)) {
      const content = await readFile(absStoryboardPath, "utf-8");
      storyboardContext = `\n\nOriginal storyboard for reference:\n${content}`;
    }
  }
  const extraProjectContext = projectContext
    ? `\n\nProject context for beat-aware review:\n${projectContext}`
    : "";

  const modelId = resolveGeminiTextModel(model);

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
  "beatIssues": [
    {
      "beatId": "<beat id when identifiable>",
      "timeRange": { "start": <seconds>, "end": <seconds>, "duration": <seconds> },
      "severity": "error"|"warning"|"info",
      "category": "pacing"|"color"|"textReadability"|"audioVisualSync"|"composition",
      "message": "...",
      "suggestedFix": "..."
    }
  ],
  "recommendations": ["..."]
}

Score each category 1-10. Prefer beatIssues when you can map a problem to a storyboard beat or timestamp. Use the exact beatId values from the storyboard or beat timing summary, and include timeRange in seconds for every localized finding. In particular, flag narration/visual mismatches, overly static holds, and audio-visual sync problems as beatIssues. Use category issue arrays only for problems that cannot be localized to a beat. For fixable issues, provide an FFmpeg filter in autoFixable. Be specific and practical.${storyboardContext}${extraProjectContext}`;

  const gemini = new GeminiProvider();
  await gemini.initialize({ apiKey });

  const videoData = await readFile(absVideoPath);
  const analysisResult = await gemini.analyzeVideo(videoData, reviewPrompt, {
    model: modelId,
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
          const tempOutput = outputBase.replace(
            /(\.[^.]+)$/,
            `-fix-${result.appliedFixes!.length}$1`
          );
          await execSafe(
            "ffmpeg",
            ["-i", currentInput, "-vf", fix.ffmpegFilter, "-c:a", "copy", tempOutput, "-y"],
            { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }
          );
          currentInput = tempOutput;
          result.appliedFixes!.push(`${fix.type}: ${fix.description}`);
        } catch {
          // Skip failed fix, continue with others
        }
      } else if (fix.type === "text_overlay_adjust") {
        result.appliedFixes!.push(
          `${fix.type}: ${fix.description} (manual adjustment recommended)`
        );
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
      'Rate this video overall quality on a scale of 1-10. Return ONLY a JSON object: {"score": <number>}',
      { model: modelId }
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
