export * from "./KokoroProvider.js";

import { defineProvider } from "../define-provider.js";

// Kokoro runs locally with no API key — always-available speech fallback
// behind ElevenLabs and OpenAI TTS.
defineProvider({
  id: "kokoro",
  label: "Kokoro (local)",
  apiKey: null,
  kinds: ["speech"],
  resolverPriority: { speech: 3 },
});
