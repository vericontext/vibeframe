export {
  ClaudeProvider,
  claudeProvider,
  type MotionOptions,
  type RemotionComponent,
  type StoryboardSegment,
} from "./ClaudeProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "claude",
  label: "Claude (Anthropic)",
  apiKey: "anthropic",
  kinds: ["llm"],
  commandsUnlocked: [
    "generate motion",
    "edit grade --style",
    "edit reframe --focus auto",
    "edit speed-ramp",
  ],
});
