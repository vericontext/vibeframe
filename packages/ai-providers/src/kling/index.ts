export * from "./KlingProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "kling",
  label: "Kling",
  apiKey: "kling",
  kinds: ["video"],
  resolverPriority: { video: 4 },
  commandsUnlocked: ["generate video -p kling"],
});
