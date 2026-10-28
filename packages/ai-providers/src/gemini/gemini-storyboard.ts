/**
 * @module gemini-storyboard
 *
 * Storyboard generation using the shared Gemini one-shot default.
 * Uses the same shared prompt as Claude and OpenAI storyboard generators.
 */

import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { parseJsonReply } from "../shared/json-reply.js";
import { buildStoryboardSystemPrompt, buildStoryboardUserMessage } from "../storyboard-prompt.js";
import { GEMINI_DEFAULT_TEXT_MODEL } from "./gemini-models.js";
import { geminiGenerateContent } from "./gemini-text.js";

/** Parameters for Gemini API calls */
export interface GeminiApiParams {
  apiKey?: string;
  baseUrl: string;
}

/**
 * Generate a storyboard from script content using the shared Gemini default.
 * Throws a `ProviderError` on every failure, including a reply with no
 * storyboard array.
 *
 * @param api - Gemini API parameters (apiKey, baseUrl)
 * @param content - Script/content text to break into scenes
 * @param targetDuration - Target total video duration in seconds
 * @param options - Generation options
 */
export async function analyzeContent(
  api: GeminiApiParams,
  content: string,
  targetDuration?: number,
  options?: { creativity?: "low" | "high" }
): Promise<StoryboardSegment[]> {
  const { text } = await geminiGenerateContent(api, {
    model: GEMINI_DEFAULT_TEXT_MODEL,
    system: buildStoryboardSystemPrompt(targetDuration, options?.creativity || "low"),
    contents: [{ role: "user", parts: [{ text: buildStoryboardUserMessage(content) }] }],
    maxOutputTokens: 16384,
  });
  return parseJsonReply<StoryboardSegment[]>(text, { provider: "gemini", label: "Gemini", task: "storyboard", shape: "array" });
}
