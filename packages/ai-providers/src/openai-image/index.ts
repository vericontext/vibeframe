export {
  OpenAIImageProvider,
  openaiImageProvider,
  type GPTImageModel,
  type GPTImageQuality,
  type ImageOptions,
  type ImageResult,
  type ImageEditOptions,
} from "./OpenAIImageProvider.js";

// No defineProvider call here — this directory is an implementation
// detail of the user-facing "openai" provider (which is declared in
// `../openai/index.ts` with kinds=["llm", "image", "transcription"]).
// `OpenAIImageProvider` is the class instance that backs the image
// service; the metadata layer stays at the user-facing id level.
