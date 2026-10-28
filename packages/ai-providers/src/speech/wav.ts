/**
 * 16-bit PCM WAV helpers for speech providers that answer in raw PCM or in
 * WAV pieces that have to be joined (Gemini TTS).
 */

/** The shape of a block of signed little-endian PCM samples. */
export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

export interface Pcm extends PcmFormat {
  /** Interleaved little-endian samples, no header. */
  data: Uint8Array;
}

/** Wrap headerless little-endian PCM in a 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Pcm): Uint8Array {
  const { data, sampleRate, channels, bitsPerSample } = pcm;
  const blockAlign = channels * (bitsPerSample / 8);
  const wav = new Uint8Array(44 + data.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // integer PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, data.length, true);
  wav.set(data, 44);
  return wav;
}

/**
 * Read the PCM samples and format out of a WAV file. Walks the RIFF chunks
 * instead of assuming a 44-byte header, and tolerates the placeholder sizes
 * (0 or 0xFFFFFFFF) streaming encoders write. Returns undefined when the
 * bytes are not integer-PCM WAV.
 */
export function parseWav(bytes: Uint8Array): Pcm | undefined {
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || text(0) !== "RIFF" || text(8) !== "WAVE") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: PcmFormat | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = text(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (body + 16 > bytes.length || view.getUint16(body, true) !== 1) return undefined;
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!format) return undefined;
      const end = size === 0 || size === 0xffffffff ? bytes.length : Math.min(body + size, bytes.length);
      return { ...format, data: bytes.subarray(body, end) };
    }
    offset = body + size + (size % 2);
  }
  return undefined;
}

/**
 * Parse an `audio/L16;codec=pcm;rate=24000` style MIME type. Returns the
 * format when it names headerless 16-bit PCM, with `fallback` filling the
 * parameters the type leaves out.
 */
export function parsePcmMimeType(mimeType: string, fallback: PcmFormat): PcmFormat | undefined {
  const [type, ...params] = mimeType.toLowerCase().split(";").map((part) => part.trim());
  if (type !== "audio/l16" && type !== "audio/pcm") return undefined;
  const param = (name: string) => {
    const value = params.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);
    const n = value === undefined ? NaN : Number(value);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    sampleRate: param("rate") ?? fallback.sampleRate,
    channels: param("channels") ?? fallback.channels,
    bitsPerSample: 16,
  };
}

/** Join PCM blocks of one format into a single WAV file. */
export function joinPcmAsWav(blocks: readonly Pcm[]): Uint8Array {
  const [first] = blocks;
  if (!first) throw new Error("No audio to join");
  for (const block of blocks) {
    if (block.sampleRate !== first.sampleRate || block.channels !== first.channels || block.bitsPerSample !== first.bitsPerSample) {
      throw new Error(
        `Audio pieces differ in format (${first.sampleRate} Hz/${first.channels} ch/${first.bitsPerSample} bit vs ${block.sampleRate} Hz/${block.channels} ch/${block.bitsPerSample} bit)`
      );
    }
  }
  const data = new Uint8Array(blocks.reduce((n, block) => n + block.data.length, 0));
  let offset = 0;
  for (const block of blocks) {
    data.set(block.data, offset);
    offset += block.data.length;
  }
  return pcmToWav({ ...first, data });
}
