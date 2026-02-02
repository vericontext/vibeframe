import type { Clip } from "@vibeframe/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
  EditSuggestion,
} from "../interface/types.js";

/**
 * Image generation options for Gemini Imagen
 */
export interface GeminiImageOptions {
  /** Number of images to generate (1-4) */
  numberOfImages?: number;
  /** Aspect ratio */
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  /** Safety filter level */
  safetyFilterLevel?: "block_low_and_above" | "block_medium_and_above" | "block_only_high";
  /** Person generation setting */
  personGeneration?: "dont_allow" | "allow_adult";
}

/**
 * Image generation result
 */
export interface GeminiImageResult {
  success: boolean;
  images?: Array<{
    base64: string;
    mimeType: string;
  }>;
  error?: string;
}

/**
 * Google Gemini provider for AI video generation, image generation, and editing
 */
export class GeminiProvider implements AIProvider {
  id = "gemini";
  name = "Google Gemini";
  description = "AI video generation, image generation (Imagen 3), and smart editing suggestions";
  capabilities: AICapability[] = ["text-to-video", "auto-edit", "text-to-image"];
  iconUrl = "/icons/gemini.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async generateVideo(
    _prompt: string,
    _options?: GenerateOptions
  ): Promise<VideoResult> {
    if (!this.apiKey) {
      return {
        id: "",
        status: "failed",
        error: "Gemini API key not configured",
      };
    }

    // TODO: Implement actual Gemini Veo API integration when available
    // For now, return a mock response
    const id = crypto.randomUUID();

    return {
      id,
      status: "pending",
      progress: 0,
      estimatedTimeRemaining: 60,
    };
  }

  async getGenerationStatus(id: string): Promise<VideoResult> {
    // TODO: Implement actual status check
    return {
      id,
      status: "processing",
      progress: 50,
      estimatedTimeRemaining: 30,
    };
  }

  async cancelGeneration(_id: string): Promise<boolean> {
    // TODO: Implement cancellation
    return true;
  }

  /**
   * Generate images using Gemini (Nano Banana)
   * Uses generateContent with responseModalities: ["TEXT", "IMAGE"]
   */
  async generateImage(
    prompt: string,
    options: GeminiImageOptions = {}
  ): Promise<GeminiImageResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Google API key not configured",
      };
    }

    try {
      // Use Gemini 2.5 Flash Image model (Nano Banana)
      const response = await fetch(
        `${this.baseUrl}/models/gemini-2.5-flash-image:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: {
                aspectRatio: options.aspectRatio || "1:1",
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error?.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          success: false,
          error: `API error (${response.status}): ${errorMessage}`,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              inlineData?: {
                mimeType: string;
                data: string;
              };
            }>;
          };
        }>;
      };

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        return {
          success: false,
          error: "No content in response",
        };
      }

      // Extract images from parts
      const images: Array<{ base64: string; mimeType: string }> = [];
      for (const part of parts) {
        if (part.inlineData) {
          images.push({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
          });
        }
      }

      if (images.length === 0) {
        return {
          success: false,
          error: "No images in response",
        };
      }

      return {
        success: true,
        images,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const clipsInfo = clips.map((clip) => ({
        id: clip.id,
        startTime: clip.startTime,
        duration: clip.duration,
        effects: clip.effects?.map((e) => e.type) || [],
      }));

      const prompt = `You are a video editing assistant. Analyze the following clips and user instruction to suggest edits.

Clips:
${JSON.stringify(clipsInfo, null, 2)}

User instruction: "${instruction}"

Respond with a JSON array of edit suggestions. Each suggestion should have:
- type: one of "trim", "cut", "add-effect", "reorder", "delete", "split", "merge"
- description: brief explanation of the edit
- clipIds: array of clip IDs to apply this edit to
- params: object with parameters for the edit (e.g., newDuration, effectType, startTime)
- confidence: number 0-1 indicating confidence

Available effect types: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia

Example response:
[{"type":"trim","description":"Trim intro to 3 seconds","clipIds":["clip-1"],"params":{"newDuration":3},"confidence":0.9}]

Respond with ONLY the JSON array, no other text.`;

      const response = await fetch(
        `${this.baseUrl}/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1024,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error("Gemini API error:", error);
        return this.fallbackAutoEdit(clips, instruction);
      }

      const data = await response.json() as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.fallbackAutoEdit(clips, instruction);
      }

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        type: string;
        description: string;
        clipIds: string[];
        params: Record<string, unknown>;
        confidence: number;
      }>;

      return suggestions.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type as EditSuggestion["type"],
        description: s.description,
        clipIds: s.clipIds,
        params: s.params,
        confidence: s.confidence,
      }));
    } catch (error) {
      console.error("Gemini autoEdit error:", error);
      return this.fallbackAutoEdit(clips, instruction);
    }
  }

  /**
   * Fallback to simple pattern matching when API fails
   */
  private fallbackAutoEdit(clips: Clip[], instruction: string): EditSuggestion[] {
    const suggestions: EditSuggestion[] = [];
    const lowerInstruction = instruction.toLowerCase();

    if (lowerInstruction.includes("trim") || lowerInstruction.includes("shorten")) {
      const timeMatch = lowerInstruction.match(/(\d+)\s*(s|sec|seconds?)/);
      const duration = timeMatch ? parseInt(timeMatch[1]) : 3;

      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "trim",
          description: `Trim clip to ${duration} seconds`,
          clipIds: [clip.id],
          params: { newDuration: duration },
          confidence: 0.8,
        });
      });
    }

    if (lowerInstruction.includes("fade")) {
      const isFadeOut = lowerInstruction.includes("out");
      clips.forEach((clip) => {
        suggestions.push({
          id: crypto.randomUUID(),
          type: "add-effect",
          description: `Add fade ${isFadeOut ? "out" : "in"} effect`,
          clipIds: [clip.id],
          params: {
            effectType: isFadeOut ? "fadeOut" : "fadeIn",
            duration: 1,
          },
          confidence: 0.9,
        });
      });
    }

    return suggestions;
  }
}

export const geminiProvider = new GeminiProvider();
