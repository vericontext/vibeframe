/**
 * @module gemini/gemini-tts
 *
 * Gemini text-to-speech (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`,
 * GA 2026-09-22) on the same `GOOGLE_API_KEY` as the rest of Gemini.
 *
 * Request shape per https://ai.google.dev/gemini-api/docs/speech-generation
 * (checked 2026-10-28): `POST /v1beta/interactions` with typed `input`
 * (`user_input` -> `text`, delivery directions as a `speech_metadata.style`
 * annotation), `response_format: {type: "audio", mime_type, sample_rate}`,
 * and `generation_config.speech_config: [{voice}]`. The audio comes back
 * base64 in `steps[].content[]` (`type: "audio"`).
 *
 * Unary requests answer WAV (16-bit PCM, mono, 24 kHz) by default, but an
 * item can also be headerless `audio/l16`; both are decoded to PCM so long
 * narration, which is split to stay inside the 8,192-token input and
 * 16,384-token (about 11 min) output caps, joins into one WAV.
 */

import type { AICapability, AIProvider, ProviderConfig } from "../interface/types.js";
import type { SpeechGenerator, SpeechRequest, SpeechResult } from "../speech/contract.js";
import { splitSpeechText } from "../speech/split-text.js";
import { joinPcmAsWav, parsePcmMimeType, parseWav, type Pcm, type PcmFormat } from "../speech/wav.js";
import { ProviderError, classifyProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";
import { pcmSeconds } from "../usage/audio-duration.js";
import { recordUsage } from "../usage/meter.js";
import { resolveCatalogModel } from "../video/models.js";

const PROVIDER = "gemini";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/** The 30 prebuilt voices every Gemini TTS model takes (docs, 2026-10-28). */
export const GEMINI_TTS_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

/** The voice Google's speech guide uses in its examples. */
export const GEMINI_TTS_DEFAULT_VOICE = "Kore";

/**
 * Characters per request. The models take 8,192 input tokens and return at
 * most 16,384 audio tokens (25 per second, so about 11 minutes); 4,000
 * characters is about 4-5 minutes of speech, well inside both.
 */
export const GEMINI_TTS_MAX_CHUNK_CHARS = 4000;

/** What we ask for: the documented unary default. */
const OUTPUT: PcmFormat = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

/** Custom voices from `POST /v1beta/voices`: stored `voice_...` or stateless `voicekey_...`. */
const CUSTOM_VOICE = /^voice(key)?_[A-Za-z0-9_-]+$/;

/**
 * The voice to send: a prebuilt name in its canonical case, or a custom
 * voice ID as given. Anything else is refused before a request is made.
 */
export function resolveGeminiVoice(voice: string | undefined): string {
  if (voice === undefined) return GEMINI_TTS_DEFAULT_VOICE;
  const prebuilt = GEMINI_TTS_VOICES.find((name) => name.toLowerCase() === voice.trim().toLowerCase());
  if (prebuilt) return prebuilt;
  if (CUSTOM_VOICE.test(voice)) return voice;
  throw new ProviderError({
    kind: "invalid-request",
    provider: PROVIDER,
    message: `Unknown Gemini voice "${voice}". Available voices: ${GEMINI_TTS_VOICES.join(", ")} (or a custom voice_... / voicekey_... ID).`,
  });
}

/**
 * Delivery directions for `speech_metadata.style`. Gemini has no numeric
 * speed; the guide steers pace with words like "speaking slowly".
 */
export function geminiSpeechStyle(request: Pick<SpeechRequest, "instructions" | "speed">): string | undefined {
  const { speed } = request;
  const pace =
    speed === undefined || (speed >= 0.95 && speed <= 1.05)
      ? undefined
      : speed > 1.05
        ? speed >= 1.3 ? "speaking rapidly" : "speaking a little faster than usual"
        : speed <= 0.75 ? "speaking slowly" : "speaking a little slower than usual";
  const parts = [request.instructions?.trim(), pace].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("; ") : undefined;
}

interface AudioItem {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
  sample_rate?: number;
  channels?: number;
}

interface InteractionResponse {
  status?: string;
  steps?: Array<{ type?: string; content?: AudioItem[] }>;
  output_audio?: AudioItem;
  finish_reason?: string;
  error?: { code?: number | string; message?: string; status?: string };
}

/** The last audio item in a REST interaction (the jq path the guide gives). */
export function findGeminiAudio(response: InteractionResponse): AudioItem | undefined {
  const items = (response.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((item) => item.type === "audio" && item.data);
  return items.at(-1) ?? (response.output_audio?.data ? response.output_audio : undefined);
}

/** Decode one audio item to PCM: WAV by its header, L16 by its MIME parameters. */
export function decodeGeminiAudio(item: AudioItem): Pcm {
  const bytes = new Uint8Array(Buffer.from(item.data ?? "", "base64"));
  const wav = parseWav(bytes);
  if (wav) {
    if (wav.bitsPerSample !== 16) {
      throw new ProviderError({ kind: "provider", provider: PROVIDER, message: `Gemini TTS returned ${wav.bitsPerSample}-bit WAV; expected 16-bit PCM.` });
    }
    return wav;
  }
  const fallback = { ...OUTPUT, sampleRate: item.sample_rate ?? OUTPUT.sampleRate, channels: item.channels ?? OUTPUT.channels };
  const pcm = parsePcmMimeType(item.mime_type ?? "", fallback);
  if (!pcm) {
    throw new ProviderError({
      kind: "provider",
      provider: PROVIDER,
      message: `Gemini TTS returned audio VibeFrame cannot read (${item.mime_type ?? "no mime_type"}); expected WAV or L16 PCM.`,
    });
  }
  return { ...pcm, data: bytes };
}

export class GeminiTtsProvider implements AIProvider, SpeechGenerator {
  id = "gemini";
  readonly speechProvider = PROVIDER;
  name = "Gemini TTS";
  description = "Gemini cloud text-to-speech (gemini-3.8-flash-tts)";
  capabilities: AICapability[] = ["text-to-speech"];
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = API_ROOT;

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) this.baseUrl = config.baseUrl;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ── SpeechGenerator ───────────────────────────────────────────────────

  async synthesize(request: SpeechRequest): Promise<SpeechResult> {
    if (!this.apiKey) {
      throw new ProviderError({ kind: "auth", provider: PROVIDER, message: "Google API key not configured" });
    }
    if (!request.text.trim()) {
      throw new ProviderError({ kind: "invalid-request", provider: PROVIDER, message: "Empty text" });
    }
    const model = resolveCatalogModel(PROVIDER, "speech", request.model).id;
    const voice = resolveGeminiVoice(request.voice);
    const style = geminiSpeechStyle(request);

    const blocks: Pcm[] = [];
    for (const chunk of splitSpeechText(request.text, GEMINI_TTS_MAX_CHUNK_CHARS)) {
      blocks.push(await this.speak(this.apiKey, model, voice, chunk, style));
    }
    let bytes: Uint8Array;
    try {
      bytes = joinPcmAsWav(blocks);
    } catch (error) {
      throw new ProviderError({ kind: "provider", provider: PROVIDER, message: error instanceof Error ? error.message : String(error) });
    }
    return { bytes, mimeType: "audio/wav", extension: "wav", model, characters: request.text.length };
  }

  private async speak(apiKey: string, model: string, voice: string, text: string, style: string | undefined): Promise<Pcm> {
    const response = await providerRequest(
      PROVIDER,
      `${this.baseUrl}/interactions`,
      {
        method: "POST",
        // The key goes in a header so it never lands in a URL, log, or error message.
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          model,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
                },
              ],
            },
          ],
          response_format: { type: "audio", mime_type: "audio/wav", sample_rate: OUTPUT.sampleRate },
          generation_config: { speech_config: [{ voice }] },
          store: false,
        }),
      },
      { timeoutMs: 5 * 60_000 },
    );
    const interaction = (await response.json()) as InteractionResponse;

    if (interaction.status === "failed") {
      const error = interaction.error;
      throw classifyProviderError({
        provider: PROVIDER,
        code: error?.status ?? (error?.code !== undefined ? String(error.code) : undefined),
        message: error?.message ?? `${model} failed to synthesize speech.`,
      });
    }
    const audio = findGeminiAudio(interaction);
    if (!audio) {
      const reason = interaction.finish_reason;
      // A blocked or cut-off interaction ends `incomplete` with a reason.
      const cutOff = /max|token|length/i.test(reason ?? "");
      throw new ProviderError({
        kind: cutOff ? "invalid-request" : interaction.status === "incomplete" || reason ? "moderation" : "provider",
        provider: PROVIDER,
        message: cutOff
          ? `${model} stopped before finishing the audio (${reason}).`
          : interaction.status === "incomplete" || reason
            ? `${model} returned no audio (${[interaction.status, reason].filter(Boolean).join(", ")}); the text may have been blocked.`
            : `${model} returned no audio${interaction.status ? ` (status: ${interaction.status})` : ""}.`,
      });
    }
    const pcm = decodeGeminiAudio(audio);
    // Billed per second of audio out (25 tokens/s), so the length of the
    // returned PCM is the billed amount. Input text tokens ($0.50 per 1M,
    // under 0.5% of a request) are not counted.
    recordUsage({ provider: PROVIDER, kind: "speech", model, amount: { unit: "seconds", count: pcmSeconds(pcm) } });
    return pcm;
  }
}

export const geminiTtsProvider = new GeminiTtsProvider();
