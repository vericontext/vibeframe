export * from "./WhisperProvider.js";

// No defineProvider call here — Whisper transcription is an
// implementation detail of the user-facing "openai" provider (declared
// in `../openai/index.ts` with kinds including "transcription").
// `WhisperProvider` is the class instance; the metadata layer stays at
// the user-facing id level.
