export { OpenAIProvider, openaiProvider } from "./OpenAIProvider.js";

import { defineProvider } from "../define-provider.js";

// "openai" is the user-facing provider id (`-p openai`). Internally three
// classes back this single id: OpenAIProvider (chat/LLM), OpenAIImageProvider
// (gpt-image-2), and WhisperProvider (transcription). The metadata layer
// stays user-facing; the class wiring is in commands/_shared/*.
defineProvider({
  id: "openai",
  label: "OpenAI",
  apiKey: "openai",
  kinds: ["llm", "image", "transcription"],
  resolverPriority: { image: 1 },
  commandsUnlocked: [
    "agent -p openai",
    "generate image -p openai",
    "edit image -p openai",
    "audio transcribe",
    "edit caption",
    "edit jump-cut",
  ],
});
