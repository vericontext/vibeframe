import type { AIProvider, AICapability, ProviderConfig } from "../interface/types.js";
import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { analyzeContent as analyzeContentImpl } from "./openai-storyboard.js";
import { defaultModel } from "../catalog/catalog.js";
import { openaiGenerateText } from "./openai-text.js";
import type { TextGenerator, TextRequest, TextResult } from "../text/contract.js";

/**
 * OpenAI GPT provider: text generation, narration scripts, and storyboards.
 */
export class OpenAIProvider implements AIProvider, TextGenerator {
  id = "openai-gpt";
  name = "OpenAI GPT";
  description = "Text generation, narration scripts, and storyboards with GPT";
  capabilities: AICapability[] = [];
  iconUrl = "/icons/openai.svg";
  isAvailable = true;
  readonly textProvider = "openai";

  private apiKey?: string;
  private baseUrl = "https://api.openai.com/v1";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** One bounded model call; see the text contract. Throws `ProviderError`. */
  async generateText(request: TextRequest): Promise<TextResult> {
    return openaiGenerateText({ apiKey: this.apiKey, baseUrl: this.baseUrl }, request);
  }

  async generateNarrationScript(
    videoAnalysis: string,
    duration: number,
    style: "informative" | "energetic" | "calm" | "dramatic" = "informative",
    language: string = "en"
  ): Promise<{
    success: boolean;
    script?: string;
    segments?: Array<{ startTime: number; endTime: number; text: string }>;
    error?: string;
  }> {
    if (!this.apiKey) {
      return { success: false, error: "OpenAI API key not configured" };
    }

    const styleGuides: Record<string, string> = {
      informative: "Clear, educational, and objective. Focus on facts and explanations. Professional but accessible tone.",
      energetic: "Enthusiastic, dynamic, and engaging. Use active language and build excitement. Great for action content.",
      calm: "Soothing, gentle, and peaceful. Measured pace with thoughtful pauses. Ideal for nature or meditation content.",
      dramatic: "Cinematic and emotional. Build tension and create impact. Use powerful language and evocative descriptions.",
    };

    const languageInstructions = language === "en"
      ? ""
      : `IMPORTANT: Write the narration script in ${language} language.`;

    const systemPrompt = `You are an expert video narrator creating voiceover scripts.

Target duration: ${duration} seconds (approximately ${Math.round(duration * 2.5)} words at normal speaking pace)
Style: ${style} - ${styleGuides[style]}
${languageInstructions}

Based on the video analysis provided, write a narration script that:
1. Matches the visual content timing
2. Enhances viewer understanding without being redundant
3. Maintains the specified style throughout
4. Is the right length for the duration (2-3 words per second)
5. Has natural flow and rhythm for voiceover delivery

IMPORTANT: Respond with JSON only:
{
  "script": "The complete narration script as a single string...",
  "segments": [
    {"startTime": 0, "endTime": 5.5, "text": "First segment of narration..."},
    {"startTime": 5.5, "endTime": 12.0, "text": "Second segment..."}
  ]
}

The segments should divide the script into natural phrases that align with video scenes.
Each segment should be 3-10 seconds long.`;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: defaultModel("openai", "llm").id,
          // Reasoning tokens count against this cap.
          max_completion_tokens: 16384,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Create a narration script for this video:\n\n${videoAnalysis}` },
          ],
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API error: ${response.status} ${error}` };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return { success: false, error: "No response from OpenAI" };
      }

      const result = JSON.parse(content) as {
        script: string;
        segments?: Array<{ startTime: number; endTime: number; text: string }>;
      };

      return {
        success: true,
        script: result.script,
        segments: result.segments || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate narration script",
      };
    }
  }

  /**
   * Generate a storyboard from script content using GPT-5.4 mini.
   * Alternative to ClaudeProvider.analyzeContent for when Claude is unavailable.
   */
  async analyzeContent(
    content: string,
    targetDuration?: number,
    options?: { creativity?: "low" | "high" }
  ): Promise<StoryboardSegment[]> {
    if (!this.apiKey) return [];
    return analyzeContentImpl(this.apiKey, content, targetDuration, options);
  }
}

export const openaiProvider = new OpenAIProvider();
