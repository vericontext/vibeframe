import { describe, expect, it } from "vitest";

import { FAKE_PCM, FAKE_WAV } from "../testing/fake-provider-network.js";
import { joinPcmAsWav, parsePcmMimeType, parseWav, pcmToWav } from "./wav.js";

const MONO_24K = { sampleRate: 24000, channels: 1, bitsPerSample: 16 };

describe("pcmToWav", () => {
  it("writes a standard 44-byte PCM header", () => {
    const wav = Buffer.from(pcmToWav({ ...MONO_24K, data: new Uint8Array(FAKE_PCM) }));
    expect(wav).toEqual(FAKE_WAV);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + FAKE_PCM.length);
    expect(wav.readUInt16LE(20)).toBe(1); // integer PCM
    expect(wav.readUInt32LE(28)).toBe(48000); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
  });

  it("takes the rate and channel count it is given", () => {
    const wav = Buffer.from(pcmToWav({ sampleRate: 16000, channels: 2, bitsPerSample: 16, data: new Uint8Array(8) }));
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(64000);
    expect(wav.readUInt16LE(32)).toBe(4);
  });
});

describe("parseWav", () => {
  it("round-trips pcmToWav", () => {
    const parsed = parseWav(new Uint8Array(FAKE_WAV))!;
    expect(parsed).toMatchObject(MONO_24K);
    expect(Buffer.from(parsed.data)).toEqual(FAKE_PCM);
  });

  it("skips chunks before data and tolerates a streaming placeholder size", () => {
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([3, 0, 0, 0]), Buffer.from("abc"), Buffer.alloc(1)]);
    const header = FAKE_WAV.subarray(0, 36);
    const data = Buffer.concat([Buffer.from("data"), Buffer.from([0xff, 0xff, 0xff, 0xff]), FAKE_PCM]);
    const parsed = parseWav(new Uint8Array(Buffer.concat([header, list, data])))!;
    expect(Buffer.from(parsed.data)).toEqual(FAKE_PCM);
  });

  it("refuses bytes that are not integer-PCM WAV", () => {
    expect(parseWav(new Uint8Array(Buffer.from("ID3 not a wav file")))).toBeUndefined();
    const float = Buffer.from(FAKE_WAV);
    float.writeUInt16LE(3, 20);
    expect(parseWav(new Uint8Array(float))).toBeUndefined();
  });
});

describe("parsePcmMimeType", () => {
  it("reads the rate and channels Gemini puts in the type", () => {
    expect(parsePcmMimeType("audio/L16;codec=pcm;rate=24000", { ...MONO_24K, sampleRate: 8000 })).toEqual(MONO_24K);
    expect(parsePcmMimeType("audio/l16; rate=16000; channels=2", MONO_24K)).toEqual({ sampleRate: 16000, channels: 2, bitsPerSample: 16 });
  });

  it("falls back for missing parameters and refuses other types", () => {
    expect(parsePcmMimeType("audio/pcm", MONO_24K)).toEqual(MONO_24K);
    expect(parsePcmMimeType("audio/wav", MONO_24K)).toBeUndefined();
    expect(parsePcmMimeType("audio/mpeg", MONO_24K)).toBeUndefined();
  });
});

describe("joinPcmAsWav", () => {
  it("concatenates samples under one header", () => {
    const block = { ...MONO_24K, data: new Uint8Array(FAKE_PCM) };
    const joined = parseWav(joinPcmAsWav([block, block]))!;
    expect(Buffer.from(joined.data)).toEqual(Buffer.concat([FAKE_PCM, FAKE_PCM]));
  });

  it("refuses pieces in different formats", () => {
    expect(() =>
      joinPcmAsWav([
        { ...MONO_24K, data: new Uint8Array(2) },
        { ...MONO_24K, sampleRate: 16000, data: new Uint8Array(2) },
      ])
    ).toThrow(/differ in format/);
  });
});
