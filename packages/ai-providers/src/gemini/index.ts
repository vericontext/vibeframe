export * from "./GeminiProvider.js";
export * from "./gemini-motion.js";
export * from "./gemini-models.js";
export * from "./gemini-omni.js";

import { defineProvider } from "../define-provider.js";

// Gemini and Veo share the GOOGLE_API_KEY apiKey. Both are declared here
// since they both live in the gemini/ directory (Veo is invoked via the
// Gemini SDK / Google Generative AI client).
defineProvider({
  id: "gemini",
  label: "Gemini",
  apiKey: "google",
  kinds: ["image", "llm"],
  resolverPriority: { image: 2 },
  commandsUnlocked: [
    "generate image",
    "edit image",
    "analyze media",
    "analyze video",
    "analyze review",
  ],
});

defineProvider({
  id: "veo",
  label: "Veo",
  apiKey: "google",
  kinds: ["video"],
  // No resolverPriority: the Veo 3.1 previews shut down on 2026-10-22, so
  // Veo is explicit-only (`-p veo`) and Omni is the Google default.
  commandsUnlocked: ["generate video -p veo"],
});

// Gemini Omni 1.1 Flash, the Google video default on the same GOOGLE_API_KEY.
defineProvider({
  id: "omni",
  label: "Gemini Omni",
  apiKey: "google",
  kinds: ["video"],
  resolverPriority: { video: 3 },
  commandsUnlocked: ["generate video -p omni"],
});
