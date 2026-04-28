/**
 * @module define-provider
 * @description Plugin-style registry for AI provider metadata (envvar, label,
 * priority, doctor commands, .env.example shape). The CLI's provider-resolver,
 * config schema, doctor, setup wizard, and `.env.example` generator all derive
 * their data from this registry — adding a new provider becomes a single
 * declaration (or a new directory + a single declaration in `api-keys.ts`).
 *
 * Why two registries (apiKey + provider):
 *
 *   provider ↔ apiKey is many-to-one. Examples:
 *     - `google` apiKey → `gemini` (image/llm) + `veo` (video, virtual)
 *     - `openai` apiKey → `openai` (llm/transcribe) + `openai-image` (image) +
 *       `whisper` (transcription)
 *     - `imgbb` apiKey → no provider class (envvar-only, image hosting)
 *     - `openrouter` apiKey → no provider class (OpenAI-compat, LLM-only)
 *
 *   A single declaration that conflates "auth credential" with "service" can't
 *   express any of these without escape hatches. Splitting them keeps each
 *   declaration small and lets virtual providers (veo) and envvar-only
 *   credentials (imgbb) coexist with normal cases.
 *
 * Separation from the existing `providerRegistry` in `interface/registry.ts`:
 * that one holds AIProvider class instances for capability-based lookup at
 * runtime ("which class handles `text-to-video`?"). This module holds
 * declarative metadata for build-time / startup-time wiring ("which env var
 * does the `fal` provider need?"). They never talk to each other.
 */

export type ProviderKind =
  | "image"
  | "video"
  | "speech"
  | "llm"
  | "transcription"
  | "music";

/**
 * An API credential. Some apiKeys back multiple providers (google → gemini +
 * veo). Some apiKeys have no provider class at all (imgbb, openrouter — used
 * only as envvar lookups).
 */
export interface ApiKeyMeta {
  /** Stable identifier used as `VibeConfig.providers[configKey]` and as the
   *  reference target from `ProviderMeta.apiKey`. */
  configKey: string;
  /** Environment variable name (e.g. `OPENAI_API_KEY`). */
  envVar: string;
  /** Display label for setup wizard / doctor output. */
  label: string;
  /** Whether the setup wizard prompts for this key in `--full` mode. */
  showInSetup: boolean;
  /** Brief one-line description shown next to the key in setup wizard. */
  setupDescription?: string;
  /** First line of the `.env.example` block (without leading `# `). */
  envExampleComment: string;
  /** URL where the user obtains the key (rendered as `# Get yours at: ...`). */
  envExampleUrl: string;
  /** Optional extra `.env.example` lines (e.g. format hints) inserted between
   *  comment+URL and the `KEY=` line. */
  envExampleExtraLines?: readonly string[];
  /**
   * Commands unlocked at the apiKey level — used for credentials that don't
   * have a dedicated provider class (e.g. `imgbb` is just an upload host).
   * Aggregated alongside provider-level `commandsUnlocked`.
   */
  commandsUnlocked?: readonly string[];
}

/**
 * A service provider. Maps to a directory under `packages/ai-providers/src/`
 * in most cases, except virtual entries (veo, openrouter) that share a
 * directory or have none.
 */
export interface ProviderMeta {
  /** Stable identifier — used as `-p <id>` flag value, resolver name, and
   *  doctor diagnostics. Examples: `gemini`, `veo`, `openai-image`, `kokoro`. */
  id: string;
  /** Human-readable label (resolver UI, doctor output). */
  label: string;
  /** ApiKey configKey reference, or `null` for keyless providers (kokoro,
   *  ollama). Multiple providers may share a configKey. */
  apiKey: string | null;
  /** Service kinds — drives which derived arrays the provider appears in. */
  kinds: readonly ProviderKind[];
  /**
   * Lower number = higher priority within a kind. Default 999 (last). Used by
   * `getProvidersFor(kind)` to sort the resolver candidate list. Per-kind
   * because the same provider can rank differently across kinds (e.g. grok:
   * image=3, video=2).
   */
  resolverPriority?: Partial<Record<ProviderKind, number>>;
  /**
   * Commands this provider unlocks when its apiKey is set. Used by `doctor`
   * to render `KEY → ["generate image -p ...", ...]` mapping. Aggregated
   * across providers sharing the same apiKey.
   */
  commandsUnlocked?: readonly string[];
}

const apiKeyRegistry = new Map<string, ApiKeyMeta>();
const providerRegistry = new Map<string, ProviderMeta>();

export function defineApiKey(meta: ApiKeyMeta): void {
  if (apiKeyRegistry.has(meta.configKey)) {
    throw new Error(
      `defineApiKey: duplicate configKey "${meta.configKey}". Each API key must be declared once.`,
    );
  }
  apiKeyRegistry.set(meta.configKey, meta);
}

export function defineProvider(meta: ProviderMeta): void {
  if (providerRegistry.has(meta.id)) {
    throw new Error(
      `defineProvider: duplicate id "${meta.id}". Each provider must be declared once.`,
    );
  }
  if (meta.apiKey !== null && !apiKeyRegistry.has(meta.apiKey)) {
    throw new Error(
      `defineProvider: provider "${meta.id}" references apiKey "${meta.apiKey}" but no defineApiKey call has registered it. Order issue? api-keys.ts must be imported before provider modules.`,
    );
  }
  providerRegistry.set(meta.id, meta);
}

/** Shape consumed by `provider-resolver.ts` (image/video/speech arrays). */
export interface ProviderCandidate {
  name: string;
  envVar: string | null;
  label: string;
}

/**
 * Sorted resolver candidates for a kind. Drop-in replacement for the
 * hardcoded IMAGE_PROVIDERS / VIDEO_PROVIDERS / SPEECH_PROVIDERS arrays.
 */
export function getProvidersFor(kind: ProviderKind): ProviderCandidate[] {
  return [...providerRegistry.values()]
    .filter((p) => p.kinds.includes(kind))
    .sort(
      (a, b) =>
        (a.resolverPriority?.[kind] ?? 999) -
        (b.resolverPriority?.[kind] ?? 999),
    )
    .map((p) => ({
      name: p.id,
      envVar: p.apiKey ? (apiKeyRegistry.get(p.apiKey)?.envVar ?? null) : null,
      label: p.label,
    }));
}

/** Shape: `{ configKey: envVar }` — drop-in for `PROVIDER_ENV_VARS`. */
export function getProviderEnvVars(): Record<string, string> {
  return Object.fromEntries(
    [...apiKeyRegistry.values()].map((k) => [k.configKey, k.envVar]),
  );
}

/**
 * Shape: `{ envVar: ["cmd1", "cmd2", ...] }` — drop-in for `COMMAND_KEY_MAP`.
 * Aggregates `commandsUnlocked` across providers sharing the same apiKey.
 * Order within each list follows provider declaration order.
 */
export function getCommandKeyMap(): Record<string, readonly string[]> {
  const map: Record<string, string[]> = {};
  for (const p of providerRegistry.values()) {
    if (!p.apiKey) continue;
    if (!p.commandsUnlocked || p.commandsUnlocked.length === 0) continue;
    const envVar = apiKeyRegistry.get(p.apiKey)?.envVar;
    if (!envVar) continue;
    if (!map[envVar]) map[envVar] = [];
    map[envVar].push(...p.commandsUnlocked);
  }
  // Layer apiKey-level commandsUnlocked on top (handles envvar-only keys
  // like IMGBB that have no provider class).
  for (const k of apiKeyRegistry.values()) {
    if (!k.commandsUnlocked || k.commandsUnlocked.length === 0) continue;
    if (!map[k.envVar]) map[k.envVar] = [];
    map[k.envVar].push(...k.commandsUnlocked);
  }
  return map;
}

/** Shape consumed by `setup.ts` allProviders array. */
export interface SetupProviderEntry {
  key: string;
  name: string;
  env: string;
  desc: string;
}

/**
 * Setup wizard rows — only apiKeys with `showInSetup: true`. Order follows
 * `defineApiKey` call order.
 */
export function getSetupProviders(): SetupProviderEntry[] {
  return [...apiKeyRegistry.values()]
    .filter((k) => k.showInSetup)
    .map((k) => ({
      key: k.configKey,
      name: k.label,
      env: k.envVar,
      desc: k.setupDescription ?? "",
    }));
}

/** All registered apiKeys in declaration order. Used by `print-env-example.mts`. */
export function getAllApiKeys(): readonly ApiKeyMeta[] {
  return [...apiKeyRegistry.values()];
}

/** All registered providers in declaration order. Mostly diagnostic / testing. */
export function getAllProviders(): readonly ProviderMeta[] {
  return [...providerRegistry.values()];
}

/**
 * Test-only: clears both registries. Production code never needs this — the
 * registries are filled exactly once at module load via side-effect imports.
 */
export function _resetRegistriesForTesting(): void {
  apiKeyRegistry.clear();
  providerRegistry.clear();
}
