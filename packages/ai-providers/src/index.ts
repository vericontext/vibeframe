// Interface and registry
export * from "./interface";
export { providerRegistry, getBestProviderForCapability } from "./interface/registry";

// Individual providers
export { WhisperProvider, whisperProvider } from "./whisper";
export { GeminiProvider, geminiProvider } from "./gemini";
export { OpenAIProvider, openaiProvider } from "./openai";
export { ClaudeProvider, claudeProvider } from "./claude";
export type { MotionOptions, MotionResult, RemotionComponent, StoryboardSegment } from "./claude";
export { ElevenLabsProvider, elevenLabsProvider } from "./elevenlabs";
export type { Voice, TTSOptions, TTSResult, SoundEffectOptions, SoundEffectResult, AudioIsolationResult } from "./elevenlabs";
export { DalleProvider, dalleProvider } from "./dalle";
export type { ImageOptions, ImageResult, ImageEditOptions } from "./dalle";
export { RunwayProvider, runwayProvider } from "./runway";
export { KlingProvider, klingProvider } from "./kling";
export { StabilityProvider, stabilityProvider } from "./stability";
export type { StabilityImageOptions, StabilityImageResult, StabilityImg2ImgOptions, StabilityUpscaleOptions, StabilitySearchReplaceOptions, StabilityOutpaintOptions } from "./stability";

// Re-export commonly used types
export type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
  TranscriptResult,
  TranscriptSegment,
  EditSuggestion,
  TimelineCommand,
  CommandParseResult,
  Highlight,
  HighlightCriteria,
  HighlightsResult,
  BrollClipInfo,
  NarrationSegment,
  BrollMatch,
  BrollMatchResult,
  PlatformSpec,
  ViralAnalysis,
  PlatformCut,
  PlatformCutSegment,
  ViralOptimizationResult,
  EmotionalPeak,
  SuggestedCut,
  PlatformSuitability,
} from "./interface";
