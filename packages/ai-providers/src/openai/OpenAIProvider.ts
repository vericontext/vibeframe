import type { Clip } from "@vibeframe/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  CommandParseResult,
  TimelineCommand,
} from "../interface/types.js";

/**
 * OpenAI GPT provider for natural language timeline commands
 */
export class OpenAIProvider implements AIProvider {
  id = "openai-gpt";
  name = "OpenAI GPT";
  description = "Natural language timeline control using GPT-4";
  capabilities: AICapability[] = ["natural-language-command"];
  iconUrl = "/icons/openai.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.openai.com/v1";
  private model = "gpt-4o-mini";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async parseCommand(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult> {
    if (!this.apiKey) {
      return {
        success: false,
        commands: [],
        error: "OpenAI API key not configured",
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
- add-track: Add new track (params: trackType: video|audio)
- export: Export project (params: format, quality)
- speed-change: Change clip playback speed (params: speed - e.g., 2 for 2x, 0.5 for half speed)
- reverse: Reverse clip playback (no params needed)
- crop: Crop/resize video (params: aspectRatio OR x, y, width, height)
- position: Move clips to beginning/end/middle (params: position - "beginning", "end", "middle")

Available effect types: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia
Available transition types: crossfade, wipe, slide, fade

Current timeline state:
Clips: ${JSON.stringify(clipsInfo, null, 2)}
Tracks: ${JSON.stringify(context.tracks)}

Rules:
1. If user says "all clips" or "every clip", include all clip IDs
2. If user references "first", "last", "intro", "outro", map to appropriate clips
3. Time can be specified as "3s", "3 seconds", "00:03", etc.
4. If command is ambiguous, set clarification field
5. Multiple commands can be returned for complex instructions
6. For "speed up" use speed > 1, for "slow down" use speed < 1
7. For crop to portrait, use aspectRatio: "9:16", for square use "1:1"
8. "reverse" flips the clip playback backwards

Respond with JSON only:
{
  "success": true,
  "commands": [
    {
      "action": "trim",
      "clipIds": ["clip-id"],
      "params": {"newDuration": 5},
      "description": "Trim clip to 5 seconds"
    }
  ]
}

Or if clarification needed:
{
  "success": true,
  "commands": [],
  "clarification": "Which clip do you want to trim?"
}`;

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: instruction },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("OpenAI API error:", error);
        return this.fallbackParse(instruction, context);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string };
        }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return this.fallbackParse(instruction, context);
      }

      const result = JSON.parse(content) as CommandParseResult;
      return {
        success: result.success ?? true,
        commands: result.commands || [],
        error: result.error,
        clarification: result.clarification,
      };
    } catch (error) {
      console.error("OpenAI parseCommand error:", error);
      return this.fallbackParse(instruction, context);
    }
  }

  /**
   * Fallback to simple pattern matching when API fails
   */
  private fallbackParse(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): CommandParseResult {
    const commands: TimelineCommand[] = [];
    const lower = instruction.toLowerCase();
    const allClipIds = context.clips.map((c) => c.id);

    // Trim commands
    if (lower.includes("trim") || lower.includes("shorten") || lower.includes("cut")) {
      const timeMatch = lower.match(/(\d+)\s*(s|sec|seconds?)/);
      const duration = timeMatch ? parseInt(timeMatch[1]) : 3;

      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "trim",
        clipIds: targetClips,
        params: { newDuration: duration },
        description: `Trim ${targetClips.length > 1 ? "all clips" : "clip"} to ${duration} seconds`,
      });
    }

    // Fade effects
    if (lower.includes("fade")) {
      const isFadeOut = lower.includes("out");
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "add-effect",
        clipIds: targetClips,
        params: {
          effectType: isFadeOut ? "fadeOut" : "fadeIn",
          duration: 1,
        },
        description: `Add fade ${isFadeOut ? "out" : "in"} effect`,
      });
    }

    // Split commands
    if (lower.includes("split")) {
      const timeMatch = lower.match(/(\d+)\s*(s|sec|seconds?)/);
      const splitTime = timeMatch ? parseInt(timeMatch[1]) : 5;

      commands.push({
        action: "split",
        clipIds: allClipIds.slice(0, 1),
        params: { splitTime },
        description: `Split clip at ${splitTime} seconds`,
      });
    }

    // Delete commands
    if (lower.includes("delete") || lower.includes("remove")) {
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(-1);

      commands.push({
        action: "remove-clip",
        clipIds: targetClips,
        params: {},
        description: `Remove ${targetClips.length > 1 ? "all clips" : "clip"}`,
      });
    }

    // Duplicate commands
    if (lower.includes("duplicate") || lower.includes("copy")) {
      commands.push({
        action: "duplicate",
        clipIds: allClipIds.slice(0, 1),
        params: {},
        description: "Duplicate clip",
      });
    }

    // Speed commands
    if (lower.includes("speed up") || lower.includes("faster")) {
      const speedMatch = lower.match(/(\d+(?:\.\d+)?)\s*x/);
      const speed = speedMatch ? parseFloat(speedMatch[1]) : 2.0;
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "speed-change",
        clipIds: targetClips,
        params: { speed },
        description: `Speed up to ${speed}x`,
      });
    }

    if (lower.includes("slow") || lower.includes("slower")) {
      const speedMatch = lower.match(/(\d+(?:\.\d+)?)\s*x/);
      const speed = speedMatch ? parseFloat(speedMatch[1]) : 0.5;
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "speed-change",
        clipIds: targetClips,
        params: { speed: speed > 1 ? 1 / speed : speed },
        description: `Slow down to ${speed > 1 ? (1 / speed).toFixed(2) : speed}x`,
      });
    }

    // Reverse commands
    if (lower.includes("reverse") || lower.includes("backwards")) {
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "reverse",
        clipIds: targetClips,
        params: {},
        description: "Reverse clip playback",
      });
    }

    // Crop commands
    if (lower.includes("crop") || lower.includes("portrait") || lower.includes("vertical") || lower.includes("square")) {
      let aspectRatio = "16:9";
      if (lower.includes("portrait") || lower.includes("vertical") || lower.includes("9:16")) {
        aspectRatio = "9:16";
      } else if (lower.includes("square") || lower.includes("1:1")) {
        aspectRatio = "1:1";
      } else if (lower.includes("4:5")) {
        aspectRatio = "4:5";
      }

      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "crop",
        clipIds: targetClips,
        params: { aspectRatio },
        description: `Crop to ${aspectRatio} aspect ratio`,
      });
    }

    // Position commands
    if (lower.includes("beginning") || lower.includes("start")) {
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "position",
        clipIds: targetClips,
        params: { position: "beginning" },
        description: "Move clip to beginning",
      });
    }

    if (lower.includes("end") && (lower.includes("move") || lower.includes("put"))) {
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "position",
        clipIds: targetClips,
        params: { position: "end" },
        description: "Move clip to end",
      });
    }

    if (lower.includes("middle") || lower.includes("center")) {
      const targetClips = lower.includes("all") ? allClipIds : allClipIds.slice(0, 1);

      commands.push({
        action: "position",
        clipIds: targetClips,
        params: { position: "middle" },
        description: "Move clip to middle",
      });
    }

    if (commands.length === 0) {
      return {
        success: false,
        commands: [],
        error: "Could not understand command. Try: trim, fade, split, delete, duplicate, speed up, slow down, reverse, crop, move to beginning/end",
      };
    }

    return { success: true, commands };
  }
}

export const openaiProvider = new OpenAIProvider();
