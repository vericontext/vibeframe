/**
 * Configuration schema for VibeEdit CLI
 * Stored at ~/.vibe-edit/config.yaml
 */

export type LLMProvider = "claude" | "openai" | "gemini" | "ollama";

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
    stability?: string;
    replicate?: string;
  };

  /** Default settings for new projects */
  defaults: {
    aspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
    exportQuality: "draft" | "standard" | "high" | "ultra";
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
};

/** Environment variable mappings */
export const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  runway: "RUNWAY_API_KEY",
  kling: "KLING_API_KEY",
  stability: "STABILITY_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
};

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
