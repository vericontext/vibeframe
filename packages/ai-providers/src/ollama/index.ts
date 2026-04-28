export { OllamaProvider, ollamaProvider } from "./OllamaProvider.js";

import { defineProvider } from "../define-provider.js";

// Ollama runs locally with no API key.
defineProvider({
  id: "ollama",
  label: "Ollama (Local)",
  apiKey: null,
  kinds: ["llm"],
});
