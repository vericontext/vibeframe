/**
 * @module types
 * @description Shared types for the AI provider system.
 *
 * Defines capability enums, generation options and results, transcription types,
 * edit suggestions, natural language command parsing, highlight detection,
 * B-roll matching, viral optimization, and the core {@link AIProvider} and
 * {@link AIProviderRegistry} interfaces.
 */

import type { Clip, TimeSeconds } from "@vibeframe/core";

/** Re-export TimeSeconds for use by consumers. */
export type { TimeSeconds } from "@vibeframe/core";

/**
 * Capabilities that an AI provider can declare support for.
 *
 * Used by the {@link AIProviderRegistry} to find providers that match
 * a requested operation (e.g., `"text-to-video"`, `"vision"`).
 */
export type AICapability =
  | "text-to-video"
  | "image-to-video"
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
  | "vision";

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
 * Common options passed to {@link AIProvider.generateVideo}.
 *
 * All fields except `prompt` are optional; providers ignore unsupported options.
 */
export interface GenerateOptions {
  /** Prompt for generation */
  prompt: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Duration in seconds */
  duration?: TimeSeconds;
  /** Aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5";
  /** Seed for reproducibility */
  seed?: number;
  /** Style preset */
  style?: string;
  /** Generation mode (Kling: std or pro) */
  mode?: "std" | "pro";
  /** Model name/version (provider-specific) */
  model?: string;
  /** CFG scale (0-1, controls prompt adherence) */
  cfg?: number;
  /** Reference image for image-to-video */
  referenceImage?: Blob | string;
  /** Reference video for video-to-video */
  referenceVideo?: Blob | string;
  /** Model-specific options */
  modelOptions?: Record<string, unknown>;
}

/**
 * Result returned by {@link AIProvider.generateVideo} or {@link AIProvider.getGenerationStatus}.
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
  /** Video ID for extensions (Kling) */
  videoId?: string;
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
 * Result returned by {@link AIProvider.transcribe}.
 *
 * Contains the full transcript text, individual time-aligned segments,
 * and the detected language.
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
  /** Detected language */
  detectedLanguage?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * An AI-suggested edit operation returned by {@link AIProvider.autoEdit}.
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
 * A single timeline operation parsed from a natural language instruction.
 *
 * Returned within {@link CommandParseResult.commands} by
 * {@link AIProvider.parseCommand}.
 */
export interface TimelineCommand {
  /** Command type */
  action:
    | "add-clip"
    | "remove-clip"
    | "trim"
    | "split"
    | "move"
    | "duplicate"
    | "add-effect"
    | "remove-effect"
    | "set-volume"
    | "add-transition"
    | "add-track"
    | "export"
    | "speed-change"
    | "reverse"
    | "crop"
    | "position";
  /** Target clip IDs (empty for global commands) */
  clipIds: string[];
  /** Command parameters */
  params: Record<string, unknown>;
  /** Human-readable description of what this command does */
  description: string;
}

/**
 * Result of parsing a natural language command via {@link AIProvider.parseCommand}.
 *
 * On success, contains one or more {@link TimelineCommand} objects to execute.
 * On failure or ambiguity, provides an error or clarification question.
 */
export interface CommandParseResult {
  /** Whether parsing was successful */
  success: boolean;
  /** Parsed commands to execute */
  commands: TimelineCommand[];
  /** Error message if parsing failed */
  error?: string;
  /** Clarification question if command is ambiguous */
  clarification?: string;
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
 * A provider declares its {@link capabilities} and implements the corresponding
 * optional methods (e.g., `generateVideo` for `"text-to-video"`).
 * Providers are registered in the {@link AIProviderRegistry} and looked up
 * by capability at runtime.
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

  /**
   * Generate a video from a text prompt (capability: `"text-to-video"`).
   * @param prompt - Descriptive text prompt for the video.
   * @param options - Additional generation options (duration, aspect ratio, seed, etc.).
   * @returns The generation result with status and video URL when complete.
   */
  generateVideo?(prompt: string, options?: GenerateOptions): Promise<VideoResult>;

  /**
   * Poll the status of an ongoing generation job.
   * @param id - The generation job ID returned by {@link generateVideo}.
   * @returns Current status, progress, and video URL when complete.
   */
  getGenerationStatus?(id: string): Promise<VideoResult>;

  /**
   * Cancel an ongoing generation job.
   * @param id - The generation job ID to cancel.
   * @returns `true` if the cancellation succeeded.
   */
  cancelGeneration?(id: string): Promise<boolean>;

  /**
   * Transcribe audio to text (capability: `"speech-to-text"`).
   * @param audio - Audio data as a Blob.
   * @param language - Optional BCP-47 language code hint (e.g., `"en"`, `"ko"`).
   * @returns Transcription result with full text and time-aligned segments.
   */
  transcribe?(audio: Blob, language?: string): Promise<TranscriptResult>;

  /**
   * Get AI-generated edit suggestions based on clips and a natural language instruction
   * (capability: `"auto-edit"`).
   * @param clips - The clips to analyze.
   * @param instruction - Natural language editing instruction (e.g., "make it shorter").
   * @returns Array of suggested edit operations ranked by confidence.
   */
  autoEdit?(clips: Clip[], instruction: string): Promise<EditSuggestion[]>;

  /**
   * Apply a visual style transfer to a video (capability: `"style-transfer"`).
   * @param video - Source video data as a Blob.
   * @param style - Style preset name or description.
   * @returns The styled video result.
   */
  applyStyle?(video: Blob, style: string): Promise<VideoResult>;

  /**
   * Upscale video to a higher resolution (capability: `"upscale"`).
   * @param video - Source video data as a Blob.
   * @param targetResolution - Target resolution string (e.g., `"4k"`, `"1080p"`).
   * @returns The upscaled video result.
   */
  upscale?(video: Blob, targetResolution: string): Promise<VideoResult>;

  /**
   * Parse a natural language command into executable timeline operations
   * (capability: `"natural-language-command"`).
   * @param instruction - Free-form text instruction (e.g., "trim the first clip to 10 seconds").
   * @param context - Current timeline context including available clips and track IDs.
   * @returns Parsed commands or a clarification question if the instruction is ambiguous.
   */
  parseCommand?(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult>;
}

/**
 * Registry for managing multiple {@link AIProvider} instances.
 *
 * Allows registration, lookup by ID, and capability-based discovery
 * of providers at runtime.
 */
export interface AIProviderRegistry {
  /**
   * Register a new provider (overwrites if the same ID already exists).
   * @param provider - The provider instance to register.
   */
  register(provider: AIProvider): void;

  /**
   * Get a provider by its unique identifier.
   * @param id - Provider ID (e.g., `"openai"`, `"runway"`).
   * @returns The matching provider, or `undefined` if not found.
   */
  get(id: string): AIProvider | undefined;

  /**
   * Get all registered providers.
   * @returns Array of all provider instances.
   */
  getAll(): AIProvider[];

  /**
   * Get providers that declare a specific capability.
   * @param capability - The capability to filter by.
   * @returns Array of providers that support the given capability.
   */
  getByCapability(capability: AICapability): AIProvider[];

  /**
   * Remove a provider from the registry.
   * @param id - Provider ID to remove.
   * @returns `true` if the provider was found and removed.
   */
  unregister(id: string): boolean;
}
