/** The transcription-provider argument shared by every tool that transcribes. */

import { z } from "zod";
import { STT_OPTION_HELP, STT_PROVIDER_NAMES } from "../../commands/_shared/transcription.js";

/** `stt` (or `provider` on audio_transcribe): matches the CLI's `--stt`. */
export const sttSchema = z.enum(STT_PROVIDER_NAMES).optional().describe(STT_OPTION_HELP);

/** Key requirement line for tool descriptions. */
export const STT_KEYS_TEXT = "Transcription uses ELEVENLABS_API_KEY (Scribe) or OPENAI_API_KEY (Whisper)";
