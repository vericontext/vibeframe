import type {
  AIProvider,
  AICapability,
  ProviderConfig,
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
} from "../interface/types.js";

import type { ClaudeApiParams } from "./claude-api.js";
import { claudeGenerateText } from "./claude-text.js";
import type { TextGenerator, TextRequest, TextResult } from "../text/contract.js";

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
import { defaultModel, listModels } from "../catalog/catalog.js";

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
export class ClaudeProvider implements AIProvider, TextGenerator {
  id = "claude";
  name = "Anthropic Claude";
  description = "AI-powered motion graphics, content analysis, storyboarding, highlight detection, B-roll matching, and viral optimization";
  capabilities: AICapability[] = ["highlight-detection", "b-roll-matching", "viral-optimization"];
  iconUrl = "/icons/claude.svg";
  isAvailable = true;
  readonly textProvider = "claude";

  private apiKey?: string;
  private baseUrl = "https://api.anthropic.com/v1";
  private model = defaultModel("claude", "llm").id;

  /** Supported model aliases for motion graphic generation (from the model catalog). */
  static readonly MOTION_MODELS: Readonly<Record<string, string>> = Object.fromEntries(
    listModels({ provider: "claude", kind: "llm" }).flatMap((m) => (m.aliases ?? []).map((a) => [a, m.id]))
  );

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

  /** One bounded model call; see the text contract. Throws `ProviderError`. */
  async generateText(request: TextRequest): Promise<TextResult> {
    return claudeGenerateText({ apiKey: this.apiKey, baseUrl: this.baseUrl }, request);
  }

  /** Get API params for helper functions (null if not configured) */
  private get api(): ClaudeApiParams | null {
    if (!this.apiKey) return null;
    return { apiKey: this.apiKey, baseUrl: this.baseUrl, model: this.model };
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
