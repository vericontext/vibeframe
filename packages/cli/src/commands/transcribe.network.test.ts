/**
 * Transcription through the real request path: the MCP `audio_transcribe`
 * tool and the jump-cut word transcription run the real provider classes
 * against the fake provider network. Scribe and Whisper must leave the same
 * files and the same word data behind.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FAKE_SCRIBE_TRANSCRIPT,
  createFakeProviderNetwork,
  type FakeProviderNetwork,
} from "../testing/fake-provider-network.js";
import { manifest } from "../tools/manifest/index.js";
import { DEFAULT_FILLER_WORDS, detectFillerRanges, transcribeWithWords } from "./_shared/edit/jump-cut.js";
import { resolveSttProvider } from "./_shared/transcription.js";

let net: FakeProviderNetwork;
let dir: string;
let audio: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-transcribe-net-"));
  audio = join(dir, "talk.wav");
  writeFileSync(audio, Buffer.from("RIFF\0\0\0\0WAVEfmt fake-pcm", "latin1"));
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

async function runTool(name: string, args: Record<string, unknown>) {
  const tool = manifest.find((entry) => entry.name === name)!;
  return tool.execute(tool.schema.parse(args), { workingDirectory: dir, surface: "mcp" });
}

describe("audio_transcribe", () => {
  it("auto picks Scribe when both keys are set and writes the SRT from its words", async () => {
    Object.assign(process.env, { ELEVENLABS_API_KEY: "test-elevenlabs", OPENAI_API_KEY: "test-openai" });
    const output = join(dir, "scribe.srt");

    const result = await runTool("audio_transcribe", { audioPath: audio, output });

    expect(result).toMatchObject({ success: true, data: { provider: "elevenlabs", segmentCount: 2, detectedLanguage: "eng", outputPath: output } });
    expect(net.requests.map((r) => `${r.host}${r.path}`)).toEqual(["api.elevenlabs.io/v1/speech-to-text"]);
    const [request] = net.requests;
    expect(request.headers["xi-api-key"]).toBe("test-elevenlabs");
    const form = request.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect((form.get("file") as File).name).toBe("talk.wav");
    expect(readFileSync(output, "utf-8")).toBe(
      "1\n00:00:00,000 --> 00:00:02,000\nUm, so the paper boat drifts.\n\n2\n00:00:02,600 --> 00:00:03,700\nIt floats away.\n"
    );
  });

  it("writes the same SRT through Whisper when provider is openai", async () => {
    Object.assign(process.env, { ELEVENLABS_API_KEY: "test-elevenlabs", OPENAI_API_KEY: "test-openai" });
    const scribeOut = join(dir, "scribe.srt");
    const whisperOut = join(dir, "whisper.srt");

    await runTool("audio_transcribe", { audioPath: audio, output: scribeOut });
    const result = await runTool("audio_transcribe", { audioPath: audio, output: whisperOut, provider: "openai" });

    expect(result).toMatchObject({ success: true, data: { provider: "openai", segmentCount: 2 } });
    expect(net.requests.at(-1)).toMatchObject({ host: "api.openai.com", path: "/v1/audio/transcriptions" });
    expect(readFileSync(whisperOut, "utf-8")).toBe(readFileSync(scribeOut, "utf-8"));
  });

  it("reports a rejected ElevenLabs key as an auth failure", async () => {
    Object.assign(process.env, { ELEVENLABS_API_KEY: "bad" });
    net.on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () =>
      new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 })
    );

    const result = await runTool("audio_transcribe", { audioPath: audio, provider: "elevenlabs" });

    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).toContain("auth");
  });
});

describe("jump-cut word transcription", () => {
  it("finds the same fillers in Scribe words (with punctuation) as in Whisper words", async () => {
    Object.assign(process.env, { ELEVENLABS_API_KEY: "test-elevenlabs", OPENAI_API_KEY: "test-openai" });

    const scribe = await transcribeWithWords(audio, await resolveSttProvider("elevenlabs"));
    const whisper = await transcribeWithWords(audio, await resolveSttProvider("openai"));

    expect(scribe.words).toHaveLength(FAKE_SCRIBE_TRANSCRIPT.words.filter((t) => t.type === "word").length);
    expect(scribe.words.map((w) => [w.start, w.end])).toEqual(whisper.words.map((w) => [w.start, w.end]));
    const strip = (fillers: ReturnType<typeof detectFillerRanges>) => fillers.map(({ start, end }) => ({ start, end }));
    const fromScribe = detectFillerRanges(scribe.words, DEFAULT_FILLER_WORDS, 0.05);
    expect(fromScribe.map((f) => f.word)).toEqual(["Um,", "so"]);
    expect(strip(fromScribe)).toEqual(strip(detectFillerRanges(whisper.words, DEFAULT_FILLER_WORDS, 0.05)));
  });
});
