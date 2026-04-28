export * from "./KokoroProvider.js";

import { defineProvider } from "../define-provider.js";

// Kokoro runs locally with no API key — always-available speech fallback
// behind ElevenLabs.
defineProvider({
  id: "kokoro",
  label: "Kokoro (local)",
  apiKey: null,
  kinds: ["speech"],
  resolverPriority: { speech: 2 },
});
