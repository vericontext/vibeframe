/**
 * Smart provider auto-resolution
 * 1. Check ~/.vibeframe/config.yaml defaults (if set)
 * 2. Fall back to first provider with a configured API key
 *
 * Provider candidate lists (image / video / speech) are derived from the
 * `defineProvider` registry in `@vibeframe/ai-providers/api-keys.ts` +
 * each provider's `index.ts`. Priority order, label, and envvar mapping
 * all live there now — adding a new provider is a single declaration.
 *
 * Pre-v0.68 the IMAGE_PROVIDERS / VIDEO_PROVIDERS / SPEECH_PROVIDERS
 * arrays were hardcoded here and cross-validated against four other
 * files via `scripts/sync-counts.sh` category B. v0.68 collapsed all
 * five into a single registry; the cross-validation became structural.
 */

import { getProvidersFor, type ProviderCandidate } from "@vibeframe/ai-providers";
import { hasApiKey } from "./api-key.js";

export type { ProviderCandidate };

/** Cached config defaults (loaded once per process) */
let configDefaults: Record<string, string> | null = null;

/**
 * Load provider defaults from config (async, cached).
 * Call once at startup if you want config-aware resolution.
 */
export async function loadProviderDefaults(): Promise<void> {
  try {
    const { loadConfig } = await import("../config/index.js");
    const config = await loadConfig();
    if (config?.defaults) {
      configDefaults = {};
      if (config.defaults.imageProvider) configDefaults.image = config.defaults.imageProvider;
      if (config.defaults.videoProvider) configDefaults.video = config.defaults.videoProvider;
    }
  } catch {
    configDefaults = null;
  }
}

/**
 * Resolve the best available provider for a given category.
 * Priority: 1) config defaults  2) first provider with API key
 */
export function resolveProvider(
  category: "image" | "video" | "speech"
): { name: string; label: string } | null {
  const candidates = getProvidersFor(category);
  if (candidates.length === 0) return null;

  // Check config default first
  if (configDefaults?.[category]) {
    const preferred = candidates.find(c => c.name === configDefaults![category]);
    if (preferred && (preferred.envVar === null || hasApiKey(preferred.envVar))) {
      return { name: preferred.name, label: preferred.label };
    }
  }

  // Fall back to first available
  for (const candidate of candidates) {
    if (candidate.envVar === null || hasApiKey(candidate.envVar)) {
      return { name: candidate.name, label: candidate.label };
    }
  }

  return null;
}
