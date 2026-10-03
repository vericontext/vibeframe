---
provider: kokoro
checked: 2026-10-04
env: [VIBE_KOKORO_RUNTIME, VIBE_ONNX_DEVICE]
models_endpoint: none
models_in_use:
  - onnx-community/Kokoro-82M-v1.0-ONNX
---

# Kokoro

VibeFrame uses Kokoro-82M as the free, local narration voice: `--tts kokoro`, and the `--tts auto` fallback when neither `ELEVENLABS_API_KEY` nor `OPENAI_API_KEY` is set.
It runs in-process through the `kokoro-js` npm package (transformers.js + onnxruntime-node), with no API key and no network after the first model download.

## Models

| ID | Kind | Status | Price | Notes |
|---|---|---|---|---|
| `hexgrad/Kokoro-82M` v1.0 | TTS, 82M params | released 2025-01-27, card updated 2025-04-10 | free, Apache 2.0 | StyleTTS 2 + ISTFTNet decoder, 8 languages and 54 voices (docs). |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | ONNX export of v1.0 | last modified 2025-02-08 | free, Apache 2.0 | **What we load.** `q8` resolves to `onnx/model_quantized.onnx`, 92.4 MB; fp32 is 325.5 MB, fp16 163.2 MB, q8f16 86.0 MB (probe). |
| `hexgrad/Kokoro-82M-v1.1-zh` | TTS | released early 2025 (card modified 2025-03-04) | free, Apache 2.0 | Adds 100 Chinese speakers plus 3 synthetic English voices, but drops many v1.0 voices; the author says it is not a strict upgrade (docs). |
| `onnx-community/Kokoro-82M-v1.1-zh-ONNX` | ONNX export of v1.1-zh | modified 2025-07-05 | free | Not supported by `kokoro-js` 1.2.1, which only knows the v1.0 voice table (probe of package source). |

There is no newer Kokoro release than v1.0 / v1.1-zh on the Hub as of 2026-10-04 (probe).

### The npm package

- `kokoro-js` 1.2.1 (published 2025-05-03) is the latest on npm (probe of the npm registry).
- License Apache-2.0; depends on `@huggingface/transformers` ^3.5.1 and `phonemizer` ^1.2.1 (probe of the installed package).
- Our lockfile resolves `kokoro-js@1.2.1`, `@huggingface/transformers@3.8.1`, `onnxruntime-node@1.21.0`.

## API shape

Local library, no HTTP API.

- Load: `KokoroTTS.from_pretrained(modelId, {dtype, device, progress_callback})`, with `dtype` one of `fp32`, `fp16`, `q8`, `q4`, `q4f16` and `device` `cpu` (Node), `wasm` or `webgpu` (browser) (docs).
  The model files download from the Hugging Face Hub on first use into the transformers.js cache, then load from disk.
- Generate: `tts.generate(text, {voice, speed})` returns a `RawAudio` at 24 kHz with `.toWav()` (docs, probe).
- Stream: `tts.stream(textOrSplitter, {voice, speed, split_pattern})` yields `{text, phonemes, audio}` per sentence chunk, and `TextSplitterStream` accepts incremental text (docs).
- Voices: `tts.list_voices()`; voice files ship inside the package under `voices/` (probe).
- Errors: thrown JS errors (unknown voice, missing runtime); our provider converts them to `{success: false, error}`.

## Gotchas

- **`generate()` silently truncates long text.**
  It tokenizes with `truncation: true` and the style vector is indexed at most at 509 tokens (probe of package source).
  A 1,247-character input produced only 26.4 s of audio, about a third of the expected length, with no error (probe).
  Use `stream()` or split by sentence before calling `generate()`.
- **Only English voices work in `kokoro-js` 1.2.1.**
  The package ships 54 voice `.bin` files, but its voice table and `_validate_voice` accept only the 28 American (`af_*`, `am_*`) and British (`bf_*`, `bm_*`) voices (probe).
  `ef_dora` threw `Voice "ef_dora" not found` (probe).
  Phonemization uses `en-us` for `a*` voices and `en` otherwise, so non-English text is spoken with English phonemes (probe of package source).
- Voice quality varies a lot; the package's table grades `af_heart` A and `af_bella` A-, while voices like `am_adam` are graded F+ (probe of package source).
  Our default `af_heart` is the best graded one.
- First call downloads about 92 MB (`q8`) and must have network access to `huggingface.co`; later calls are offline.
- Performance on an Apple M4, `q8`, `device: "cpu"` (probe): cold load including the download took 10.7 s; 84 characters (6.0 s of audio) took 2.9 s; 1,247 characters (truncated to 26.4 s of audio) took 11.1 s.
  So it runs at roughly 2x real time on a fast laptop, and the first call in a process pays the load cost.
- `kokoro-js` + transformers.js + onnxruntime-node is a heavy dependency graph (our code comment says about 150 MB installed); we import it dynamically so other commands do not pay for it.
- The model card warns that websites with "kokoro" in the domain are not affiliated with the model (docs).

## In our code

- `packages/ai-providers/src/kokoro/KokoroProvider.ts`
  - L11 `KOKORO_DEFAULT_VOICE = "af_heart"`, L18 `KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"`.
  - L117-131 `loadKokoroRuntime`: dynamic `import("kokoro-js")` at L123, then workspace and bundled MCPB fallbacks.
  - L190 reads `VIBE_KOKORO_RUNTIME` (MCPB bundled runtime dir).
  - L276-290 `loadModel`: L280 reads `VIBE_ONNX_DEVICE` (`cpu` or `wasm`), L282-283 `from_pretrained(..., {dtype: "q8"})`, cached as a module singleton.
  - L343-366 `textToSpeech`: one `model.generate(text, ...)` call at L353 with no chunking, returns WAV.
- `packages/cli/src/commands/_shared/tts-resolve.ts` L14 (doc), L82-91 auto order, L131-142 `buildKokoro`.
- `packages/cli/src/commands/scene.ts` L480, L696: `--voice` help names Kokoro IDs.
- Dependency `"kokoro-js": "^1.2.1"` in `packages/ai-providers/package.json` L64, `packages/cli/package.json` L95, `packages/mcp-server/package.json` L56.

## Recommended changes

1. Chunk text before synthesis (use `tts.stream()` with sentence splitting, or split and concatenate WAVs) so long narration is not cut off.
2. Validate `--voice` against the 28 English voice IDs up front and say clearly that Kokoro narration is English-only in this package version.
3. Warn when the input text is long enough to hit the token cap, until chunking lands.
4. Keep `q8`; `q8f16` (86 MB) is slightly smaller but was not tested for quality or Node support.
5. Re-check npm and the Hub for a Kokoro release newer than v1.0 / `kokoro-js` 1.2.1 at the next review.

## Sources

All opened 2026-10-04.

- https://huggingface.co/hexgrad/Kokoro-82M (model card README)
- https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh (model card README)
- https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX?blobs=true (file sizes, probe)
- https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.1-zh-ONNX (probe)
- https://registry.npmjs.org/kokoro-js (versions and dates, probe)
- `kokoro-js` 1.2.1 README and `dist/kokoro.js` from `node_modules` (installed package)
- Local benchmark with the repo's installed `kokoro-js`, cache in a scratch directory (probe)

