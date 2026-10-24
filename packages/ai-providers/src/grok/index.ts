export { GrokProvider, grokProvider, resolveGrokImageModel, resolveGrokVideoModel, type GrokModel, type GrokVideoModel, type GrokImageModel, type GrokImageQuality } from "./GrokProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "grok",
  label: "Grok",
  apiKey: "xai",
  kinds: ["image", "video"],
  resolverPriority: { image: 3, video: 2 },
  commandsUnlocked: [
    "generate image -p grok",
    "generate video -p grok",
    "edit image -p grok",
  ],
});
