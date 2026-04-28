/**
 * Configuration schema for VibeFrame CLI
 * Stored at ~/.vibeframe/config.yaml
 */

export type LLMProvider = "claude" | "openai" | "gemini" | "ollama" | "xai" | "openrouter";

export interface VibeConfig {
  /** Config file version */
  version: string;

  /** LLM provider settings */
  llm: {
    /** Primary LLM provider for AI commands */
    provider: LLMProvider;
  };

  /** API keys for various providers */
  providers: {
    anthropic?: string;
    openai?: string;
    google?: string;
    elevenlabs?: string;
    runway?: string;
    kling?: string;
    fal?: string;
    imgbb?: string;
    replicate?: string;
    xai?: string;
    openrouter?: string;
  };

  /** Default settings for new projects */
  defaults: {
    aspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
    exportQuality: "draft" | "standard" | "high" | "ultra";
    /** Default provider for image generation */
    imageProvider?: "gemini" | "openai" | "grok";
    /** Default provider for video generation */
    videoProvider?: "fal" | "grok" | "kling" | "runway" | "veo";
    /** Default provider for storyboard analysis */
    storyboardProvider?: "claude" | "openai" | "gemini";
    /** Default voice for TTS */
    voice?: string;
  };

  /** REPL settings */
  repl: {
    /** Auto-save project after each command */
    autoSave: boolean;
  };
}

/** Provider display names */
export const PROVIDER_NAMES: Record<LLMProvider, string> = {
  claude: "Claude (Anthropic)",
  openai: "GPT-4 (OpenAI)",
  gemini: "Gemini (Google)",
  ollama: "Ollama (Local)",
  xai: "Grok (xAI)",
  openrouter: "OpenRouter",
};

/**
 * Environment variable mappings, derived from the provider registry.
 * Pre-v0.68 this was a hardcoded record cross-validated against four
 * other files via `scripts/sync-counts.sh`. Now it auto-derives from
 * `@vibeframe/ai-providers` `defineApiKey` declarations — adding a new
 * apiKey is a single line in `api-keys.ts`.
 */
import { getProviderEnvVars } from "@vibeframe/ai-providers";

export const PROVIDER_ENV_VARS: Record<string, string> = getProviderEnvVars();

/** Default configuration */
export function createDefaultConfig(): VibeConfig {
  return {
    version: "1.0.0",
    llm: {
      provider: "claude",
    },
    providers: {},
    defaults: {
      aspectRatio: "16:9",
      exportQuality: "standard",
    },
    repl: {
      autoSave: true,
    },
  };
}
