/**
 * Video providers a project build (`vibe plan`, `vibe build`, storyboard
 * `provider:` cues, project config) can target. One list, so adding a
 * provider is a one-line change instead of a hunt through every command.
 */

export const BUILD_VIDEO_PROVIDERS = ["seedance", "grok", "kling", "runway", "omni", "veo"] as const;

export type BuildVideoProvider = (typeof BUILD_VIDEO_PROVIDERS)[number];

export function isBuildVideoProvider(value: string): value is BuildVideoProvider {
  return (BUILD_VIDEO_PROVIDERS as readonly string[]).includes(value);
}

/** Normalize user input; `fal` is the deprecated alias for seedance. Unknown values fall back to seedance. */
export function resolveBuildVideoProvider(value: unknown): BuildVideoProvider {
  const provider = String(value ?? "seedance").toLowerCase();
  if (provider === "fal") return "seedance";
  return isBuildVideoProvider(provider) ? provider : "seedance";
}

/** Config/API-key id that unlocks a video provider. */
export function videoProviderConfigKey(provider: string): string {
  switch (provider) {
    case "seedance":
    case "fal":
      return "fal";
    case "grok":
      return "xai";
    case "veo":
    case "omni":
      return "google";
    default:
      return provider;
  }
}
