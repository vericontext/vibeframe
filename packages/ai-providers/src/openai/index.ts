export { OpenAIProvider, openaiProvider } from "./OpenAIProvider.js";

import { defineProvider } from "../define-provider.js";

// "openai" is the user-facing provider id (`-p openai`). Internally four
// classes back this single id: OpenAIProvider (chat/LLM), OpenAIImageProvider
// (gpt-image-2), OpenAiTtsProvider (gpt-4o-mini-tts speech), and
// WhisperProvider (transcription). The metadata layer stays user-facing;
// the class wiring is in commands/_shared/*.
defineProvider({
  id: "openai",
  label: "OpenAI",
  apiKey: "openai",
  kinds: ["llm", "image", "transcription", "speech"],
  resolverPriority: { image: 1, speech: 2 },
  commandsUnlocked: [
    "agent -p openai",
    "generate image -p openai",
    "edit image -p openai",
    "audio transcribe",
    "edit caption",
    "edit jump-cut",
  ],
});
