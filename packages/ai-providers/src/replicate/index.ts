export * from "./ReplicateProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "replicate",
  label: "Replicate",
  apiKey: "replicate",
  kinds: ["music"],
  commandsUnlocked: ["generate music -p replicate"],
});
