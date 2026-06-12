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
   * downloads a ~90MB quantized model). Subsequent calls reuse the cached
   * singleton and do not invoke this callback.
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

/**
 * Where the kokoro-js import came from. The `device` is "cpu" for every
 * source: npm/workspace installs execute on onnxruntime-node (native), and
 * the extension-bundled runtime's patched transformers build maps the same
 * "cpu" device onto onnxruntime-web's WASM engine.
 */
interface KokoroRuntime {
  factory: KokoroFactory;
  device: "cpu" | "wasm";
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

async function loadKokoroRuntime(): Promise<KokoroRuntime> {
  if (factoryOverride) return { factory: factoryOverride, device: "cpu" };
  // Dynamic import keeps the heavy `kokoro-js` graph (transformers.js +
  // onnxruntime-node, ~150MB combined) out of cold-path requires. Anything
  // that doesn't actually call `textToSpeech` pays zero cost.
  try {
    const mod = (await import("kokoro-js")) as unknown as { KokoroTTS: KokoroFactory };
    return { factory: mod.KokoroTTS, device: "cpu" };
  } catch (err) {
    const workspace = await loadKokoroFromWorkspace();
    if (workspace) return { factory: workspace, device: "cpu" };
    const bundled = await loadBundledKokoroRuntime();
    if (bundled) return bundled;
    throw mapKokoroImportError(err);
  }
}

/**
 * The bare specifier resolves relative to the bundle file, which works for
 * npm installs (kokoro-js sits in the adjacent node_modules) but not for
 * self-contained installs like the Claude Desktop MCPB extension, where the
 * bundle lives alone in the extension directory. There a developer can still
 * install kokoro-js into their workspace folder, so retry from
 * `<cwd>/node_modules/kokoro-js` using its package.json entry point.
 *
 * Exported for tests — the primary bare-specifier import always succeeds in
 * the repo (kokoro-js is installed), so the fallback is exercised directly.
 */
export async function loadKokoroFromWorkspace(
  baseDir = process.cwd()
): Promise<KokoroFactory | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const pkgDir = resolve(baseDir, "node_modules", "kokoro-js");
    const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8")) as {
      exports?: { node?: { import?: string }; default?: string };
      module?: string;
      main?: string;
    };
    const entry =
      pkg.exports?.node?.import ?? pkg.exports?.default ?? pkg.module ?? pkg.main;
    if (!entry) return null;
    const mod = (await import(pathToFileURL(join(pkgDir, entry)).href)) as unknown as {
      KokoroTTS: KokoroFactory;
    };
    return mod.KokoroTTS ?? null;
  } catch {
    return null;
  }
}

/**
 * Self-contained runtime shipped inside the Claude Desktop extension:
 * `VIBE_KOKORO_RUNTIME` (set by the MCPB manifest to a directory inside the
 * extension install) contains a pruned `node_modules` tree where
 * `@huggingface/transformers` resolves to its web build (patched at bundle
 * time to back the "cpu" device with onnxruntime-web's WASM engine) — no
 * onnxruntime-node, no sharp, so it loads on any machine with no npm step.
 *
 * Before importing kokoro-js we point the transformers runtime at:
 *   - `wasmPaths`: the bundled onnxruntime-web `dist/` (the web build's
 *     default is a CDN URL, which Node's ESM loader rejects)
 *   - a filesystem `customCache` under `~/.cache/vibeframe/models` — the
 *     web build has no FS cache, and the extension's own directory is
 *     replaced on every update, so the model cache must live per-user.
 *     Verified: first call downloads ~88MB once; later processes load in
 *     under a second.
 *
 * Exported for tests and the build-time smoke check.
 */
export async function loadBundledKokoroRuntime(
  runtimeDir = process.env.VIBE_KOKORO_RUNTIME
): Promise<KokoroRuntime | null> {
  const base = runtimeDir?.trim();
  if (!base) return null;
  try {
    const { readFile, writeFile, mkdir } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { homedir } = await import("node:os");

    const transformersDir = resolve(base, "node_modules", "@huggingface", "transformers");
    const ortDistDir = resolve(base, "node_modules", "onnxruntime-web", "dist");
    // Same file URL kokoro-js's bare import resolves to (its package.json
    // exports were rewritten at bundle time), so this is the same module
    // instance — env settings here apply to kokoro's inference calls.
    const transformers = (await import(
      pathToFileURL(join(transformersDir, "dist", "transformers.web.js")).href
    )) as {
      env: {
        allowLocalModels?: boolean;
        useCustomCache?: boolean;
        customCache?: {
          match(key: unknown): Promise<Response | undefined>;
          put(key: unknown, response: Response): Promise<void>;
        } | null;
        backends: { onnx: { wasm: { wasmPaths?: string } } };
      };
    };

    const cacheRoot = join(homedir(), ".cache", "vibeframe", "models");
    transformers.env.allowLocalModels = false;
    transformers.env.useCustomCache = true;
    transformers.env.customCache = {
      async match(key: unknown): Promise<Response | undefined> {
        try {
          return new Response(await readFile(join(cacheRoot, encodeURIComponent(String(key)))));
        } catch {
          return undefined;
        }
      },
      async put(key: unknown, response: Response): Promise<void> {
        try {
          const buf = Buffer.from(await response.arrayBuffer());
          await mkdir(cacheRoot, { recursive: true });
          await writeFile(join(cacheRoot, encodeURIComponent(String(key))), buf);
        } catch {
          // Cache writes are best-effort — synthesis still works, the next
          // process just downloads again.
        }
      },
    };
    transformers.env.backends.onnx.wasm.wasmPaths = pathToFileURL(ortDistDir + "/").href;

    const factory = await loadKokoroFromWorkspace(base);
    if (!factory) return null;
    // "cpu" is correct here: in the patched web build the cpu device maps
    // to onnxruntime-web's node entry, which executes via WASM. The build
    // rejects device:"wasm" under Node.
    return { factory, device: "cpu" };
  } catch {
    return null;
  }
}

/**
 * kokoro-js ships as an optionalDependency (its native graph can fail to
 * install on some platforms). Translate the raw module-resolution error into
 * an actionable message instead of a bare ERR_MODULE_NOT_FOUND.
 */
export function mapKokoroImportError(err: unknown): Error {
  const code =
    err instanceof Error && "code" in err
      ? (err as NodeJS.ErrnoException).code
      : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return new Error(
      "Local Kokoro TTS is unavailable: kokoro-js could not be loaded from the npm " +
        "install, the workspace node_modules, or the bundled extension runtime. " +
        "Set OPENAI_API_KEY or ELEVENLABS_API_KEY to use a cloud voice instead " +
        "(ttsProvider: openai / elevenlabs), or install the engine locally with " +
        "`npm i kokoro-js` in your workspace folder."
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

function loadModel(progress?: (event: KokoroLoadEvent) => void): Promise<KokoroModel> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const runtime = await loadKokoroRuntime();
    const override = process.env.VIBE_ONNX_DEVICE;
    const device = override === "cpu" || override === "wasm" ? override : runtime.device;
    return runtime.factory.from_pretrained(KOKORO_MODEL_ID, {
      dtype: "q8",
      device,
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
 * `@huggingface/transformers` — onnxruntime-node (native CPU) for npm and
 * workspace installs, or the bundled WASM backend inside the Claude Desktop
 * extension. No API keys required.
 *
 * Cold start downloads a ~90MB quantized model on the first call (cache
 * location depends on the runtime — transformers' default for installs,
 * `~/.cache/vibeframe/models` for the bundled extension runtime).
 * Subsequent calls reuse a module-scope singleton and add only ~1-2s of
 * inference per scene (longer on the WASM backend).
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
