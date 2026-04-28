/**
 * AI Providers - Pluggable AI provider system for VibeFrame
 *
 * IMPORTANT: See MODELS.md for the Single Source of Truth (SSOT) on:
 * - Supported AI providers and models
 * - Environment variables and API keys
 * - Model capabilities and limitations
 *
 * When adding new providers, update MODELS.md FIRST.
 */

// Interface and registry
export * from "./interface/index.js";
export { providerRegistry, getBestProviderForCapability } from "./interface/registry.js";

// Plugin metadata registry — must be imported before any provider's index.ts
// since `defineProvider` calls assert their referenced apiKey was registered.
// `api-keys.ts` declares all 11 apiKeys + 1 virtual provider (openrouter).
import "./api-keys.js";
export {
  defineApiKey,
  defineProvider,
  getProvidersFor,
  getProviderEnvVars,
  getCommandKeyMap,
  getSetupProviders,
  getAllApiKeys,
  getAllProviders,
  type ApiKeyMeta,
  type ProviderMeta,
  type ProviderKind,
  type ProviderCandidate,
  type SetupProviderEntry,
} from "./define-provider.js";

// Individual providers
export { WhisperProvider, whisperProvider } from "./whisper/index.js";
export { GeminiProvider, geminiProvider } from "./gemini/index.js";
export { OpenAIProvider, openaiProvider } from "./openai/index.js";
export { ClaudeProvider, claudeProvider } from "./claude/index.js";
export type { MotionOptions, MotionResult, RemotionComponent, StoryboardSegment } from "./claude/index.js";
export { OllamaProvider, ollamaProvider } from "./ollama/index.js";
export { ElevenLabsProvider, elevenLabsProvider, KNOWN_VOICES, resolveVoiceId } from "./elevenlabs/index.js";
export type { Voice, TTSOptions, TTSResult, MusicOptions, MusicResult, SoundEffectOptions, SoundEffectResult, AudioIsolationResult, VoiceCloneOptions, VoiceCloneResult } from "./elevenlabs/index.js";
export { KokoroProvider, kokoroProvider, KOKORO_DEFAULT_VOICE, KOKORO_MODEL_ID } from "./kokoro/index.js";
export type { KokoroTTSOptions, KokoroTTSResult, KokoroLoadEvent } from "./kokoro/index.js";
export { OpenAIImageProvider, openaiImageProvider } from "./openai-image/index.js";
export type { ImageOptions, ImageResult, ImageEditOptions } from "./openai-image/index.js";
export { RunwayProvider, runwayProvider } from "./runway/index.js";
export { KlingProvider, klingProvider } from "./kling/index.js";
export type { KlingVideoExtendOptions } from "./kling/index.js";
export { GrokProvider, grokProvider } from "./grok/index.js";
export type { GrokModel, GrokVideoOptions, GrokImageOptions, GrokEditOptions } from "./grok/index.js";
export { FalProvider, falProvider } from "./fal/index.js";
export type { SeedanceVariant } from "./fal/index.js";
export { ReplicateProvider, replicateProvider } from "./replicate/index.js";
export type { ReplicateUpscaleOptions, ReplicateUpscaleResult, ReplicateInpaintOptions, MusicGenerationOptions, MusicGenerationResult, AudioRestorationOptions, AudioRestorationResult } from "./replicate/index.js";
// Re-export commonly used types
export type {
  AIProvider,
  AICapability,
  ProviderConfig,
  GenerateOptions,
  VideoResult,
  TranscribeOptions,
  TranscriptGranularity,
  TranscriptResult,
  TranscriptSegment,
  TranscriptWord,
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
