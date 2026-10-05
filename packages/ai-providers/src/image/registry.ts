/** One way to get an image provider by its catalog id. */

import { GeminiProvider } from "../gemini/GeminiProvider.js";
import { GrokProvider } from "../grok/GrokProvider.js";
import { OpenAIImageProvider } from "../openai-image/OpenAIImageProvider.js";
import { ProviderError } from "../shared/errors.js";
import type { ImageGenerator } from "./contract.js";

export const IMAGE_GENERATOR_PROVIDERS = ["openai", "gemini", "grok"] as const;
export type ImageGeneratorProvider = (typeof IMAGE_GENERATOR_PROVIDERS)[number];

/** A ready image generator for `provider`. */
export async function createImageGenerator(provider: string, apiKey: string): Promise<ImageGenerator> {
  const generator =
    provider === "openai"
      ? new OpenAIImageProvider()
      : provider === "gemini"
        ? new GeminiProvider()
        : provider === "grok"
          ? new GrokProvider()
          : undefined;
  if (!generator) {
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown image provider "${provider}". Available: ${IMAGE_GENERATOR_PROVIDERS.join(", ")}.`,
    });
  }
  await generator.initialize({ apiKey });
  return generator;
}
