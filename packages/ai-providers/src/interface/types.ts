import type { Clip, TimeSeconds } from "@vibe-edit/core";

/**
 * AI Provider capabilities
 */
export type AICapability =
  | "text-to-video"
  | "image-to-video"
  | "video-to-video"
  | "speech-to-text"
  | "text-to-speech"
  | "auto-edit"
  | "style-transfer"
  | "object-removal"
  | "background-removal"
  | "upscale"
  | "slow-motion";

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
