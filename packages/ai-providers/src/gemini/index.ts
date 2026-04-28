export * from "./GeminiProvider.js";
export * from "./gemini-motion.js";

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
  resolverPriority: { video: 3 },
  commandsUnlocked: ["generate video -p veo"],
});
