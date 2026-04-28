export {
  ClaudeProvider,
  claudeProvider,
  type MotionOptions,
  type MotionResult,
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
    "agent -p claude",
    "generate storyboard",
    "generate motion",
    "edit grade",
    "edit reframe",
    "edit speed-ramp",
    "pipeline script-to-video",
  ],
});
