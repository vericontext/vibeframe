export * from "./FalProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "seedance",
  label: "Seedance 2.0",
  displayName: "Seedance 2.0",
  gateway: "fal.ai",
  // `fal` is a deprecated v0.x alias kept so existing scripts keep working.
  // Review this alias at the 1.0 cut.
  aliases: ["fal"],
  models: ["seedance-2.0", "seedance-2.0-fast"],
  capabilities: ["text-to-video", "image-to-video", "reference-to-video", "native-audio"],
  apiKey: "fal",
  kinds: ["video"],
  resolverPriority: { video: 1 },
  commandsUnlocked: [
    "generate video -p seedance (Seedance 2.0 via fal.ai — default since v0.57)",
    "generate video -p seedance --seedance-model fast (lower-latency variant)",
    "generate video -p seedance -i <image> (image-to-video)",
    "generate video -p seedance --ref-images <images...> (reference-to-video)",
  ],
});
