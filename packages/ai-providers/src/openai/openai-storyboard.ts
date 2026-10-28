/**
 * @module openai-storyboard
 *
 * Storyboard generation on the OpenAI default text model.
 * Uses the same shared prompt as Claude and Gemini storyboard generators.
 */

import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { parseJsonReply } from "../shared/json-reply.js";
import { buildStoryboardSystemPrompt, buildStoryboardUserMessage } from "../storyboard-prompt.js";
import { openaiGenerateText } from "./openai-text.js";

/**
 * Generate a storyboard from script content. Throws a `ProviderError` on
 * every failure, including a reply with no storyboard array.
 *
 * @param api - OpenAI API key and base URL
 * @param content - Script/content text to break into scenes
 * @param targetDuration - Target total video duration in seconds
 * @param options - Generation options
 */
export async function analyzeContent(
  api: { apiKey?: string; baseUrl: string },
  content: string,
  targetDuration?: number,
  options?: { creativity?: "low" | "high" }
): Promise<StoryboardSegment[]> {
  const { text } = await openaiGenerateText(api, {
    // Segments carry optional fields, which a strict JSON schema cannot
    // express, so the array is asked for inside a "segments" object.
    system:
      buildStoryboardSystemPrompt(targetDuration, options?.creativity || "low") +
      '\n\nWrap the array in a JSON object: {"segments": [ ...segment objects... ]}.',
    messages: [{ role: "user", content: buildStoryboardUserMessage(content) }],
    maxOutputTokens: 16384,
  });
  const reply = parseJsonReply<{ segments: StoryboardSegment[] }>(text, {
    provider: "openai",
    label: "OpenAI",
    task: "storyboard",
    shape: "object",
    isValid: (value) => Array.isArray(value.segments),
  });
  return reply.segments;
}
