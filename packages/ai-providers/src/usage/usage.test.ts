import { describe, expect, it } from "vitest";

import { findModel } from "../catalog/catalog.js";
import { pcmToWav } from "../speech/wav.js";
import { audioSeconds, mp3Seconds, recordTranscriptionUsage } from "./audio-duration.js";
import { meterUsage, meterUsageSettled, recordTokenUsage, recordUsage, takeUsageSince, type UsageRecord } from "./meter.js";
import { priceRecord, priceUsage } from "./price.js";

const NOV_2026 = new Date("2026-11-15T12:00:00Z");
const FEB_2027 = new Date("2027-02-01T12:00:00Z");

function record(partial: Omit<UsageRecord, "at">): UsageRecord {
  return { ...partial, at: 0 };
}

describe("priceRecord", () => {
  it("prices LLM tokens at the input and output rates", () => {
    // Claude Sonnet 5.5: $2 in / $10 out per 1M.
    const usd = priceRecord(
      record({ provider: "claude", kind: "llm", model: "claude-sonnet-5-5", amount: { unit: "tokens", input: 10_000, output: 2_000 } }),
      NOV_2026,
    );
    expect(usd).toBeCloseTo((10_000 * 2 + 2_000 * 10) / 1_000_000, 12);
  });

  it("switches to a dated price once the intro price ends", () => {
    const flash = record({ provider: "gemini", kind: "llm", model: "gemini-3.8-flash", amount: { unit: "tokens", input: 1_000_000, output: 1_000_000 } });
    expect(priceRecord(flash, NOV_2026)).toBeCloseTo(0.75 + 3.75, 10);
    expect(priceRecord(flash, new Date("2026-12-31T23:59:59Z"))).toBeCloseTo(0.75 + 3.75, 10);
    expect(priceRecord(flash, FEB_2027)).toBeCloseTo(1.5 + 7.5, 10);
  });

  it("uses the long-context rates above the prompt threshold, and refuses an unlisted tier", () => {
    const haiku = (input: number) =>
      record({ provider: "claude", kind: "llm", model: "claude-haiku-5-5", amount: { unit: "tokens", input, output: 1_000 } });
    expect(priceRecord(haiku(100_000), NOV_2026)).toBeCloseTo((100_000 * 0.1 + 1_000 * 0.5) / 1e6, 12);
    expect(priceRecord(haiku(100_001), NOV_2026)).toBeCloseTo((100_001 * 0.5 + 1_000 * 2.5) / 1e6, 12);
    const pro = record({ provider: "gemini", kind: "llm", model: "gemini-3.1-pro-preview", amount: { unit: "tokens", input: 250_000, output: 10 } });
    expect(priceRecord(pro, NOV_2026)).toBeUndefined();
  });

  it("prices TTS characters per 1K", () => {
    const usd = priceRecord(record({ provider: "elevenlabs", kind: "speech", model: "eleven_v3", amount: { unit: "characters", count: 1_500 } }));
    expect(usd).toBeCloseTo(1.5 * 0.08, 12);
    const kokoro = priceRecord(record({ provider: "kokoro", kind: "speech", model: "onnx-community/Kokoro-82M-v1.0-ONNX", amount: { unit: "characters", count: 900 } }));
    expect(kokoro).toBe(0);
  });

  it("prices audio seconds per second, minute, and hour", () => {
    const tts = record({ provider: "gemini", kind: "speech", model: "gemini-3.8-flash-tts", amount: { unit: "seconds", count: 90 } });
    expect(priceRecord(tts, NOV_2026)).toBeCloseTo(1.5 * 0.0135, 12);
    expect(priceRecord(tts, FEB_2027)).toBeCloseTo(1.5 * 0.027, 12);
    const scribe = record({ provider: "elevenlabs", kind: "transcription", model: "scribe_v2", amount: { unit: "seconds", count: 1_800 } });
    expect(priceRecord(scribe)).toBeCloseTo(0.5 * 0.22, 12);
    const music = record({ provider: "elevenlabs", kind: "music", model: "music_v2_5", amount: { unit: "seconds", count: 30 } });
    expect(priceRecord(music)).toBeCloseTo(0.5 * 0.15, 12);
    const whisper = record({ provider: "openai", kind: "transcription", model: "whisper-1", amount: { unit: "seconds", count: 120 } });
    expect(priceRecord(whisper)).toBeCloseTo(2 * 0.006, 12);
  });

  it("leaves unknown models, unlisted prices, and unit mismatches unpriced", () => {
    expect(priceRecord(record({ provider: "openai", kind: "speech", model: "gpt-4o-mini-tts", amount: { unit: "characters", count: 10 } }))).toBeUndefined();
    expect(priceRecord(record({ provider: "claude", kind: "llm", model: "claude-opus-4-7", amount: { unit: "tokens", input: 1, output: 1 } }))).toBeUndefined();
    expect(priceRecord(record({ provider: "elevenlabs", kind: "audio-isolation", model: "audio-isolation", amount: { unit: "requests", count: 1 } }))).toBeUndefined();
    expect(priceRecord(record({ provider: "elevenlabs", kind: "speech", model: "eleven_v3", amount: { unit: "seconds", count: 5 } }))).toBeUndefined();
  });

  it("resolves catalog aliases as well as IDs", () => {
    expect(findModel("claude", "llm", "sonnet")?.id).toBe("claude-sonnet-5-5");
    const usd = priceRecord(record({ provider: "claude", kind: "llm", model: "sonnet", amount: { unit: "tokens", input: 1_000_000, output: 0 } }));
    expect(usd).toBe(2);
  });
});

describe("priceUsage", () => {
  it("sums priced records, rounds to a millionth, and returns the unpriced ones", () => {
    const records = [
      record({ provider: "elevenlabs", kind: "speech", model: "eleven_v3", amount: { unit: "characters", count: 21 } }),
      record({ provider: "openai", kind: "llm", model: "gpt-5.4-mini", amount: { unit: "tokens", input: 333, output: 77 } }),
      record({ provider: "elevenlabs", kind: "audio-isolation", model: "audio-isolation", amount: { unit: "requests", count: 1 } }),
    ];
    const cost = priceUsage(records, NOV_2026);
    expect(cost.costUsd).toBe(Number((0.021 * 0.08 + (333 * 0.75 + 77 * 4.5) / 1e6).toFixed(6)));
    expect(cost.unpriced).toEqual([records[2]]);
    expect(cost.estimated).toBe(false);
  });

  it("flags a priced record whose amount was inferred", () => {
    const cost = priceUsage([
      record({ provider: "elevenlabs", kind: "transcription", model: "scribe_v2", amount: { unit: "seconds", count: 36 }, estimated: true }),
    ]);
    expect(cost).toMatchObject({ costUsd: Number((0.01 * 0.22).toFixed(6)), estimated: true, unpriced: [] });
  });
});

describe("usage meter", () => {
  const speech = (count: number) => ({ provider: "elevenlabs", kind: "speech" as const, model: "eleven_v3", amount: { unit: "characters" as const, count } });

  it("collects records inside a meter and keeps concurrent meters apart", async () => {
    const [a, b] = await Promise.all([
      meterUsage(async () => {
        recordUsage(speech(1));
        await new Promise((r) => setTimeout(r, 5));
        recordUsage(speech(2));
      }),
      meterUsage(async () => {
        await new Promise((r) => setTimeout(r, 1));
        recordUsage(speech(3));
      }),
    ]);
    expect(a.usage.map((r) => r.amount)).toEqual([speech(1).amount, speech(2).amount]);
    expect(b.usage.map((r) => r.amount)).toEqual([speech(3).amount]);
  });

  it("passes inner records up to the outer meter", async () => {
    const outer = await meterUsage(async () => {
      recordUsage(speech(1));
      const inner = await meterUsage(async () => recordUsage(speech(2)));
      expect(inner.usage).toHaveLength(1);
    });
    expect(outer.usage).toHaveLength(2);
  });

  it("keeps the usage of a call that failed after billing", async () => {
    const settled = await meterUsageSettled(async () => {
      recordTokenUsage("claude", "claude-sonnet-5-5", 10, 5);
      throw new Error("refused");
    });
    expect("error" in settled).toBe(true);
    expect(settled.usage).toHaveLength(1);
  });

  it("skips token usage when the provider reported none", async () => {
    const { usage } = await meterUsage(async () => recordTokenUsage("claude", "claude-sonnet-5-5", undefined, undefined));
    expect(usage).toEqual([]);
  });

  it("takes from the process ledger since a start time outside any meter, once", async () => {
    takeUsageSince(0);
    await new Promise((r) => setTimeout(r, 2));
    const startedAt = Date.now();
    recordUsage(speech(42));
    expect(takeUsageSince(startedAt).map((r) => r.amount)).toEqual([{ unit: "characters", count: 42 }]);
    // A later command starting in the same millisecond does not count it again.
    expect(takeUsageSince(startedAt)).toEqual([]);
  });

  it("only reads an open meter, which its owner reports from", async () => {
    const { usage } = await meterUsage(async () => {
      recordUsage(speech(7));
      expect(takeUsageSince(0)).toHaveLength(1);
      expect(takeUsageSince(0)).toHaveLength(1);
    });
    expect(usage).toHaveLength(1);
  });
});

describe("audio duration", () => {
  it("reads WAV length from its header", () => {
    const wav = pcmToWav({ sampleRate: 24_000, channels: 1, bitsPerSample: 16, data: new Uint8Array(48_000) });
    expect(audioSeconds(wav)).toBe(1);
  });

  it("reads a CBR MP3 length from its first frame bitrate", () => {
    // MPEG-1 Layer III, 128 kbps (index 9), 44.1 kHz, after a 10-byte empty ID3v2 tag.
    const frame = new Uint8Array(16_000);
    frame.set([0xff, 0xfb, 0x90, 0x64]);
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...frame]);
    expect(mp3Seconds(mp3)).toBe(1);
  });

  it("does not hunt for sync bytes in other containers", () => {
    const m4a = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0xff, 0xfb, 0x90, 0x64]);
    expect(audioSeconds(m4a)).toBeUndefined();
  });

  it("records a transcription by reported, measured, then inferred length", async () => {
    const wav = pcmToWav({ sampleRate: 16_000, channels: 1, bitsPerSample: 16, data: new Uint8Array(64_000) });
    const unknown = new Uint8Array([1, 2, 3]);
    const { usage } = await meterUsage(async () => {
      recordTranscriptionUsage({ provider: "elevenlabs", model: "scribe_v2", reportedSeconds: 12.5, audio: wav });
      recordTranscriptionUsage({ provider: "elevenlabs", model: "scribe_v2", audio: wav, lastTimestamp: 1 });
      recordTranscriptionUsage({ provider: "elevenlabs", model: "scribe_v2", audio: unknown, lastTimestamp: 3.7 });
      recordTranscriptionUsage({ provider: "elevenlabs", model: "scribe_v2", audio: unknown });
    });
    expect(usage.map((r) => [r.amount, r.estimated ?? false])).toEqual([
      [{ unit: "seconds", count: 12.5 }, false],
      [{ unit: "seconds", count: 2 }, false],
      [{ unit: "seconds", count: 3.7 }, true],
      [{ unit: "requests", count: 1 }, false],
    ]);
  });
});
