/**
 * Video providers a project build (`vibe plan`, `vibe build`, storyboard
 * `provider:` cues, project config) can target. One list, so adding a
 * provider is a one-line change instead of a hunt through every command.
 */

export const BUILD_VIDEO_PROVIDERS = ["seedance", "grok", "kling", "runway", "omni"] as const;

export type BuildVideoProvider = (typeof BUILD_VIDEO_PROVIDERS)[number];

export function isBuildVideoProvider(value: string): value is BuildVideoProvider {
  return (BUILD_VIDEO_PROVIDERS as readonly string[]).includes(value);
}

/** A requested provider, normalized; null when no build video provider has that name. */
export function parseBuildVideoProvider(value: string): BuildVideoProvider | null {
  const provider = value.trim().toLowerCase();
  return isBuildVideoProvider(provider) ? provider : null;
}

/**
 * Normalize user input; seedance when unset. An unknown name throws rather
 * than quietly switching to another paid provider (`vibe plan` reports it as
 * a validation error before a build gets here).
 */
export function resolveBuildVideoProvider(value: unknown): BuildVideoProvider {
  if (value === undefined || value === null || value === "") return "seedance";
  const provider = parseBuildVideoProvider(String(value));
  if (!provider) throw new Error(unknownVideoProviderMessage(String(value)));
  return provider;
}

/** Why a provider name that used to work no longer does, and what replaces it. */
const RETIRED_VIDEO_PROVIDERS: Readonly<Record<string, string>> = {
  veo: "Veo 3.1 shut down on 2026-10-22; Gemini Omni (omni) replaces it.",
  fal: "`fal` was renamed to `seedance` (same FAL_API_KEY).",
};

export function unknownVideoProviderMessage(value: string): string {
  const retired = RETIRED_VIDEO_PROVIDERS[value.trim().toLowerCase()];
  return `Unknown video provider "${value}". Available: ${BUILD_VIDEO_PROVIDERS.join(", ")}.${retired ? ` ${retired}` : ""}`;
}

/** Config/API-key id that unlocks a video provider. */
export function videoProviderConfigKey(provider: string): string {
  switch (provider) {
    case "seedance":
      return "fal";
    case "grok":
      return "xai";
    case "omni":
      return "google";
    default:
      return provider;
  }
}
