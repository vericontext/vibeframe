/**
 * @module _shared/edit/grade
 * @description `executeGrade`, the one implementation of `vibe edit grade`,
 * shared by the CLI action, the `edit_grade` MCP tool, and the YAML
 * pipeline's `edit-grade` step. A built-in preset is free; a custom style
 * asks Claude for an FFmpeg filter chain.
 */

import { ClaudeProvider } from "@vibeframe/ai-providers";
import { requireConfiguredApiKey } from "../../../utils/api-key.js";
import { execSafe } from "../../../utils/exec-safe.js";
import { failureFromError, usageError } from "../../output.js";
import { editFailure, editOutputPath, resolveVideoInput, type EditFailure } from "./_helpers.js";

/** Built-in grades that need no API key. */
export const GRADE_PRESETS = [
  "film-noir",
  "vintage",
  "cinematic-warm",
  "cool-tones",
  "high-contrast",
  "pastel",
  "cyberpunk",
  "horror",
] as const;

export type GradePreset = (typeof GRADE_PRESETS)[number];

export interface GradeOptions {
  videoPath: string;
  /** Custom style description; needs ANTHROPIC_API_KEY. */
  style?: string;
  /** Built-in preset; wins over `style` when both are given. */
  preset?: string;
  output?: string;
  /** Resolve the filter without running FFmpeg. */
  analyzeOnly?: boolean;
  apiKey?: string;
  /** Step messages for a spinner. */
  onProgress?: (message: string) => void;
}

export type GradeResult =
  | {
      success: true;
      /** Set only when a graded file was written. */
      outputPath?: string;
      style: string;
      description: string;
      ffmpegFilter: string;
    }
  | EditFailure;

export async function executeGrade(options: GradeOptions): Promise<GradeResult> {
  const { style, preset, analyzeOnly, onProgress } = options;
  if (!style && !preset) {
    return editFailure(usageError(
      "Either --style or --preset is required",
      'Examples: vibe edit grade video.mp4 --style "warm sunset" or --preset cinematic-warm',
    ));
  }
  if (preset && !(GRADE_PRESETS as readonly string[]).includes(preset)) {
    return editFailure(usageError(`Unknown preset: ${preset}`, `Available presets: ${GRADE_PRESETS.join(", ")}`));
  }

  const input = resolveVideoInput(options.videoPath);
  if ("failure" in input) return input;
  const { absPath } = input;

  // A preset is built in; only a custom style needs Claude. A missing key
  // throws ApiKeyError (API_KEY_MISSING) before any work.
  const apiKey = preset ? undefined : await requireConfiguredApiKey("ANTHROPIC_API_KEY", "Anthropic", options.apiKey);
  const label = preset ?? style!;

  try {
    onProgress?.(preset ? "Loading preset..." : "Analyzing color grade...");
    const claude = new ClaudeProvider();
    if (apiKey) await claude.initialize({ apiKey });
    const grade = apiKey ? await claude.analyzeColorGrade(style!) : await claude.analyzeColorGrade("", preset);

    if (analyzeOnly) {
      return { success: true, style: label, description: grade.description, ffmpegFilter: grade.ffmpegFilter };
    }

    const outputPath = editOutputPath(absPath, options.output, "-graded");
    onProgress?.("Applying color grade...");
    await execSafe("ffmpeg", ["-i", absPath, "-vf", grade.ffmpegFilter, "-c:a", "copy", outputPath, "-y"], { timeout: 600000 });

    return { success: true, outputPath, style: label, description: grade.description, ffmpegFilter: grade.ffmpegFilter };
  } catch (error) {
    return editFailure(failureFromError(error, "Color grading failed", { fallback: "general" }));
  }
}
