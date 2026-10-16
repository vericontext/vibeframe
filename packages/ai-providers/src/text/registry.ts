/** One way to get a text-generation provider by its catalog id. */

import { ClaudeProvider } from "../claude/ClaudeProvider.js";
import { GeminiProvider } from "../gemini/GeminiProvider.js";
import { OpenAIProvider } from "../openai/OpenAIProvider.js";
import { ProviderError } from "../shared/errors.js";
import type { TextGenerator } from "./contract.js";

export const TEXT_GENERATOR_PROVIDERS = ["claude", "openai", "gemini"] as const;

/** A ready text generator for `provider`. */
export async function createTextGenerator(provider: string, apiKey: string): Promise<TextGenerator> {
  const generator =
    provider === "claude"
      ? new ClaudeProvider()
      : provider === "openai"
        ? new OpenAIProvider()
        : provider === "gemini"
          ? new GeminiProvider()
          : undefined;
  if (!generator) {
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown text provider "${provider}". Available: ${TEXT_GENERATOR_PROVIDERS.join(", ")}.`,
    });
  }
  await generator.initialize({ apiKey });
  return generator;
}
