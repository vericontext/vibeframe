import type { Clip, TimeSeconds } from "@vibeframe/core";

// Re-export TimeSeconds for use by consumers
export type { TimeSeconds } from "@vibeframe/core";

/**
 * AI Provider capabilities
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
  | "audio-ducking";

/**
 * Generation status
 */
export type GenerationStatus =
  | "pending"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Common options for video generation
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
  /** Reference image for image-to-video */
  referenceImage?: Blob | string;
  /** Reference video for video-to-video */
  referenceVideo?: Blob | string;
  /** Model-specific options */
  modelOptions?: Record<string, unknown>;
}

/**
 * Result of video generation
 */
export interface VideoResult {
  id: string;
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
 * Transcript segment
 */
export interface TranscriptSegment {
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
 * Result of speech-to-text transcription
 */
export interface TranscriptResult {
  id: string;
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
 * Suggested edit operation
 */
export interface EditSuggestion {
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
 * Timeline command parsed from natural language
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
 * Result of parsing natural language command
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
 * Highlight detection criteria
 */
export type HighlightCriteria = "emotional" | "informative" | "funny" | "all";

/**
 * Highlight segment identified from content
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
 * Result of highlight extraction
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
 * B-roll clip information with visual analysis
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
 * Narration segment with visual suggestions
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
 * Match between a narration segment and a B-roll clip
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
 * Result of B-roll matching pipeline
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
 * Platform specification for viral optimization
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
 * Emotional peak detected in content
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
 * Suggested cut for viral content
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
 * Platform-specific suitability score
 */
export interface PlatformSuitability {
  /** Suitability score 0-1 */
  suitability: number;
  /** Improvement suggestions */
  suggestions: string[];
}

/**
 * Result of viral potential analysis
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
 * Segment for platform-specific cut
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
 * Platform-specific video cut
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
 * Result of viral optimization pipeline
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
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  customHeaders?: Record<string, string>;
}

/**
 * Main AI Provider interface
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
   * Initialize the provider with configuration
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Check if provider is properly configured
   */
  isConfigured(): boolean;

  /**
   * Generate video from prompt
   */
  generateVideo?(prompt: string, options?: GenerateOptions): Promise<VideoResult>;

  /**
   * Get status of ongoing generation
   */
  getGenerationStatus?(id: string): Promise<VideoResult>;

  /**
   * Cancel ongoing generation
   */
  cancelGeneration?(id: string): Promise<boolean>;

  /**
   * Transcribe audio to text
   */
  transcribe?(audio: Blob, language?: string): Promise<TranscriptResult>;

  /**
   * Get auto-edit suggestions based on clips and instruction
   */
  autoEdit?(clips: Clip[], instruction: string): Promise<EditSuggestion[]>;

  /**
   * Apply style transfer to video
   */
  applyStyle?(video: Blob, style: string): Promise<VideoResult>;

  /**
   * Upscale video resolution
   */
  upscale?(video: Blob, targetResolution: string): Promise<VideoResult>;

  /**
   * Parse natural language command into timeline operations
   */
  parseCommand?(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult>;
}

/**
 * Provider registry for managing multiple AI providers
 */
export interface AIProviderRegistry {
  /**
   * Register a new provider
   */
  register(provider: AIProvider): void;

  /**
   * Get provider by ID
   */
  get(id: string): AIProvider | undefined;

  /**
   * Get all registered providers
   */
  getAll(): AIProvider[];

  /**
   * Get providers with specific capability
   */
  getByCapability(capability: AICapability): AIProvider[];

  /**
   * Unregister a provider
   */
  unregister(id: string): boolean;
}
