export * from "./FalProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "fal",
  label: "fal.ai (Seedance 2.0)",
  displayName: "Seedance 2.0",
  gateway: "fal.ai",
  aliases: ["seedance"],
  models: ["seedance-2.0", "seedance-2.0-fast"],
  capabilities: ["text-to-video", "image-to-video", "native-audio"],
  apiKey: "fal",
  kinds: ["video"],
  resolverPriority: { video: 1 },
  commandsUnlocked: [
    "generate video -p seedance (Seedance 2.0 via fal.ai — default since v0.57)",
    "generate video -p seedance --seedance-model fast (lower-latency variant)",
    "generate video -p seedance -i <image> (image-to-video)",
  ],
});
