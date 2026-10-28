export {
  ELEVENLABS_MUSIC_MODEL,
  ElevenLabsProvider,
  elevenLabsProvider,
  KNOWN_VOICES,
  resolveVoiceId,
  type Voice,
  type TTSOptions,
  type MusicOptions,
  type MusicResult,
  type SoundEffectOptions,
  type SoundEffectResult,
  type AudioIsolationResult,
  type VoiceCloneOptions,
  type VoiceCloneResult,
} from "./ElevenLabsProvider.js";
export { ScribeTranscriber, scribeSegments, scribeWords, type ScribeToken } from "./ScribeTranscriber.js";

import { defineProvider } from "../define-provider.js";

defineProvider({
  id: "elevenlabs",
  label: "ElevenLabs",
  apiKey: "elevenlabs",
  kinds: ["speech", "music", "transcription"],
  resolverPriority: { speech: 1, transcription: 1 },
  commandsUnlocked: [
    "generate narration",
    "generate sound-effect",
    "generate music",
    "audio list-voices",
    "audio clone-voice",
    "audio dub",
    "audio transcribe",
    "edit caption",
    "edit jump-cut",
  ],
});
