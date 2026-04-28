/**
 * @module _shared/composer-resolve
 *
 * Picks the LLM provider that powers `compose-scenes-with-skills`. Until
 * v0.69 the composer was hardcoded to Anthropic Claude Sonnet 4.6; v0.70
 * exposes Claude / OpenAI / Gemini as interchangeable backends behind the
 * same Hyperframes skill-bundle prompt (Phase 0 spike validated that all
 * three pass first-shot lint on the same prompts — see
 * `scripts-spike-composer-providers.mts` for the data).
 *
 * Auto-resolve preserves the v0.69 default (Claude) when the user has an
 * `ANTHROPIC_API_KEY` set. Without one we fall back to Gemini (cheapest of
 * the three per the spike) and then OpenAI. Explicit `--composer <name>`
 * always wins.
 */

export type ComposerProvider = "claude" | "openai" | "gemini";

export interface ComposerResolution {
  provider: ComposerProvider;
  apiKey: string;
}

const ENV_VAR: Record<ComposerProvider, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

const PROVIDER_LABEL: Record<ComposerProvider, string> = {
  claude: "Anthropic Claude",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

/** Env var name for a provider's composer key. */
export function composerEnvVar(provider: ComposerProvider): string {
  return ENV_VAR[provider];
}

/** Human label for error messages. */
export function composerLabel(provider: ComposerProvider): string {
  return PROVIDER_LABEL[provider];
}

/** Read the API key for one provider from the current environment. */
function readKey(provider: ComposerProvider): string | undefined {
  const v = process.env[ENV_VAR[provider]];
  return v && v.length > 0 ? v : undefined;
}

/** Validate a composer string supplied via CLI flag / pipeline YAML. */
export function isComposerProvider(value: unknown): value is ComposerProvider {
  return value === "claude" || value === "openai" || value === "gemini";
}

/**
 * Resolve a composer provider + key.
 *
 * `explicit` takes precedence — if it's set, we require its key and return
 * exactly that provider. With no `explicit`, we walk the auto-resolve order
 * (`claude > gemini > openai`) and return the first provider whose key is
 * present.
 *
 * Throws `ComposerResolveError` if (a) `explicit` was set but its key is
 * missing, or (b) no provider's key is present.
 */
export function resolveComposer(explicit?: ComposerProvider): ComposerResolution {
  if (explicit) {
    const key = readKey(explicit);
    if (!key) {
      throw new ComposerResolveError(
        "missing-explicit-key",
        `${PROVIDER_LABEL[explicit]} requires ${ENV_VAR[explicit]} to be set in your env or .env file.`,
        { requestedProvider: explicit },
      );
    }
    return { provider: explicit, apiKey: key };
  }

  // Auto-resolve order picked by the v0.70 spike:
  //   1. claude — fastest (~9 s/beat) and the v0.69 default (no breakage)
  //   2. gemini — ~2.6× cheaper than Claude, ~20 s/beat
  //   3. openai — comparable cost to Claude but ~70 s/beat (gpt-5 reasoning)
  for (const candidate of ["claude", "gemini", "openai"] as const) {
    const key = readKey(candidate);
    if (key) return { provider: candidate, apiKey: key };
  }

  throw new ComposerResolveError(
    "no-key-available",
    `No composer API key found. Set one of: ${(["claude", "gemini", "openai"] as const)
      .map((p) => ENV_VAR[p])
      .join(", ")}.`,
  );
}

export class ComposerResolveError extends Error {
  constructor(
    public readonly code: "missing-explicit-key" | "no-key-available",
    message: string,
    public readonly meta: { requestedProvider?: ComposerProvider } = {},
  ) {
    super(message);
    this.name = "ComposerResolveError";
  }
}
