/**
 * AI Providers - Pluggable AI provider system for VibeFrame
 *
 * IMPORTANT: See docs/models.md for the Single Source of Truth (SSOT) on:
 * - Supported AI providers and models
 * - Environment variables and API keys
 * - Model capabilities and limitations
 *
 * When adding new providers, update docs/models.md FIRST.
 */

// Interface and registry
export * from "./interface/index.js";
export { providerRegistry, getBestProviderForCapability } from "./interface/registry.js";

// Individual providers
export { WhisperProvider, whisperProvider } from "./whisper/index.js";
export { GeminiProvider, geminiProvider } from "./gemini/index.js";
export { OpenAIProvider, openaiProvider } from "./openai/index.js";
export { ClaudeProvider, claudeProvider } from "./claude/index.js";
export type { MotionOptions, MotionResult, RemotionComponent, StoryboardSegment } from "./claude/index.js";
export { OllamaProvider, ollamaProvider } from "./ollama/index.js";
export { ElevenLabsProvider, elevenLabsProvider, KNOWN_VOICES, resolveVoiceId } from "./elevenlabs/index.js";
export type { Voice, TTSOptions, TTSResult, SoundEffectOptions, SoundEffectResult, AudioIsolationResult, VoiceCloneOptions, VoiceCloneResult } from "./elevenlabs/index.js";
export { DalleProvider, dalleProvider } from "./dalle/index.js";
export type { ImageOptions, ImageResult, ImageEditOptions } from "./dalle/index.js";
export { RunwayProvider, runwayProvider } from "./runway/index.js";
export { KlingProvider, klingProvider } from "./kling/index.js";
export type { KlingVideoExtendOptions } from "./kling/index.js";
export { GrokProvider, grokProvider } from "./grok/index.js";
export type { GrokModel, GrokVideoOptions } from "./grok/index.js";
export { StabilityProvider, stabilityProvider } from "./stability/index.js";
export { ReplicateProvider, replicateProvider } from "./replicate/index.js";
export type { ReplicateUpscaleOptions, ReplicateUpscaleResult, ReplicateInpaintOptions, MusicGenerationOptions, MusicGenerationResult, AudioRestorationOptions, AudioRestorationResult } from "./replicate/index.js";
export type { StabilityImageOptions, StabilityImageResult, StabilityImg2ImgOptions, StabilityUpscaleOptions, StabilitySearchReplaceOptions, StabilityOutpaintOptions } from "./stability/index.js";

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
} from "./interface/index.js";
