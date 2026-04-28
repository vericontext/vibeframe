export * from "./RunwayProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "runway",
  label: "Runway",
  apiKey: "runway",
  kinds: ["video"],
  resolverPriority: { video: 5 },
  commandsUnlocked: ["generate video -p runway"],
});
