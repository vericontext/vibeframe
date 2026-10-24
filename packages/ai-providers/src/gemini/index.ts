export * from "./GeminiProvider.js";
export * from "./gemini-motion.js";
export * from "./gemini-models.js";
export * from "./gemini-omni.js";

import { defineProvider } from "../define-provider.js";

// Gemini and Gemini Omni share the GOOGLE_API_KEY apiKey.
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

// Gemini Omni 1.1 Flash, the Google video default on the same GOOGLE_API_KEY.
defineProvider({
  id: "omni",
  label: "Gemini Omni",
  apiKey: "google",
  kinds: ["video"],
  resolverPriority: { video: 3 },
  commandsUnlocked: ["generate video -p omni"],
});
