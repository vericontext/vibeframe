import type { AIProvider, AICapability, ProviderConfig } from "../interface/types.js";
import type { StoryboardSegment } from "../claude/ClaudeProvider.js";
import { analyzeContent as analyzeContentImpl } from "./openai-storyboard.js";
import { isText, parseJsonReply } from "../shared/json-reply.js";
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

  /** Write a narration script for a video analysis. Throws a `ProviderError` on every failure. */
  async generateNarrationScript(
    videoAnalysis: string,
    duration: number,
    style: "informative" | "energetic" | "calm" | "dramatic" = "informative",
    language: string = "en"
  ): Promise<{ script: string; segments: Array<{ startTime: number; endTime: number; text: string }> }> {

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

    const { text } = await openaiGenerateText({ apiKey: this.apiKey, baseUrl: this.baseUrl }, {
      system: systemPrompt,
      messages: [{ role: "user", content: `Create a narration script for this video:\n\n${videoAnalysis}` }],
      maxOutputTokens: 16384,
    });
    const result = parseJsonReply<{
      script: string;
      segments?: Array<{ startTime: number; endTime: number; text: string }>;
    }>(text, { provider: "openai", label: "OpenAI", task: "narration script", shape: "object", isValid: (value) => isText(value.script) });
    return { script: result.script, segments: result.segments ?? [] };
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
    return analyzeContentImpl({ apiKey: this.apiKey, baseUrl: this.baseUrl }, content, targetDuration, options);
  }
}

export const openaiProvider = new OpenAIProvider();
