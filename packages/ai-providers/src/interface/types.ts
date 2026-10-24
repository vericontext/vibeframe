/**
 * @module types
 * @description Shared types for the AI provider system.
 *
 * Defines capability enums, generation options and results, transcription types,
 * edit suggestions, highlight detection, B-roll matching, viral optimization,
 * and the core {@link AIProvider} interface.
 */

import type { TimeSeconds } from "@vibeframe/core";

/** Re-export TimeSeconds for use by consumers. */
export type { TimeSeconds } from "@vibeframe/core";

/**
 * Capabilities that an AI provider can declare support for
 * (e.g., `"text-to-video"`, `"vision"`).
 */
export type AICapability =
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "video-to-video"
  | "text-to-image"
  | "speech-to-text"
  | "text-to-speech"
  | "auto-edit"
  | "natural-language-command"
  | "style-transfer"
  | "object-removal"
  | "background-removal"
  | "upscale"
  | "slow-motion"
  | "sound-generation"
  | "audio-isolation"
  | "search-replace"
  | "outpaint"
  | "highlight-detection"
  | "b-roll-matching"
  | "viral-optimization"
  | "video-extend"
  | "video-inpaint"
  | "video-upscale"
  | "frame-interpolation"
  | "voice-clone"
  | "dubbing"
  | "music-generation"
  | "audio-restoration"
  | "color-grading"
  | "speed-ramping"
  | "auto-reframe"
  | "auto-shorts"
  | "object-tracking"
  | "audio-ducking"
  | "vision"
  | "image-editing";

/**
 * Lifecycle status of an asynchronous generation job.
 *
 * Transitions: `pending` -> `queued` -> `processing` -> `completed` | `failed` | `cancelled`.
 */
export type GenerationStatus =
  | "pending"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Multimodal reference input for video generation.
 *
 * Providers that support labeled reference prompting map these in order to
 * labels such as @Image1, @Video1, and @Audio1. `url` may be a publicly
 * reachable URL or a provider-supported data URI.
 */
export interface MediaReference {
  kind: "image" | "video" | "audio";
  url: string;
  label?: string;
  sourcePath?: string;
}

/**
 * Status of an asynchronous video job on the older Replicate prediction
 * endpoints (upscale, inpaint, style transfer). Contract video providers
 * report `VideoJobState` instead.
 *
 * Contains the generated video URL (when complete), progress information,
 * and optional metadata such as dimensions and duration.
 */
export interface VideoResult {
  /** Provider-assigned generation job ID */
  id: string;
  /** Current status of the generation job */
  status: GenerationStatus;
  /** URL to the generated video */
  videoUrl?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Duration in seconds */
  duration?: TimeSeconds;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Error message if failed */
  error?: string;
  /** Estimated time remaining */
  estimatedTimeRemaining?: TimeSeconds;
  /** Progress percentage 0-100 */
  progress?: number;
}

/**
 * A single time-aligned segment within a transcription result.
 *
 * Each segment represents a continuous stretch of speech with timestamps,
 * optional speaker identification, and a confidence score.
 */
export interface TranscriptSegment {
  /** Unique segment identifier */
  id: string;
  /** Start time in seconds */
  startTime: TimeSeconds;
  /** End time in seconds */
  endTime: TimeSeconds;
  /** Transcribed text */
  text: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Speaker label if available */
  speaker?: string;
  /** Language code */
  language?: string;
}

/**
 * A single word-level entry within a transcription result.
 *
 * Mirrors the Hyperframes `transcript.json` shape exactly so VibeFrame
 * scene HTML can drive GSAP timelines with the same word timings.
 */
export interface TranscriptWord {
  /** The word text (without surrounding whitespace) */
  text: string;
  /** Start time in seconds */
  start: TimeSeconds;
  /** End time in seconds */
  end: TimeSeconds;
}

/**
 * Granularity at which timestamps are returned by a transcription provider.
 *
 * - `"segment"` — sentence/utterance level (default, back-compat)
 * - `"word"` — word level only
 * - `"both"` — both segment and word level
 */
export type TranscriptGranularity = "segment" | "word" | "both";

/**
 * A transcription in the shape CLI commands consume (see the transcription
 * contract for the provider-facing `Transcript`).
 *
 * Contains the full transcript text, individual time-aligned segments,
 * optional word-level timings, and the detected language.
 */
export interface TranscriptResult {
  /** Provider-assigned transcription job ID */
  id: string;
  /** Current status of the transcription job */
  status: GenerationStatus;
  /** Full transcript text */
  fullText?: string;
  /** Individual segments */
  segments?: TranscriptSegment[];
  /** Word-level timings (populated when granularity is "word" or "both") */
  words?: TranscriptWord[];
  /** Detected language */
  detectedLanguage?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * An AI-suggested edit operation returned by `GeminiProvider.autoEdit`.
 *
 * Each suggestion targets one or more clips and includes a confidence score
 * indicating how strongly the AI recommends the edit.
 */
export interface EditSuggestion {
  /** Unique suggestion identifier */
  id: string;
  /** Type of edit operation */
  type: "trim" | "cut" | "add-effect" | "reorder" | "delete" | "split" | "merge";
  /** Description of the suggestion */
  description: string;
  /** Target clip IDs */
  clipIds: string[];
  /** Parameters for the edit */
  params: Record<string, unknown>;
  /** Confidence score 0-1 */
  confidence: number;
  /** Preview URL if available */
  previewUrl?: string;
}

/**
 * Criteria used to filter which types of highlights to extract from media.
 *
 * Use `"all"` to include every category.
 */
export type HighlightCriteria = "emotional" | "informative" | "funny" | "all";

/**
 * A single highlight segment identified within media content.
 *
 * Includes time boundaries, the transcript excerpt, a category label,
 * and an AI-generated confidence score and explanation.
 */
export interface Highlight {
  /** Index of this highlight */
  index: number;
  /** Start time in seconds */
  startTime: TimeSeconds;
  /** End time in seconds */
  endTime: TimeSeconds;
  /** Duration in seconds */
  duration: TimeSeconds;
  /** Reason why this is a highlight */
  reason: string;
  /** Transcript text for this segment */
  transcript: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Category of the highlight */
  category: "emotional" | "informative" | "funny";
}

/**
 * Aggregate result of a highlight extraction operation.
 *
 * Contains the source metadata, the criteria and threshold used,
 * and the ordered list of extracted {@link Highlight} segments.
 */
export interface HighlightsResult {
  /** Source file path */
  sourceFile: string;
  /** Total duration of the source in seconds */
  totalDuration: TimeSeconds;
  /** Criteria used for extraction */
  criteria: HighlightCriteria;
  /** Confidence threshold used */
  threshold: number;
  /** Number of highlights extracted */
  highlightsCount: number;
  /** Total duration of all highlights */
  totalHighlightDuration: TimeSeconds;
  /** List of highlights */
  highlights: Highlight[];
}

/**
 * Metadata for a B-roll clip, including an AI-generated description and tags.
 *
 * Used by the B-roll matching pipeline to semantically pair clips with
 * narration segments.
 */
export interface BrollClipInfo {
  /** Unique identifier */
  id: string;
  /** File path */
  filePath: string;
  /** Duration in seconds */
  duration: TimeSeconds;
  /** AI-generated description of the visual content */
  description: string;
  /** Tags for semantic matching */
  tags: string[];
  /** Base64-encoded thumbnail (optional) */
  thumbnailBase64?: string;
}

/**
 * A narration segment enriched with AI-suggested visual descriptions and tags.
 *
 * Generated by analyzing the narration transcript to recommend B-roll footage
 * that complements the spoken content.
 */
export interface NarrationSegment {
  /** Segment index */
  index: number;
  /** Start time in seconds */
  startTime: TimeSeconds;
  /** End time in seconds */
  endTime: TimeSeconds;
  /** Transcribed or input text */
  text: string;
  /** AI-suggested visual description for this segment */
  visualDescription: string;
  /** Suggested tags for B-roll matching */
  suggestedBrollTags: string[];
}

/**
 * A semantic match pairing a {@link NarrationSegment} with a {@link BrollClipInfo}.
 *
 * Includes a confidence score and suggested timing for placing the B-roll
 * on the timeline.
 */
export interface BrollMatch {
  /** Index of the narration segment */
  narrationSegmentIndex: number;
  /** ID of the matched B-roll clip */
  brollClipId: string;
  /** Match confidence score (0-1) */
  confidence: number;
  /** Reason for the match */
  reason: string;
  /** Suggested start offset within the B-roll clip */
  suggestedStartOffset: TimeSeconds;
  /** Suggested duration from the B-roll clip */
  suggestedDuration: TimeSeconds;
}

/**
 * Complete result of the B-roll matching pipeline.
 *
 * Contains analyzed clips, parsed narration segments, their matches,
 * and indices of any unmatched segments that may need manual assignment.
 */
export interface BrollMatchResult {
  /** Source narration file path */
  narrationFile: string;
  /** Total narration duration */
  totalDuration: TimeSeconds;
  /** Analyzed B-roll clips */
  brollClips: BrollClipInfo[];
  /** Parsed narration segments */
  narrationSegments: NarrationSegment[];
  /** Matches between segments and B-roll */
  matches: BrollMatch[];
  /** Indices of narration segments without matches */
  unmatchedSegments: number[];
}

/**
 * Platform-specific constraints for viral content optimization.
 *
 * Defines aspect ratio, duration limits, and feature support for a given
 * social media platform (e.g., TikTok, YouTube Shorts, Instagram Reels).
 */
export interface PlatformSpec {
  /** Platform identifier */
  id: string;
  /** Display name */
  name: string;
  /** Required aspect ratio */
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
  /** Maximum duration in seconds */
  maxDuration: number;
  /** Ideal duration range */
  idealDuration: { min: number; max: number };
  /** Platform-specific features */
  features: { captions: boolean; hook: boolean };
}

/**
 * An emotional peak detected during content analysis.
 *
 * Represents a specific moment where emotional intensity spikes,
 * useful for hook selection and viral optimization.
 */
export interface EmotionalPeak {
  /** Timestamp in seconds */
  time: TimeSeconds;
  /** Type of emotion */
  emotion: string;
  /** Intensity score 0-1 */
  intensity: number;
}

/**
 * A time range suggested for removal or rearrangement during viral optimization.
 */
export interface SuggestedCut {
  /** Start time in seconds */
  startTime: TimeSeconds;
  /** End time in seconds */
  endTime: TimeSeconds;
  /** Reason for this cut */
  reason: string;
}

/**
 * Suitability assessment of content for a specific platform.
 */
export interface PlatformSuitability {
  /** Suitability score 0-1 */
  suitability: number;
  /** Improvement suggestions */
  suggestions: string[];
}

/**
 * Comprehensive viral potential analysis for a piece of content.
 *
 * Scores hook strength, pacing, emotional peaks, and platform-specific
 * suitability to guide content optimization.
 */
export interface ViralAnalysis {
  /** Overall viral potential score 0-100 */
  overallScore: number;
  /** Hook strength score 0-100 (first few seconds effectiveness) */
  hookStrength: number;
  /** Content pacing assessment */
  pacing: "slow" | "moderate" | "fast";
  /** Detected emotional peaks */
  emotionalPeaks: EmotionalPeak[];
  /** Suggested cuts for optimization */
  suggestedCuts: SuggestedCut[];
  /** Platform-specific suitability scores */
  platforms: Record<string, PlatformSuitability>;
  /** Hook optimization recommendation */
  hookRecommendation: {
    /** Suggested new start time for better hook */
    suggestedStartTime: TimeSeconds;
    /** Reason for recommendation */
    reason: string;
  };
}

/**
 * A single segment selected from the source timeline for a platform-specific cut.
 */
export interface PlatformCutSegment {
  /** Source clip ID */
  sourceClipId: string;
  /** Start time in seconds */
  startTime: TimeSeconds;
  /** End time in seconds */
  endTime: TimeSeconds;
  /** Priority score 0-1 */
  priority: number;
}

/**
 * A complete video cut optimized for a specific platform.
 *
 * Composed of one or more {@link PlatformCutSegment} entries arranged
 * to fit the platform's duration and aspect ratio constraints.
 */
export interface PlatformCut {
  /** Target platform */
  platform: string;
  /** Selected segments for this platform */
  segments: PlatformCutSegment[];
  /** Total duration of the cut */
  totalDuration: TimeSeconds;
}

/**
 * Complete result of the viral optimization pipeline.
 *
 * Includes the analysis, generated per-platform cuts, and paths to the
 * resulting platform-specific project files.
 */
export interface ViralOptimizationResult {
  /** Source project file path */
  sourceProject: string;
  /** Analysis results */
  analysis: ViralAnalysis;
  /** Generated platform cuts */
  platformCuts: PlatformCut[];
  /** Generated platform project files */
  platformProjects: Array<{
    platform: string;
    projectPath: string;
    duration: TimeSeconds;
    aspectRatio: string;
  }>;
}

/**
 * Configuration passed to {@link AIProvider.initialize} to set up a provider instance.
 */
export interface ProviderConfig {
  /** API key for authentication with the provider */
  apiKey?: string;
  /** Custom base URL (overrides the provider's default endpoint) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Maximum number of retry attempts on transient failures */
  maxRetries?: number;
  /** Additional HTTP headers sent with every request */
  customHeaders?: Record<string, string>;
  /** Override the default model for this provider instance */
  model?: string;
}

/**
 * Main AI Provider interface that all VibeFrame providers must implement.
 *
 * Generation itself goes through the typed contracts (`VideoGenerator`,
 * `ImageGenerator`, `SpeechGenerator`, `Transcriber`, `TextGenerator`).
 */
export interface AIProvider {
  /** Unique identifier for this provider */
  id: string;
  /** Display name */
  name: string;
  /** Provider description */
  description: string;
  /** Available capabilities */
  capabilities: AICapability[];
  /** Provider icon URL */
  iconUrl?: string;
  /** Whether the provider is currently available */
  isAvailable: boolean;

  /**
   * Initialize the provider with configuration.
   * @param config - Provider configuration (API key, base URL, etc.)
   * @returns Resolves when the provider is ready for use.
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Check if the provider is properly configured (e.g., API key is set).
   * @returns `true` if the provider can accept requests.
   */
  isConfigured(): boolean;
}
