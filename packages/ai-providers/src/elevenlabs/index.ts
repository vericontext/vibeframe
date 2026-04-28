export {
  ElevenLabsProvider,
  elevenLabsProvider,
  KNOWN_VOICES,
  resolveVoiceId,
  type Voice,
  type TTSOptions,
  type TTSResult,
  type MusicOptions,
  type MusicResult,
  type SoundEffectOptions,
  type SoundEffectResult,
  type AudioIsolationResult,
  type VoiceCloneOptions,
  type VoiceCloneResult,
} from "./ElevenLabsProvider.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "elevenlabs",
  label: "ElevenLabs",
  apiKey: "elevenlabs",
  kinds: ["speech", "music"],
  resolverPriority: { speech: 1 },
  commandsUnlocked: [
    "generate speech",
    "generate sound-effect",
    "generate music",
    "audio voices",
    "audio voice-clone",
    "audio dub",
  ],
});
