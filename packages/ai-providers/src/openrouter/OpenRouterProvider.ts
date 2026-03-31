import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  CommandParseResult,
  TimelineCommand,
} from "../interface/types.js";
import type { Clip } from "@vibeframe/core";

/**
 * OpenRouter provider for accessing multiple LLM models through a unified API.
 * OpenRouter provides an OpenAI-compatible API that routes to 300+ models
 * from OpenAI, Anthropic, Google, Meta, Mistral, and more.
 *
 * Default model: openrouter/auto (automatically selects the best model)
 */
export class OpenRouterProvider implements AIProvider {
  id = "openrouter";
  name = "OpenRouter";
  description = "Access 300+ AI models through a unified OpenAI-compatible API";
  capabilities: AICapability[] = ["natural-language-command"];
  iconUrl = "/icons/openrouter.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://openrouter.ai/api/v1";
  private model = "openrouter/auto";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
    if (config.model) {
      this.model = config.model;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Parse natural language command using OpenRouter
   */
  async parseCommand(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult> {
    if (!this.apiKey) {
      return {
        success: false,
        commands: [],
        error: "OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable.",
      };
    }

    try {
      const clipsInfo = context.clips.map((clip) => ({
        id: clip.id,
        name: clip.sourceId,
        startTime: clip.startTime,
        duration: clip.duration,
        trackId: clip.trackId,
        effects: clip.effects?.map((e) => e.type) || [],
      }));

      const systemPrompt = `You are a video editing assistant that converts natural language commands into structured timeline operations.

Available actions:
- add-clip: Add a new clip (params: sourceId, startTime, duration, trackId)
- remove-clip: Remove clip(s) (clipIds required)
- trim: Trim clip duration (params: startTrim, endTrim, or newDuration)
- split: Split clip at time (params: splitTime - relative to clip start)
- move: Move clip (params: newStartTime, newTrackId)
- duplicate: Duplicate clip (params: newStartTime optional)
- add-effect: Add effect (params: effectType, duration, intensity)
- remove-effect: Remove effect (params: effectType)
- set-volume: Set audio volume (params: volume 0-1)
- add-transition: Add transition between clips (params: transitionType, duration)
- add-track: Add a new track
- export: Export project (params: format, quality)
- speed-change: Change playback speed (params: speed)
- reverse: Reverse clip playback
- crop: Crop clip (params: x, y, width, height)
- position: Reposition clip (params: x, y)

Current timeline:
- Clips: ${JSON.stringify(clipsInfo)}
- Tracks: ${JSON.stringify(context.tracks)}

Return a JSON object with:
- commands: array of { action, clipIds, params, description }
- Each command must have: action (string), clipIds (string[]), params (object), description (string)`;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://vibeframe.dev",
          "X-Title": "VibeFrame",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: instruction },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `OpenRouter API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
          }
        } catch {
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }
        return {
          success: false,
          commands: [],
          error: errorMessage,
        };
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: { content: string };
        }>;
      };

      const content = data.choices[0]?.message?.content;
      if (!content) {
        return {
          success: false,
          commands: [],
          error: "Empty response from OpenRouter",
        };
      }

      const parsed = JSON.parse(content) as {
        commands: Array<{
          action: string;
          clipIds?: string[];
          params?: Record<string, unknown>;
          description?: string;
        }>;
      };

      return {
        success: true,
        commands: parsed.commands.map((cmd) => ({
          action: cmd.action as TimelineCommand["action"],
          clipIds: cmd.clipIds || [],
          params: cmd.params || {},
          description: cmd.description || cmd.action,
        })),
      };
    } catch (error) {
      return {
        success: false,
        commands: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const openRouterProvider = new OpenRouterProvider();
