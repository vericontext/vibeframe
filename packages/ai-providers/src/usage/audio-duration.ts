/**
 * Audio length from the bytes alone, for billing calls whose provider does
 * not report a duration: WAV from its header, MP3 from its frame bitrate.
 */

import { parseWav, type Pcm } from "../speech/wav.js";
import { recordUsage } from "./meter.js";

/** Seconds of headerless PCM. */
export function pcmSeconds(pcm: Pcm): number {
  const bytesPerSecond = pcm.sampleRate * pcm.channels * (pcm.bitsPerSample / 8);
  return bytesPerSecond > 0 ? pcm.data.length / bytesPerSecond : 0;
}

// MPEG-1 and MPEG-2/2.5 Layer III bitrates in kbps, by the header's 4-bit index.
const MPEG1_L3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/** Offset of the first byte after an ID3v2 tag, or 0. */
function id3End(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size;
}

/**
 * Seconds of a constant-bitrate MP3 (what ElevenLabs returns by default:
 * 44.1 kHz, 128 kbps), from the first frame's bitrate and the byte length.
 * The first frame must start right after any ID3v2 tag; other containers
 * (M4A, OGG) are never scanned for sync bytes, which their compressed data
 * can contain. Undefined when there is no Layer III frame header there.
 */
export function mp3Seconds(bytes: Uint8Array): number | undefined {
  const i = id3End(bytes);
  if (i + 4 > bytes.length || bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) return undefined;
  const version = (bytes[i + 1] >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (bytes[i + 1] >> 1) & 0x03; // 1 = Layer III
  const bitrateIndex = bytes[i + 2] >> 4;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15) return undefined;
  const kbps = (version === 3 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[bitrateIndex];
  return ((bytes.length - i) * 8) / (kbps * 1000);
}

/** Seconds of a WAV or MP3 file, or undefined for other containers. */
export function audioSeconds(bytes: Uint8Array): number | undefined {
  const wav = parseWav(bytes);
  if (wav) return pcmSeconds(wav);
  return mp3Seconds(bytes);
}

/**
 * Record one transcription call, billed by audio length: the duration the
 * provider reported, else the length measured from the uploaded WAV or MP3,
 * else the last timestamp in the transcript (marked estimated, since
 * trailing silence is billed too).
 */
export function recordTranscriptionUsage(input: {
  provider: string;
  model: string;
  reportedSeconds?: number;
  audio: Uint8Array;
  lastTimestamp?: number;
}): void {
  const reported = typeof input.reportedSeconds === "number" && input.reportedSeconds > 0 ? input.reportedSeconds : undefined;
  const seconds = reported ?? audioSeconds(input.audio);
  const record = { provider: input.provider, kind: "transcription" as const, model: input.model };
  if (seconds !== undefined) {
    recordUsage({ ...record, amount: { unit: "seconds", count: seconds } });
  } else if (input.lastTimestamp !== undefined) {
    recordUsage({ ...record, amount: { unit: "seconds", count: input.lastTimestamp }, estimated: true });
  } else {
    recordUsage({ ...record, amount: { unit: "requests", count: 1 } });
  }
}
