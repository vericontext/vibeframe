/**
 * The model catalog: every model VibeFrame calls, in one table.
 *
 * Model IDs, CLI aliases, per-provider defaults, lifecycle dates, and list
 * prices used to be spread across provider classes, CLI commands, and docs,
 * so each model update meant editing a dozen files and missing some. Alias
 * resolvers, default lookups, and cost estimates now read this table, and
 * MODELS.md's catalog section is generated from it (`pnpm gen:models`).
 *
 * Facts were verified against provider docs and live `/models` listings on
 * 2026-10-04; see `.agents/references/providers/` for sources.
 */

export type ModelKind =
  | "llm"
  | "image"
  | "video"
  | "speech"
  | "music"
  | "sound-effect"
  | "transcription";

export type ModelStatus = "ga" | "preview" | "legacy" | "deprecated";

export interface ModelPrice {
  usd: number;
  /** What one `usd` buys. */
  per: "image" | "second" | "minute" | "1K characters" | "1M input tokens";
  /** Conditions the price assumes (quality, resolution, tier). */
  basis?: string;
}

export interface ModelSpec {
  /** The ID sent to the provider API. */
  id: string;
  /** Provider registry id (`defineProvider`), e.g. "openai", "seedance". */
  provider: string;
  kind: ModelKind;
  label: string;
  /** CLI aliases that select this model within its provider and kind. */
  aliases?: readonly string[];
  /** The model used when no alias is given (one per provider and kind). */
  default?: boolean;
  status: ModelStatus;
  /** ISO date the provider stops serving this model, when announced. */
  shutdown?: string;
  /** Upper-bound list price, for estimates and docs. */
  price?: ModelPrice;
  /** One short line for MODELS.md. */
  note?: string;
}

export const MODEL_CATALOG: readonly ModelSpec[] = [
  // ── LLMs ──────────────────────────────────────────────────────────────
  { id: "claude-sonnet-5-5", provider: "claude", kind: "llm", label: "Claude Sonnet 5.5", aliases: ["sonnet"], default: true, status: "ga", price: { usd: 2, per: "1M input tokens" }, note: "Agent, storyboard, translate-srt, motion default" },
  { id: "claude-opus-5-5", provider: "claude", kind: "llm", label: "Claude Opus 5.5", aliases: ["opus"], status: "ga", price: { usd: 4, per: "1M input tokens" } },
  { id: "claude-opus-4-6", provider: "claude", kind: "llm", label: "Claude Opus 4.6", aliases: ["opus-4-6"], status: "legacy", price: { usd: 5, per: "1M input tokens" } },
  { id: "gpt-5.4-mini", provider: "openai", kind: "llm", label: "GPT-5.4 mini", default: true, status: "ga", price: { usd: 0.75, per: "1M input tokens" }, note: "Agent and storyboard default (tools on Chat Completions)" },
  { id: "gemini-3.8-flash", provider: "gemini", kind: "llm", label: "Gemini 3.8 Flash", aliases: ["flash", "latest", "flash-3.8", "gemini"], default: true, status: "ga", price: { usd: 0.75, per: "1M input tokens", basis: "until 2026-12-31, then $1.50" } },
  { id: "gemini-3.5-flash", provider: "gemini", kind: "llm", label: "Gemini 3.5 Flash", aliases: ["flash-3.5"], status: "ga" },
  { id: "gemini-3-flash-preview", provider: "gemini", kind: "llm", label: "Gemini 3 Flash (preview)", aliases: ["flash-3"], status: "preview" },
  { id: "gemini-3.1-pro-preview", provider: "gemini", kind: "llm", label: "Gemini 3.1 Pro (preview)", aliases: ["pro", "pro-3.1", "3.1-pro", "gemini-3.1-pro"], status: "preview" },
  { id: "gemini-2.5-flash", provider: "gemini", kind: "llm", label: "Gemini 2.5 Flash", aliases: ["flash-2.5"], status: "legacy", note: "New projects cannot use 2.5 models since 2026-09-18" },
  { id: "gemini-2.5-pro", provider: "gemini", kind: "llm", label: "Gemini 2.5 Pro", aliases: ["pro-2.5", "2.5-pro"], status: "legacy" },
  { id: "grok-4.3", provider: "grok", kind: "llm", label: "Grok 4.3", default: true, status: "ga", price: { usd: 1.25, per: "1M input tokens" } },
  { id: "grok-4.7", provider: "grok", kind: "llm", label: "Grok 4.7", status: "ga", price: { usd: 2, per: "1M input tokens" } },

  // ── Images ────────────────────────────────────────────────────────────
  { id: "gpt-image-2.5-sunburst", provider: "openai", kind: "image", label: "GPT Image 2.5 Sunburst", aliases: ["2.5", "sunburst"], default: true, status: "ga", price: { usd: 0.211, per: "image", basis: "high, 1024x1024" } },
  { id: "gpt-image-2.5-flare", provider: "openai", kind: "image", label: "GPT Image 2.5 Flare", aliases: ["flare", "2.5-flare"], status: "ga", price: { usd: 0.211, per: "image", basis: "high, 1024x1024" } },
  { id: "gpt-image-2", provider: "openai", kind: "image", label: "GPT Image 2", aliases: ["2"], status: "ga", price: { usd: 0.211, per: "image", basis: "high, 1024x1024" } },
  { id: "gpt-image-1.5", provider: "openai", kind: "image", label: "GPT Image 1.5", aliases: ["1.5"], status: "deprecated", shutdown: "2026-12-01", price: { usd: 0.133, per: "image", basis: "high, 1024x1024" } },
  { id: "gemini-3.1-flash-image", provider: "gemini", kind: "image", label: "Nano Banana 2", aliases: ["flash", "3.1-flash", "latest"], default: true, status: "ga", price: { usd: 0.067, per: "image", basis: "1K" } },
  { id: "gemini-3.1-flash-lite-image", provider: "gemini", kind: "image", label: "Nano Banana 2 Lite", aliases: ["lite"], status: "ga", price: { usd: 0.034, per: "image", basis: "1K" } },
  { id: "gemini-3-pro-image", provider: "gemini", kind: "image", label: "Nano Banana Pro", aliases: ["pro"], status: "ga", price: { usd: 0.134, per: "image", basis: "1K-2K" } },
  { id: "gemini-2.5-flash-image", provider: "gemini", kind: "image", label: "Nano Banana (2.5 Flash Image)", status: "deprecated", shutdown: "2026-10-02" },
  { id: "gemini-3.1-flash-image-preview", provider: "gemini", kind: "image", label: "Nano Banana 2 (preview)", status: "deprecated", shutdown: "2026-06-25" },
  { id: "gemini-3-pro-image-preview", provider: "gemini", kind: "image", label: "Nano Banana Pro (preview)", status: "deprecated", shutdown: "2026-06-25" },
  { id: "grok-imagine-image", provider: "grok", kind: "image", label: "Grok Imagine Image", default: true, status: "ga", price: { usd: 0.02, per: "image" } },
  { id: "grok-imagine-image-2.0", provider: "grok", kind: "image", label: "Grok Imagine Image 2.0", aliases: ["pro", "2.0", "quality"], status: "ga", price: { usd: 0.08, per: "image", basis: "medium, 2K" } },

  // ── Video ─────────────────────────────────────────────────────────────
  { id: "seedance-2.0", provider: "seedance", kind: "video", label: "Seedance 2.0", aliases: ["quality", "2.0"], default: true, status: "ga", price: { usd: 0.3024, per: "second", basis: "720p 16:9" }, note: "4-15 s, native audio" },
  { id: "seedance-2.0-fast", provider: "seedance", kind: "video", label: "Seedance 2.0 Fast", aliases: ["fast"], status: "ga", price: { usd: 0.2419, per: "second", basis: "720p 16:9" }, note: "4-15 s, up to 720p, native audio" },
  { id: "seedance-2.5", provider: "seedance", kind: "video", label: "Seedance 2.5", aliases: ["2.5"], status: "ga", price: { usd: 0.473, per: "second", basis: "720p 16:9" }, note: "Opt-in; 4-30 s, native audio" },
  { id: "gemini-omni-1.1-flash", provider: "omni", kind: "video", label: "Gemini Omni 1.1 Flash", default: true, status: "ga", price: { usd: 0.1, per: "second", basis: "720p" }, note: "Google video default; the model picks 3-10 s; native audio" },
  { id: "veo-3.1-generate-preview", provider: "veo", kind: "video", label: "Veo 3.1", aliases: ["3.1"], status: "deprecated", shutdown: "2026-10-22", price: { usd: 0.4, per: "second", basis: "720p/1080p" }, note: "4-8 s, native audio; explicit `-p veo` only" },
  { id: "veo-3.1-fast-generate-preview", provider: "veo", kind: "video", label: "Veo 3.1 Fast", aliases: ["3.1-fast"], default: true, status: "deprecated", shutdown: "2026-10-22", price: { usd: 0.1, per: "second", basis: "720p" }, note: "4-8 s, native audio; explicit `-p veo` only" },
  { id: "grok-imagine-video-1.5", provider: "grok", kind: "video", label: "Grok Imagine Video 1.5", aliases: ["1.5"], default: true, status: "ga", price: { usd: 0.14, per: "second", basis: "720p" }, note: "1-15 s, native audio; 720p unless `--resolution` says otherwise" },
  { id: "grok-imagine-video-1.5-lite", provider: "grok", kind: "video", label: "Grok Imagine Video 1.5 Lite", aliases: ["lite", "1.5-lite"], status: "ga", price: { usd: 0.03, per: "second", basis: "720p" }, note: "1-15 s, native audio" },
  { id: "grok-imagine-video", provider: "grok", kind: "video", label: "Grok Imagine Video", aliases: ["classic"], status: "legacy", price: { usd: 0.05, per: "second", basis: "480p" }, note: "Previous generation" },
  { id: "kling-v3", provider: "kling", kind: "video", label: "Kling v3", aliases: ["v3"], default: true, status: "ga", price: { usd: 0.084, per: "second", basis: "std, silent" }, note: "3-15 s, multi-shot; `std` 720p, `pro` 1080p" },
  { id: "kling-v2-6", provider: "kling", kind: "video", label: "Kling v2.6", aliases: ["v2.6"], status: "ga", price: { usd: 0.042, per: "second", basis: "std 720p" }, note: "5 or 10 s" },
  { id: "kling-v2-5-turbo", provider: "kling", kind: "video", label: "Kling v2.5 Turbo", aliases: ["v2.5-turbo", "v2.5"], status: "ga", price: { usd: 0.042, per: "second", basis: "std" }, note: "5 or 10 s, no audio" },
  { id: "gen4.5", provider: "runway", kind: "video", label: "Runway Gen-4.5", default: true, status: "ga", price: { usd: 0.12, per: "second" }, note: "2-10 s, no audio" },
  { id: "gen4_turbo", provider: "runway", kind: "video", label: "Runway Gen-4 Turbo", status: "ga", price: { usd: 0.05, per: "second" }, note: "Image-to-video only, no audio" },

  // ── Audio ─────────────────────────────────────────────────────────────
  { id: "eleven_v3", provider: "elevenlabs", kind: "speech", label: "ElevenLabs v3", default: true, status: "ga", price: { usd: 0.08, per: "1K characters" } },
  { id: "gpt-4o-mini-tts", provider: "openai", kind: "speech", label: "GPT-4o mini TTS", default: true, status: "deprecated", shutdown: "2027-01-06" },
  { id: "music_v2_5", provider: "elevenlabs", kind: "music", label: "ElevenLabs Music v2.5", default: true, status: "ga", price: { usd: 0.15, per: "minute" } },
  { id: "eleven_text_to_sound_v2", provider: "elevenlabs", kind: "sound-effect", label: "ElevenLabs Sound Effects v2", default: true, status: "ga", price: { usd: 0.12, per: "minute" }, note: "0.5-30 s" },
  { id: "whisper-1", provider: "openai", kind: "transcription", label: "Whisper", default: true, status: "deprecated", shutdown: "2027-02-26", note: "Only OpenAI model with word timestamps" },
];

/** All catalog entries matching the filter, in catalog order. */
export function listModels(filter: { provider?: string; kind?: ModelKind } = {}): ModelSpec[] {
  return MODEL_CATALOG.filter(
    (m) => (!filter.provider || m.provider === filter.provider) && (!filter.kind || m.kind === filter.kind)
  );
}

/** The default model for a provider and kind. Throws if the catalog has none. */
export function defaultModel(provider: string, kind: ModelKind): ModelSpec {
  const found = MODEL_CATALOG.find((m) => m.provider === provider && m.kind === kind && m.default);
  if (!found) throw new Error(`Model catalog has no default ${kind} model for ${provider}`);
  return found;
}

/**
 * Look up a model by alias or full ID within a provider and kind. An empty
 * or missing alias returns the default. Unknown values return undefined so
 * callers decide between an error and a pass-through.
 */
export function findModel(provider: string, kind: ModelKind, aliasOrId?: string): ModelSpec | undefined {
  const key = aliasOrId?.trim();
  if (!key) return defaultModel(provider, kind);
  const lower = key.toLowerCase();
  return listModels({ provider, kind }).find((m) => m.id === key || m.aliases?.includes(lower));
}

/** CLI aliases for a provider and kind, in catalog order, for help and error text. */
export function modelAliases(provider: string, kind: ModelKind): string[] {
  return listModels({ provider, kind }).flatMap((m) => m.aliases ?? []);
}
