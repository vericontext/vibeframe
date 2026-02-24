import type { Clip } from "@vibeframe/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  EditSuggestion,
  TranscriptSegment,
  Highlight,
  HighlightCriteria,
  BrollClipInfo,
  NarrationSegment,
  BrollMatch,
  ViralAnalysis,
  PlatformSpec,
  PlatformCut,
  TimeSeconds,
  CommandParseResult,
} from "../interface/types.js";

import type { ClaudeApiParams } from "./claude-api.js";

// Import helper functions used by delegate methods
import { generateMotion, refineMotion, analyzeContent } from "./claude-motion.js";
import {
  analyzeForHighlights,
  analyzeBrollContent,
  analyzeNarrationForVisuals,
  matchBrollToNarration,
} from "./claude-analysis.js";
import {
  analyzeViralPotential,
  suggestPlatformCuts,
  generateViralCaptions,
} from "./claude-viral.js";
import {
  analyzeColorGrade,
  analyzeForSpeedRamp,
  analyzeFrameForReframe,
  generateNarrationScript,
} from "./claude-visual-fx.js";

/**
 * Motion graphic generation options
 */
export interface MotionOptions {
  /** Duration in seconds */
  duration?: number;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Frame rate */
  fps?: number;
  /** Style preset */
  style?: "minimal" | "corporate" | "playful" | "cinematic" | "fullscreen" | "hud" | "split";
  /** Visual context from Gemini analysis of the source image or video */
  videoContext?: string;
  /** Whether the context came from an image or video analysis */
  sourceType?: "image" | "video";
}

/**
 * Generated Remotion component
 */
export interface RemotionComponent {
  /** Component name */
  name: string;
  /** JSX/TSX code */
  code: string;
  /** Duration in frames */
  durationInFrames: number;
  /** Frame rate */
  fps: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
  /** Description of what was generated */
  description: string;
}

/**
 * Motion graphic generation result
 */
export interface MotionResult {
  success: boolean;
  /** Generated Remotion component */
  component?: RemotionComponent;
  /** Error message if failed */
  error?: string;
}

/**
 * Storyboard segment
 */
export interface StoryboardSegment {
  /** Segment index */
  index: number;
  /** Start time in seconds */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Description of what happens */
  description: string;
  /** Suggested visuals */
  visuals: string;
  /** Voiceover narration script */
  narration?: string;
  /** Consistent visual style reference for all scenes */
  visualStyle?: string;
  /** Detailed character description for consistency across scenes */
  characterDescription?: string;
  /** How this scene connects to the previous one */
  previousSceneLink?: string;
  /** Suggested background audio/music */
  audio?: string;
  /** Text overlays */
  textOverlays?: string[];
}

/**
 * Claude provider for AI-powered content creation
 */
export class ClaudeProvider implements AIProvider {
  id = "claude";
  name = "Anthropic Claude";
  description = "AI-powered motion graphics, content analysis, storyboarding, highlight detection, B-roll matching, and viral optimization";
  capabilities: AICapability[] = ["auto-edit", "natural-language-command", "highlight-detection", "b-roll-matching", "viral-optimization"];
  iconUrl = "/icons/claude.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.anthropic.com/v1";
  private model = "claude-sonnet-4-6";

  /** Supported model aliases for motion graphic generation */
  static readonly MOTION_MODELS = {
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
  } as const;

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

  /** Get API params for helper functions (null if not configured) */
  private get api(): ClaudeApiParams | null {
    if (!this.apiKey) return null;
    return { apiKey: this.apiKey, baseUrl: this.baseUrl, model: this.model };
  }

  // ---------------------------------------------------------------------------
  // Core methods (parseCommand, autoEdit) — kept inline since they are small
  // ---------------------------------------------------------------------------

  /**
   * Parse natural language command into structured timeline operations
   */
  async parseCommand(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult> {
    if (!this.api) {
      return { success: false, commands: [], error: "Claude API key not configured" };
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

      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          messages: [{ role: "user", content: instruction }],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Claude API error:", error);
        return { success: false, commands: [], error: `API error: ${response.status}` };
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const textContent = data.content?.find((c) => c.type === "text");
      if (!textContent?.text) {
        return { success: false, commands: [], error: "No response from Claude" };
      }

      // Extract JSON from response (Claude may include markdown code blocks)
      let jsonText = textContent.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const result = JSON.parse(jsonText) as CommandParseResult;
      return {
        success: result.success ?? true,
        commands: result.commands || [],
        error: result.error,
        clarification: result.clarification,
      };
    } catch (error) {
      console.error("Claude parseCommand error:", error);
      return {
        success: false,
        commands: [],
        error: error instanceof Error ? error.message : "Failed to parse command",
      };
    }
  }

  /**
   * Get edit suggestions using Claude (implements AIProvider interface)
   */
  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    if (!this.api) return [];

    const clipsInfo = clips.map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      duration: clip.duration,
      effects: clip.effects?.map((e) => e.type) || [],
    }));

    const systemPrompt = `You are a video editor. Analyze clips and suggest edits.

Respond with JSON array:
[
  {
    "type": "trim|cut|add-effect|reorder|delete|split|merge",
    "description": "What this edit does",
    "clipIds": ["clip-id"],
    "params": {},
    "confidence": 0.9
  }
]`;

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: `Clips: ${JSON.stringify(clipsInfo)}\n\nInstruction: ${instruction}`,
          }],
          system: systemPrompt,
        }),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) return [];

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

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
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Delegated methods — Motion (claude-motion.ts)
  // ---------------------------------------------------------------------------

  async generateMotion(description: string, options: MotionOptions = {}): Promise<MotionResult> {
    if (!this.api) return { success: false, error: "Claude API key not configured" };
    return generateMotion(this.api, description, options);
  }

  async refineMotion(existingCode: string, instructions: string, options: MotionOptions = {}): Promise<MotionResult> {
    if (!this.api) return { success: false, error: "Claude API key not configured" };
    return refineMotion(this.api, existingCode, instructions, options);
  }

  async analyzeContent(
    content: string,
    targetDuration?: number,
    options?: { creativity?: "low" | "high" }
  ): Promise<StoryboardSegment[]> {
    if (!this.api) return [];
    return analyzeContent(this.api, content, targetDuration, options);
  }

  // ---------------------------------------------------------------------------
  // Delegated methods — Analysis (claude-analysis.ts)
  // ---------------------------------------------------------------------------

  async analyzeForHighlights(
    segments: TranscriptSegment[],
    options: { criteria?: HighlightCriteria; targetDuration?: number; maxCount?: number } = {}
  ): Promise<Highlight[]> {
    if (!this.api) return [];
    return analyzeForHighlights(this.api, segments, options);
  }

  async analyzeBrollContent(
    frameBase64: string,
    fileName: string,
    mimeType: string = "image/jpeg"
  ): Promise<{ description: string; tags: string[] }> {
    if (!this.api) return { description: "Unknown content", tags: [] };
    return analyzeBrollContent(this.api, frameBase64, fileName, mimeType);
  }

  async analyzeNarrationForVisuals(
    segments: Array<{ startTime: number; endTime: number; text: string }>
  ): Promise<NarrationSegment[]> {
    if (!this.api) {
      return segments.map((seg, i) => ({
        index: i,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        visualDescription: "",
        suggestedBrollTags: [],
      }));
    }
    return analyzeNarrationForVisuals(this.api, segments);
  }

  async matchBrollToNarration(
    narrationSegments: NarrationSegment[],
    brollClips: BrollClipInfo[]
  ): Promise<BrollMatch[]> {
    if (!this.api) return [];
    return matchBrollToNarration(this.api, narrationSegments, brollClips);
  }

  // ---------------------------------------------------------------------------
  // Delegated methods — Viral (claude-viral.ts)
  // ---------------------------------------------------------------------------

  async analyzeViralPotential(
    transcriptSegments: TranscriptSegment[],
    projectMeta: { duration: number; clipCount: number },
    targetPlatforms: string[]
  ): Promise<ViralAnalysis> {
    if (!this.api) {
      return {
        overallScore: 0,
        hookStrength: 0,
        pacing: "moderate",
        emotionalPeaks: [],
        suggestedCuts: [],
        platforms: {},
        hookRecommendation: { suggestedStartTime: 0, reason: "API key not configured" },
      };
    }
    return analyzeViralPotential(this.api, transcriptSegments, projectMeta, targetPlatforms);
  }

  async suggestPlatformCuts(
    transcriptSegments: TranscriptSegment[],
    viralAnalysis: ViralAnalysis,
    platform: PlatformSpec,
    clips: Array<{ id: string; startTime: number; duration: number }>
  ): Promise<PlatformCut> {
    if (!this.api) return { platform: platform.id, segments: [], totalDuration: 0 };
    return suggestPlatformCuts(this.api, transcriptSegments, viralAnalysis, platform, clips);
  }

  async generateViralCaptions(
    transcriptSegments: TranscriptSegment[],
    style: "minimal" | "bold" | "animated"
  ): Promise<Array<{ startTime: TimeSeconds; endTime: TimeSeconds; text: string; style: string }>> {
    if (!this.api) return [];
    return generateViralCaptions(this.api, transcriptSegments, style);
  }

  // ---------------------------------------------------------------------------
  // Delegated methods — Visual FX (claude-visual-fx.ts)
  // ---------------------------------------------------------------------------

  async analyzeColorGrade(
    style: string,
    preset?: string
  ): Promise<{ ffmpegFilter: string; description: string }> {
    return analyzeColorGrade(this.api, style, preset);
  }

  async analyzeForSpeedRamp(
    segments: TranscriptSegment[],
    options: { style?: "dramatic" | "smooth" | "action"; minSpeed?: number; maxSpeed?: number } = {}
  ): Promise<{ keyframes: Array<{ time: number; speed: number; reason: string }> }> {
    if (!this.api) return { keyframes: [] };
    return analyzeForSpeedRamp(this.api, segments, options);
  }

  async analyzeFrameForReframe(
    frameBase64: string,
    targetAspect: string,
    options: {
      focusMode?: "auto" | "face" | "center" | "action";
      sourceWidth: number;
      sourceHeight: number;
      mimeType?: string;
    }
  ): Promise<{
    cropX: number;
    cropY: number;
    cropWidth: number;
    cropHeight: number;
    confidence: number;
    subjectDescription: string;
  }> {
    return analyzeFrameForReframe(this.api, frameBase64, targetAspect, options);
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
    if (!this.api) return { success: false, error: "Claude API key not configured" };
    return generateNarrationScript(this.api, videoAnalysis, duration, style, language);
  }
}

export const claudeProvider = new ClaudeProvider();
