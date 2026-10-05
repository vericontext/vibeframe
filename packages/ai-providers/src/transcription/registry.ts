/** One way to get a transcription provider by its catalog id. */

import { ProviderError } from "../shared/errors.js";
import { WhisperProvider } from "../whisper/WhisperProvider.js";
import type { Transcriber } from "./contract.js";

export const TRANSCRIBER_PROVIDERS = ["openai"] as const;

/** A ready transcriber for `provider` (today: OpenAI Whisper). */
export async function createTranscriber(provider: string, apiKey: string): Promise<Transcriber> {
  if (provider !== "openai") {
    throw new ProviderError({
      kind: "invalid-request",
      provider,
      message: `Unknown transcription provider "${provider}". Available: ${TRANSCRIBER_PROVIDERS.join(", ")}.`,
    });
  }
  const whisper = new WhisperProvider();
  await whisper.initialize({ apiKey });
  return whisper;
}
