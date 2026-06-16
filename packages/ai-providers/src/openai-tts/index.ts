export {
  OpenAiTtsProvider,
  openaiTtsProvider,
  OPENAI_TTS_VOICES,
  type OpenAiTtsModel,
  type OpenAiTtsVoice,
  type OpenAiTtsOptions,
  type OpenAiTtsResult,
} from "./OpenAiTtsProvider.js";

// No defineProvider call here — this directory is an implementation
// detail of the user-facing "openai" provider (declared in
// `../openai/index.ts`, which adds the "speech" kind). Mirrors how
// `openai-image` backs the same id for image generation.
