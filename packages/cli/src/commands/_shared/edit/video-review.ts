/**
 * @module _shared/edit/video-review
 * @description Type definitions for AI video review feedback (Gemini-
 * powered quality analysis with auto-fix suggestions). Used by
 * `commands/ai-review.ts`. Split out of `ai-edit.ts` in v0.69 (Plan G
 * Phase 3).
 */

/** A single auto-fix proposal with optional FFmpeg filter. */
export interface AutoFix {
  /** Category of the fix */
  type: "color_grade" | "text_overlay_adjust" | "speed_adjust" | "crop";
  /** Human-readable description of the issue */
  description: string;
  /** FFmpeg filter string to apply the fix (if applicable) */
  ffmpegFilter?: string;
}

/** Scored review for a single quality category. */
export interface VideoReviewCategory {
  /** Quality score from 1-10 */
  score: number;
  /** List of identified issues */
  issues: string[];
  /** Whether the issues can be auto-fixed */
  fixable: boolean;
  /** Suggested FFmpeg filter for fixing (color category) */
  suggestedFilter?: string;
  /** Improvement suggestions (text readability category) */
  suggestions?: string[];
}

/** Complete AI video review feedback from Gemini analysis. */
export interface VideoReviewFeedback {
  /** Overall quality score from 1-10 */
  overallScore: number;
  /** Per-category quality assessments */
  categories: {
    pacing: VideoReviewCategory;
    color: VideoReviewCategory;
    textReadability: VideoReviewCategory;
    audioVisualSync: VideoReviewCategory;
    composition: VideoReviewCategory;
  };
  /** List of auto-fixable issues with FFmpeg filter suggestions */
  autoFixable: AutoFix[];
  /** General improvement recommendations */
  recommendations: string[];
}
