import type {
  AICapability,
  AIProvider,
  ProviderConfig,
} from "../interface/types.js";

/**
 * Default voice for Kokoro. American English, "A" overall grade in the
 * model card. Same default the upstream library uses.
 */
export const KOKORO_DEFAULT_VOICE = "af_heart";

/**
 * Default model id on the Hugging Face Hub. Pinned to the ONNX community
 * mirror so the model can be loaded via `@huggingface/transformers` without
 * any auth.
 */
export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

/**
 * Options accepted by {@link KokoroProvider.textToSpeech}. Mirrors the
 * subset of {@link import("../elevenlabs/ElevenLabsProvider.js").TTSOptions}
 * that makes sense for a local model — voice + speed only.
 */
export interface KokoroTTSOptions {
  /** Kokoro voice id (e.g. `"af_heart"`, `"am_michael"`). Defaults to `"af_heart"`. */
  voice?: string;
  /** Speaking speed multiplier (default `1`). */
  speed?: number;
  /**
   * Called with model-load progress events on the first call (cold start
   * downloads ~330MB). Subsequent calls reuse the cached singleton and do
   * not invoke this callback.
   */
  onProgress?: (event: KokoroLoadEvent) => void;
}

/**
 * Subset of the `@huggingface/transformers` progress callback shape we surface.
 * We accept the upstream union but normalise to this minimal record.
 */
export interface KokoroLoadEvent {
  /** Stage label from upstream (e.g. `"download"`, `"progress"`, `"done"`). */
  status: string;
  /** Model file name being processed (when applicable). */
  file?: string;
  /** Progress percentage 0-100 (when applicable). */
  progress?: number;
  /** Bytes loaded so far. */
  loaded?: number;
  /** Total bytes. */
  total?: number;
}

/**
 * Result returned by {@link KokoroProvider.textToSpeech}. Same shape as
 * `TTSResult` from the ElevenLabs provider so callers can treat the two
 * providers interchangeably.
 */
export interface KokoroTTSResult {
  success: boolean;
  /** WAV audio data (when `success === true`). */
  audioBuffer?: Buffer;
  /** Error message (when `success === false`). */
  error?: string;
  /** Length of the input text (same field name ElevenLabs uses). */
  characterCount?: number;
}

/**
 * Internal contract for the Kokoro model instance — narrowed to what we use
 * so the provider stays unit-testable without pulling the full transformers.js
 * type graph into the dependency surface.
 */
interface KokoroModel {
  generate(
    text: string,
    options: { voice?: string; speed?: number },
  ): Promise<{ toWav(): ArrayBuffer }>;
}

interface KokoroLoadOptions {
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  device?: "wasm" | "webgpu" | "cpu" | null;
  progress_callback?: (event: unknown) => void;
}

interface KokoroFactory {
  from_pretrained(
    modelId: string,
    options?: KokoroLoadOptions,
  ): Promise<KokoroModel>;
}

let modelPromise: Promise<KokoroModel> | null = null;
let factoryOverride: KokoroFactory | null = null;

/**
 * Test-only hook to inject a mock factory. Production code never calls this.
 */
export function __setKokoroFactoryForTests(factory: KokoroFactory | null): void {
  factoryOverride = factory;
  modelPromise = null;
}

async function loadKokoroFactory(): Promise<KokoroFactory> {
  if (factoryOverride) return factoryOverride;
  // Dynamic import keeps the heavy `kokoro-js` graph (transformers.js +
  // onnxruntime-node, ~150MB combined) out of cold-path requires. Anything
  // that doesn't actually call `textToSpeech` pays zero cost.
  const mod = (await import("kokoro-js")) as unknown as { KokoroTTS: KokoroFactory };
  return mod.KokoroTTS;
}

function loadModel(progress?: (event: KokoroLoadEvent) => void): Promise<KokoroModel> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const factory = await loadKokoroFactory();
    return factory.from_pretrained(KOKORO_MODEL_ID, {
      dtype: "q8",
      device: "cpu",
      progress_callback: progress
        ? (raw: unknown) => progress(normaliseEvent(raw))
        : undefined,
    });
  })().catch((err) => {
    // Reset cache on failure so the next attempt can retry.
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

function normaliseEvent(raw: unknown): KokoroLoadEvent {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    status: typeof r.status === "string" ? r.status : "unknown",
    file: typeof r.file === "string" ? r.file : undefined,
    progress: typeof r.progress === "number" ? r.progress : undefined,
    loaded: typeof r.loaded === "number" ? r.loaded : undefined,
    total: typeof r.total === "number" ? r.total : undefined,
  };
}

/**
 * Local TTS provider backed by Kokoro-82M (Apache 2.0). Runs the model via
 * `@huggingface/transformers` + `onnxruntime-node`, no API keys required.
 *
 * Cold start downloads ~330MB to the standard Hugging Face cache
 * (`HF_HOME`, defaults to `~/.cache/huggingface/hub`) on the first call.
 * Subsequent calls reuse a module-scope singleton and add only ~1-2s of
 * inference per scene.
 *
 * The `textToSpeech()` shape matches `ElevenLabsProvider.textToSpeech` so a
 * future TTS router can pick between providers without per-callsite branches.
 */
export class KokoroProvider implements AIProvider {
  id = "kokoro";
  name = "Kokoro (local)";
  description = "Local text-to-speech via Kokoro-82M (Apache 2.0)";
  capabilities: AICapability[] = ["text-to-speech"];
  iconUrl = "/icons/kokoro.svg";
  isAvailable = true;

  async initialize(_config: ProviderConfig): Promise<void> {
    // No configuration needed — model + cache live on disk.
  }

  isConfigured(): boolean {
    return true;
  }

  /**
   * Synthesise speech from text. Returns a WAV buffer matching
   * `ElevenLabsProvider.textToSpeech`'s `TTSResult` shape.
   */
  async textToSpeech(
    text: string,
    options: KokoroTTSOptions = {},
  ): Promise<KokoroTTSResult> {
    if (!text || !text.trim()) {
      return { success: false, error: "Empty text" };
    }

    try {
      const model = await loadModel(options.onProgress);
      const audio = await model.generate(text, {
        voice: options.voice ?? KOKORO_DEFAULT_VOICE,
        speed: options.speed ?? 1,
      });
      const buffer = Buffer.from(audio.toWav());
      return {
        success: true,
        audioBuffer: buffer,
        characterCount: text.length,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const kokoroProvider = new KokoroProvider();
