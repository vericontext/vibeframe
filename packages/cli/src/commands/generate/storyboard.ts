/**
 * @module generate/storyboard
 * @description `vibe generate storyboard` — Claude-powered script-to-
 * storyboard analysis. Split out of `generate.ts` in v0.69 (Plan G Phase 2).
 */

import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { ClaudeProvider } from "@vibeframe/ai-providers";
import { sanitizeLLMResponse } from "../sanitize.js";

// ── Library: executeStoryboard ──────────────────────────────────────────

export interface ExecuteStoryboardOptions {
  content: string;
  duration?: number;
  creativity?: "low" | "high";
  output?: string;
  apiKey?: string;
}

export interface ExecuteStoryboardResult {
  success: boolean;
  segments?: Array<{
    description: string;
    visuals?: string;
    duration?: number;
    narration?: string;
  }>;
  segmentCount?: number;
  outputPath?: string;
  error?: string;
}

export async function executeStoryboard(
  options: ExecuteStoryboardOptions
): Promise<ExecuteStoryboardResult> {
  const { content, duration, creativity = "low", output, apiKey } = options;

  try {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return { success: false, error: "ANTHROPIC_API_KEY required" };

    const claude = new ClaudeProvider();
    await claude.initialize({ apiKey: key });

    const segments = await claude.analyzeContent(content, duration, { creativity });

    if (segments.length === 0) {
      return { success: false, error: "Could not generate storyboard" };
    }

    // Sanitize LLM output
    for (const seg of segments) {
      seg.description = sanitizeLLMResponse(seg.description);
      if (seg.visuals) seg.visuals = sanitizeLLMResponse(seg.visuals);
    }

    let outputPath: string | undefined;
    if (output) {
      outputPath = resolve(process.cwd(), output);
      await writeFile(outputPath, JSON.stringify(segments, null, 2), "utf-8");
    }

    return { success: true, segments, segmentCount: segments.length, outputPath };
  } catch (error) {
    return {
      success: false,
      error: `Storyboard failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ── CLI: vibe generate storyboard ───────────────────────────────────────
