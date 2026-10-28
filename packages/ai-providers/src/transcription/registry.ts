/** One way to get a transcription provider by its catalog id. */

import { ScribeTranscriber } from "../elevenlabs/ScribeTranscriber.js";
import { ProviderError } from "../shared/errors.js";
import { WhisperProvider } from "../whisper/WhisperProvider.js";
import type { Transcriber } from "./contract.js";

/** Transcription providers, in `--stt auto` order (the registry's resolver priority). */
export const TRANSCRIBER_PROVIDERS = ["elevenlabs", "openai"] as const;
export type TranscriberProvider = (typeof TRANSCRIBER_PROVIDERS)[number];

/** A ready transcriber for `provider`: ElevenLabs Scribe or OpenAI Whisper. */
export async function createTranscriber(provider: string, apiKey: string): Promise<Transcriber> {
  if (provider === "elevenlabs") {
    const scribe = new ScribeTranscriber();
    await scribe.initialize({ apiKey });
    return scribe;
  }
  if (provider === "openai") {
    const whisper = new WhisperProvider();
    await whisper.initialize({ apiKey });
    return whisper;
  }
  throw new ProviderError({
    kind: "invalid-request",
    provider,
    message: `Unknown transcription provider "${provider}". Available: ${TRANSCRIBER_PROVIDERS.join(", ")}.`,
  });
}
