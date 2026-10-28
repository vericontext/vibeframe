/**
 * ElevenLabs Scribe behind the transcription contract: the multipart request
 * it sends, how its flat token list becomes words and segments, and how
 * failures are classified. Runs against the fake provider network; nothing
 * leaves the process.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { createTranscriber } from "../transcription/registry.js";
import { scribeSegments, scribeWords, type ScribeToken } from "./ScribeTranscriber.js";

const wav = new Uint8Array(Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1"));

const word = (text: string, start: number, end: number, extra: Partial<ScribeToken> = {}): ScribeToken => ({
  text,
  type: "word",
  start,
  end,
  logprob: 0,
  ...extra,
});
const space = (start: number, end: number): ScribeToken => ({ text: " ", type: "spacing", start, end });

/** "Um, the boat drifts. (laughter) It floats," then a long pause, "okay?" */
const tokens: ScribeToken[] = [
  word("Um,", 0, 0.3, { speaker_id: "speaker_0" }),
  space(0.3, 0.35),
  word("the", 0.35, 0.5, { speaker_id: "speaker_0" }),
  space(0.5, 0.55),
  word("boat", 0.55, 0.9, { speaker_id: "speaker_0" }),
  space(0.9, 0.95),
  word("drifts.", 0.95, 1.4, { speaker_id: "speaker_0" }),
  space(1.4, 1.5),
  { text: "(laughter)", type: "audio_event", start: 1.5, end: 2.0, speaker_id: "speaker_0" },
  space(2.0, 2.1),
  word("It", 2.1, 2.3, { speaker_id: "speaker_1" }),
  space(2.3, 2.35),
  word("floats,", 2.35, 2.8, { speaker_id: "speaker_1" }),
  space(2.8, 4.0),
  word("okay?", 4.0, 4.4, { speaker_id: "speaker_1" }),
];

describe("scribeWords", () => {
  it("keeps timed words only, with Scribe's punctuation", () => {
    expect(scribeWords(tokens)).toEqual([
      { text: "Um,", start: 0, end: 0.3 },
      { text: "the", start: 0.35, end: 0.5 },
      { text: "boat", start: 0.55, end: 0.9 },
      { text: "drifts.", start: 0.95, end: 1.4 },
      { text: "It", start: 2.1, end: 2.3 },
      { text: "floats,", start: 2.35, end: 2.8 },
      { text: "okay?", start: 4.0, end: 4.4 },
    ]);
  });

  it("drops words the API returned without timing", () => {
    expect(scribeWords([word("a", 0, 1), { text: "b", type: "word", start: null, end: null }])).toEqual([
      { text: "a", start: 0, end: 1 },
    ]);
  });
});

describe("scribeSegments", () => {
  it("ends segments at sentence punctuation and long pauses, never including audio events", () => {
    const segments = scribeSegments(tokens);
    expect(segments.map(({ text, startTime, endTime, speaker }) => ({ text, startTime, endTime, speaker }))).toEqual([
      { text: "Um, the boat drifts.", startTime: 0, endTime: 1.4, speaker: "speaker_0" },
      { text: "It floats,", startTime: 2.1, endTime: 2.8, speaker: "speaker_1" },
      { text: "okay?", startTime: 4.0, endTime: 4.4, speaker: "speaker_1" },
    ]);
    expect(segments.map((s) => s.id)).toEqual(["segment-0", "segment-1", "segment-2"]);
  });

  it("starts a new segment when the speaker changes mid-sentence", () => {
    const segments = scribeSegments([
      word("so", 0, 0.2, { speaker_id: "speaker_0" }),
      space(0.2, 0.25),
      word("yes", 0.25, 0.5, { speaker_id: "speaker_1" }),
    ]);
    expect(segments.map((s) => [s.text, s.speaker])).toEqual([
      ["so", "speaker_0"],
      ["yes", "speaker_1"],
    ]);
  });

  it("splits run-on speech into caption-sized segments", () => {
    const run: ScribeToken[] = [];
    for (let i = 0; i < 40; i++) {
      run.push(word(i === 19 ? "word," : "word", i * 0.5, i * 0.5 + 0.4));
      run.push(space(i * 0.5 + 0.4, i * 0.5 + 0.5));
    }
    const segments = scribeSegments(run);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) expect(s.endTime - s.startTime).toBeLessThanOrEqual(12);
    // The clause comma past the soft limit ends the first segment.
    expect(segments[0].text.endsWith("word,")).toBe(true);
  });

  it("keeps languages written without spaces intact", () => {
    const segments = scribeSegments([word("こんにちは", 0, 0.6), word("世界。", 0.6, 1.0)]);
    expect(segments.map((s) => s.text)).toEqual(["こんにちは世界。"]);
  });

  it("turns log probabilities into a 0-1 confidence", () => {
    const [segment] = scribeSegments([word("hi.", 0, 0.3, { logprob: Math.log(0.5) })]);
    expect(segment.confidence).toBeCloseTo(0.5);
  });
});

describe("Scribe transcription contract", () => {
  let net: FakeProviderNetwork;
  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });
  afterEach(() => net.uninstall());

  const reply = { language_code: "eng", language_probability: 0.99, text: "Um, the boat drifts. It floats, okay?", words: tokens };

  it("sends a multipart request with the catalog model, word timestamps, and the xi-api-key header", async () => {
    net.on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () => jsonResponse(reply));
    const scribe = await createTranscriber("elevenlabs", "xi-test");

    const result = await scribe.transcribeAudio({ audio: wav, language: "en", granularity: "both" });

    const [request] = net.requests;
    expect(request.headers["xi-api-key"]).toBe("xi-test");
    expect(request.headers.authorization).toBeUndefined();
    const form = request.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("timestamps_granularity")).toBe("word");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("language_code")).toBe("en");
    expect(form.get("diarize")).toBeNull();
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);

    expect(result).toMatchObject({ text: reply.text, language: "eng", model: "scribe_v2" });
    expect(result.segments?.map((s) => s.text)).toEqual(["Um, the boat drifts.", "It floats,", "okay?"]);
    expect(result.words?.[0]).toEqual({ text: "Um,", start: 0, end: 0.3 });
  });

  it("returns only what the granularity asks for, and omits the language hint when there is none", async () => {
    net.on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () => jsonResponse(reply));
    const scribe = await createTranscriber("elevenlabs", "xi-test");

    const segmentsOnly = await scribe.transcribeAudio({ audio: wav });
    expect(segmentsOnly.segments).toHaveLength(3);
    expect(segmentsOnly.words).toBeUndefined();
    expect((net.requests[0].body as FormData).get("language_code")).toBeNull();

    const wordsOnly = await scribe.transcribeAudio({ audio: wav, granularity: "word" });
    expect(wordsOnly.segments).toBeUndefined();
    expect(wordsOnly.words).toHaveLength(7);
  });

  it("selects a catalog model by alias and refuses unknown models before sending", async () => {
    net.on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () => jsonResponse(reply));
    const scribe = await createTranscriber("elevenlabs", "xi-test");
    await scribe.transcribeAudio({ audio: wav, model: "scribe" });
    expect((net.requests[0].body as FormData).get("model_id")).toBe("scribe_v2");

    await expect(scribe.transcribeAudio({ audio: wav, model: "scribe_v1" })).rejects.toMatchObject({ kind: "invalid-request" });
    expect(net.requests).toHaveLength(1);
  });

  it("classifies a rejected key as auth", async () => {
    net.on("POST", "api.elevenlabs.io", /speech-to-text$/, () =>
      jsonResponse({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401)
    );
    const scribe = await createTranscriber("elevenlabs", "bad");
    await expect(scribe.transcribeAudio({ audio: wav })).rejects.toMatchObject({ kind: "auth", provider: "elevenlabs", status: 401 });
  });

  it("classifies exhausted credits as quota even though ElevenLabs sends 401", async () => {
    net.on("POST", "api.elevenlabs.io", /speech-to-text$/, () =>
      jsonResponse({ detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000." } }, 401)
    );
    const scribe = await createTranscriber("elevenlabs", "k");
    await expect(scribe.transcribeAudio({ audio: wav })).rejects.toMatchObject({ kind: "quota" });
  });

  it("retries a 429 and reports rate-limit once retries run out", async () => {
    net.on("POST", "api.elevenlabs.io", /speech-to-text$/, () =>
      jsonResponse({ detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests" } }, 429, { "retry-after": "0" })
    );
    const scribe = await createTranscriber("elevenlabs", "k");
    await expect(scribe.transcribeAudio({ audio: wav })).rejects.toMatchObject({ kind: "rate-limit" });
    expect(net.requests).toHaveLength(3);
  });

  it("classifies a too-large upload (413) and a validation failure (422) as invalid-request", async () => {
    const scribe = await createTranscriber("elevenlabs", "k");
    net.on("POST", "api.elevenlabs.io", /speech-to-text$/, () => jsonResponse({ detail: "File too large" }, 413));
    await expect(scribe.transcribeAudio({ audio: wav })).rejects.toMatchObject({ kind: "invalid-request", status: 413 });

    net.on("POST", "api.elevenlabs.io", /speech-to-text$/, () =>
      jsonResponse({ detail: [{ loc: ["body", "language_code"], msg: "invalid language", type: "value_error" }] }, 422)
    );
    await expect(scribe.transcribeAudio({ audio: wav, language: "xx" })).rejects.toMatchObject({ kind: "invalid-request", status: 422 });
  });
});
