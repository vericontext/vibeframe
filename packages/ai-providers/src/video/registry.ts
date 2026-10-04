/**
 * One way to get a video provider by its registry id, so callers never
 * name a provider class or branch on provider names.
 */

import { FalProvider } from "../fal/FalProvider.js";
import { OmniProvider } from "../gemini/gemini-omni.js";
import { VeoGenerator } from "../gemini/veo-generator.js";
import { GrokProvider } from "../grok/GrokProvider.js";
import { KlingProvider } from "../kling/KlingProvider.js";
import { RunwayProvider } from "../runway/RunwayProvider.js";
import { ProviderError } from "../shared/errors.js";
import type { VideoGenerator } from "./contract.js";

export const VIDEO_GENERATOR_PROVIDERS = ["seedance", "grok", "kling", "runway", "omni", "veo"] as const;
export type VideoGeneratorProvider = (typeof VIDEO_GENERATOR_PROVIDERS)[number];

/** A ready video generator for `provider` (`fal` is the old name for `seedance`). */
export async function createVideoGenerator(provider: string, apiKey: string): Promise<VideoGenerator> {
  const id = provider === "fal" ? "seedance" : provider;
  const generator =
    id === "seedance"
      ? new FalProvider()
      : id === "grok"
        ? new GrokProvider()
        : id === "kling"
          ? new KlingProvider()
          : id === "runway"
            ? new RunwayProvider()
            : id === "omni"
              ? new OmniProvider()
              : id === "veo"
                ? new VeoGenerator()
                : undefined;
  if (!generator) {
    throw new ProviderError({
      kind: "invalid-request",
      provider: id,
      message: `Unknown video provider "${provider}". Available: ${VIDEO_GENERATOR_PROVIDERS.join(", ")}.`,
    });
  }
  await generator.initialize({ apiKey });
  return generator;
}
