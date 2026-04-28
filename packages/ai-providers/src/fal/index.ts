export * from "./FalProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "fal",
  label: "fal.ai (Seedance 2.0)",
  apiKey: "fal",
  kinds: ["video"],
  resolverPriority: { video: 1 },
  commandsUnlocked: [
    "generate video -p fal (Seedance 2.0 — default since v0.57)",
    "generate video -p fal -m fast (lower-latency variant)",
    "generate video -p fal -i <image> (image-to-video)",
  ],
});
