/**
 * @module gemini-storyboard
 *
 * Storyboard generation using Gemini 2.5 Flash.
 * Uses the same shared prompt as Claude and OpenAI storyboard generators.
 */

import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { buildStoryboardSystemPrompt, buildStoryboardUserMessage } from "../storyboard-prompt.js";

/** Parameters for Gemini API calls */
export interface GeminiApiParams {
  apiKey: string;
  baseUrl: string;
}

/**
 * Generate a storyboard from script content using Gemini 2.5 Flash.
 *
 * @param api - Gemini API parameters (apiKey, baseUrl)
 * @param content - Script/content text to break into scenes
 * @param targetDuration - Target total video duration in seconds
 * @param options - Generation options
 * @returns Array of storyboard segments (empty on failure)
 */
export async function analyzeContent(
  api: GeminiApiParams,
  content: string,
  targetDuration?: number,
  options?: { creativity?: "low" | "high" }
): Promise<StoryboardSegment[]> {
  const creativity = options?.creativity || "low";
  const systemPrompt = buildStoryboardSystemPrompt(targetDuration, creativity);
  const temperature = creativity === "high" ? 1.0 : 0.7;

  try {
    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        parts: [{ text: buildStoryboardUserMessage(content) }],
      }],
      generationConfig: {
        temperature,
        maxOutputTokens: 4096,
      },
    };

    const response = await fetch(
      `${api.baseUrl}/models/gemini-2.5-flash:generateContent?key=${api.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Gemini] Storyboard API error (${response.status}): ${errorText.slice(0, 300)}`);
      return [];
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      console.error("[Gemini] No content in storyboard response");
      return [];
    }

    const text = parts.filter((p) => p.text).map((p) => p.text).join("\n");

    // Extract JSON array from response (handles markdown code blocks)
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      console.error("[Gemini] No JSON array found in storyboard response. Response text:");
      console.error(text.slice(0, 500));
      return [];
    }

    return JSON.parse(arrayMatch[0]) as StoryboardSegment[];
  } catch (err) {
    console.error(`[Gemini] Storyboard error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
