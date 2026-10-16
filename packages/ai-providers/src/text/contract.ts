/**
 * The text-generation contract: one bounded model call, no tools, no loop.
 *
 * VibeFrame keeps the agent loop in the host (Claude Code, Codex, Cursor).
 * What stays inside are single calls with a known shape, such as revising a
 * storyboard, so this contract is a system prompt, a short conversation,
 * and optionally a JSON Schema the reply must match. A request goes in and
 * text comes back, or a `ProviderError` is thrown: a refusal is
 * `moderation`, and a reply cut off by the output cap is `invalid-request`.
 */

export interface TextMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TextRequest {
  system?: string;
  messages: TextMessage[];
  /** Catalog model ID or alias; the provider's default when omitted. */
  model?: string;
  /**
   * JSON Schema the reply must match. The provider's structured output
   * enforces it, so `text` is that JSON. Use object schemas with every
   * property listed in `required` and `additionalProperties: false`, the
   * subset all three providers accept.
   */
  jsonSchema?: Record<string, unknown>;
  /** Output cap, thinking included where the provider counts it. Default 32,000. */
  maxOutputTokens?: number;
}

export interface TextResult {
  text: string;
  /** The catalog model that answered. */
  model: string;
}

export interface TextGenerator {
  /** Catalog provider id ("claude", "openai", "gemini"). */
  readonly textProvider: string;
  /** Throws `ProviderError`. */
  generateText(request: TextRequest): Promise<TextResult>;
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;
