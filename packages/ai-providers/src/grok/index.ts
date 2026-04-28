export { GrokProvider, grokProvider, type GrokModel, type GrokVideoOptions, type GrokImageOptions, type GrokEditOptions } from "./GrokProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "grok",
  label: "Grok",
  apiKey: "xai",
  kinds: ["image", "video", "llm"],
  resolverPriority: { image: 3, video: 2 },
  commandsUnlocked: [
    "agent -p xai",
    "generate image -p grok",
    "generate video -p grok",
    "edit image -p grok",
  ],
});
