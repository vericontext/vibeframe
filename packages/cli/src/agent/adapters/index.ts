/**
 * LLM Adapter Interface and Factory
 */

import type { ToolDefinition, LLMResponse, AgentMessage, LLMProvider } from "../types.js";

/**
 * Abstract interface for LLM providers
 */
export interface LLMAdapter {
  /** Provider name */
  readonly provider: LLMProvider;

  /** Initialize the adapter with API key */
  initialize(apiKey: string): Promise<void>;

  /** Check if adapter is initialized */
  isInitialized(): boolean;

  /** Send messages with tools and get response */
  chat(
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse>;
}

/**
 * Factory for creating LLM adapters
 */
export async function createAdapter(provider: LLMProvider): Promise<LLMAdapter> {
  switch (provider) {
    case "openai": {
      const { OpenAIAdapter } = await import("./openai.js");
      return new OpenAIAdapter();
    }
    case "claude": {
      const { ClaudeAdapter } = await import("./claude.js");
      return new ClaudeAdapter();
    }
    case "gemini": {
      const { GeminiAdapter } = await import("./gemini.js");
      return new GeminiAdapter();
    }
    case "ollama": {
      const { OllamaAdapter } = await import("./ollama.js");
      return new OllamaAdapter();
    }
    case "xai": {
      const { XAIAdapter } = await import("./xai.js");
      return new XAIAdapter();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export { OpenAIAdapter } from "./openai.js";
export { ClaudeAdapter } from "./claude.js";
export { GeminiAdapter } from "./gemini.js";
export { OllamaAdapter } from "./ollama.js";
export { XAIAdapter } from "./xai.js";
