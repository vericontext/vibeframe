/**
 * @module openai-storyboard
 *
 * Storyboard generation using OpenAI GPT-4o.
 * Uses the same shared prompt as Claude and Gemini storyboard generators.
 */

import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { buildStoryboardSystemPrompt, buildStoryboardUserMessage } from "../storyboard-prompt.js";

/**
 * Generate a storyboard from script content using OpenAI GPT-4o.
 *
 * @param apiKey - OpenAI API key
 * @param content - Script/content text to break into scenes
 * @param targetDuration - Target total video duration in seconds
 * @param options - Generation options
 * @returns Array of storyboard segments (empty on failure)
 */
export async function analyzeContent(
  apiKey: string,
  content: string,
  targetDuration?: number,
  options?: { creativity?: "low" | "high" }
): Promise<StoryboardSegment[]> {
  const creativity = options?.creativity || "low";
  const systemPrompt = buildStoryboardSystemPrompt(targetDuration, creativity);
  const temperature = creativity === "high" ? 1.0 : 0.7;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildStoryboardUserMessage(content) },
        ],
        temperature,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenAI] Storyboard API error (${response.status}): ${errorText.slice(0, 300)}`);
      return [];
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      console.error("[OpenAI] No content in storyboard response");
      return [];
    }

    // OpenAI with json_object mode returns valid JSON, but it may wrap the array
    // in an object like { "segments": [...] } or { "storyboard": [...] }
    const parsed = JSON.parse(text);

    // If it's already an array, return directly
    if (Array.isArray(parsed)) {
      return parsed as StoryboardSegment[];
    }

    // Otherwise find the first array value in the response object
    for (const value of Object.values(parsed)) {
      if (Array.isArray(value)) {
        return value as StoryboardSegment[];
      }
    }

    // Fallback: try extracting JSON array with regex
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]) as StoryboardSegment[];
    }

    console.error("[OpenAI] Could not extract storyboard array from response");
    return [];
  } catch (err) {
    console.error(`[OpenAI] Storyboard error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}
