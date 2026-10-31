/**
 * `vibe remix highlights` and `vibe remix auto-shorts` run in process against
 * the fake provider network: real FFmpeg, real transcription, Claude and
 * Gemini providers, and `providerRequest`, with fake endpoints behind them.
 *
 * These pin what a user sees - the `--json` envelope, the human lines, the
 * exit code and structured error, the files written - so the commands and
 * the `executeHighlights` / `executeAutoShorts` executors the MCP tools use
 * cannot drift apart again.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { manifest } from "../tools/manifest/index.js";
import { buildMcpDispatcher } from "../tools/adapters/mcp.js";
import { registerHighlightsCommands } from "./ai-highlights.js";

const ANTHROPIC = "api.anthropic.com";
const GEMINI = "generativelanguage.googleapis.com";
const SCRIBE = "api.elevenlabs.io";
const WHISPER = "api.openai.com";

/** Claude's highlight picks for the fake transcript; the last one is below the 0.7 threshold. */
const CLAUDE_HIGHLIGHTS = [
  { startTime: 2.6, endTime: 3.7, reason: "Quiet ending", transcript: "It floats away.", confidence: 0.8, category: "informative" },
  { startTime: 0, endTime: 2, reason: "Strong opening line", transcript: "Um, so the paper boat drifts.", confidence: 0.92, category: "emotional" },
  { startTime: 1, endTime: 2.5, reason: "Weak beat", transcript: "the paper boat", confidence: 0.4, category: "funny" },
];

/** Gemini's highlight picks, wrapped in a code fence the way Gemini often replies. */
const GEMINI_HIGHLIGHTS = {
  highlights: [
    { startTime: 0.5, endTime: 2.5, category: "funny", confidence: 0.85, reason: "Visual gag", transcript: "boat tips over" },
    { startTime: 2.5, endTime: 3.5, confidence: 0.75, hookQuality: 0.6, reason: "Reaction shot" },
  ],
};

const claudeReply = (body: unknown) =>
  jsonResponse({ id: "msg_1", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] });
const geminiReply = (text: string) =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 10 } });

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let fixtures: string;
let video: string;
let silentVideo: string;
let audio: string;
let dir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

function ffmpeg(args: string[]): void {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
}

beforeAll(() => {
  if (!hasFfmpeg) return;
  fixtures = mkdtempSync(join(tmpdir(), "vibe-highlights-fixtures-"));
  video = join(fixtures, "talk.mp4");
  silentVideo = join(fixtures, "silent.mp4");
  audio = join(fixtures, "talk.wav");
  // 640x480 crops to an even-sized 270x480 for 9:16.
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10:duration=4",
    "-f", "lavfi", "-i", "sine=duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", video,
  ]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=10:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silentVideo]);
  ffmpeg(["-f", "lavfi", "-i", "sine=duration=4", audio]);
});

afterAll(() => {
  if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});

beforeEach(() => {
  if (!hasFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), "vibe-highlights-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  net = createFakeProviderNetwork()
    .on("POST", ANTHROPIC, /^\/v1\/messages$/, () => claudeReply(CLAUDE_HIGHLIGHTS))
    .on("POST", GEMINI, /:generateContent$/, () => geminiReply("```json\n" + JSON.stringify(GEMINI_HIGHLIGHTS) + "\n```"));
  net.install();
});

afterEach(() => {
  net?.uninstall();
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function useKeys(keys: Record<string, string>): void {
  Object.assign(process.env, keys);
}

const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

/** Paths and timings that differ per run, replaced so outputs compare. */
function normalize(text: string): string {
  return text
    .replace(ANSI, "")
    .split(dir).join("<dir>")
    .split(fixtures).join("<fixtures>")
    .replace(/"elapsedMs": \d+/g, '"elapsedMs": 0');
}

interface RunResult {
  exitCode: number | undefined;
  /** The `--json` success envelope, if one was printed. */
  envelope?: Record<string, unknown>;
  /** The structured error envelope (`--json`) on stderr, if any. */
  error?: Record<string, unknown>;
  /** Human mode: every console line and spinner frame, in order. */
  human: string;
}

/**
 * Run `vibe remix <args>` in process. `process.exit` is stubbed to throw so
 * the exit code and output are read back instead of ending the worker. A
 * fresh command tree per run, since Commander 12 keeps option values
 * between parses.
 */
async function run(args: string[], opts: { json?: boolean } = {}): Promise<RunResult> {
  if (opts.json) process.env.VIBE_JSON_OUTPUT = "1";
  else delete process.env.VIBE_JSON_OUTPUT;
  const remix = new Command("remix");
  registerHighlightsCommands(remix);

  // A real exit ends the process; the stub throws instead, and whatever a
  // catch block prints after that would never reach a user, so it is dropped.
  let exitCode: number | undefined;
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code;
    throw new Error("process.exit");
  }) as never);
  const lines: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const record = (line: string, stream: string[]) => {
    if (exitCode !== undefined) return;
    lines.push(line);
    stream.push(line);
  };
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => record(parts.map(String).join(" "), stdout));
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => record(parts.map(String).join(" "), stderr));
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    record(String(chunk).replace(/\n$/, ""), []);
    return true;
  }) as never);

  await remix.parseAsync(args, { from: "user" }).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "process.exit")) throw error;
  });

  const parse = (all: string[]) => {
    const json = all.find((line) => line.trimStart().startsWith("{"));
    return json ? (JSON.parse(normalize(json)) as Record<string, unknown>) : undefined;
  };
  return {
    exitCode,
    envelope: opts.json ? parse(stdout) : undefined,
    error: opts.json ? parse(stderr) : undefined,
    human: normalize(lines.join("\n")),
  };
}

const files = () => readdirSync(dir).sort();

describe.skipIf(!hasFfmpeg)("vibe remix highlights", () => {
  it("Scribe + Claude: --json envelope, saved JSON, and project file", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, envelope } = await run(["highlights", video, "-o", "hl.json", "--project", "reel.json"], { json: true });

    expect(exitCode).toBeUndefined();
    expect(envelope).toMatchInlineSnapshot(`
      {
        "command": "remix highlights",
        "costUsd": 0,
        "data": {
          "criteria": "all",
          "highlights": [
            {
              "category": "emotional",
              "confidence": 0.92,
              "duration": 2,
              "endTime": 2,
              "index": 1,
              "reason": "Strong opening line",
              "startTime": 0,
              "transcript": "Um, so the paper boat drifts.",
            },
            {
              "category": "informative",
              "confidence": 0.8,
              "duration": 1.1,
              "endTime": 3.7,
              "index": 2,
              "reason": "Quiet ending",
              "startTime": 2.6,
              "transcript": "It floats away.",
            },
          ],
          "highlightsCount": 2,
          "outputPath": "<dir>/hl.json",
          "projectPath": "<dir>/reel.json",
          "sourceFile": "<fixtures>/talk.mp4",
          "threshold": 0.7,
          "totalDuration": 3.7,
          "totalHighlightDuration": 3.1,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(net.to(SCRIBE)).toHaveLength(1);
    expect(net.to(WHISPER)).toHaveLength(0);
    expect(net.to(ANTHROPIC)).toHaveLength(1);
    expect(files()).toEqual(["hl.json", "reel.json"]);
    const saved = JSON.parse(normalize(readFileSync(join(dir, "hl.json"), "utf-8")));
    const product = { ...(envelope!.data as Record<string, unknown>) };
    delete product.outputPath;
    delete product.projectPath;
    expect(saved).toEqual(product);
    const project = JSON.parse(readFileSync(join(dir, "reel.json"), "utf-8"));
    expect(project.state.clips.map((c: { startTime: number; duration: number; sourceStartOffset: number }) => [c.startTime, c.duration, c.sourceStartOffset]))
      .toEqual([[0, 2, 0], [2, 1.1, 2.6]]);
  });

  it("Scribe + Claude: human output", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, human } = await run(["highlights", video, "-o", "hl.json"]);

    expect(exitCode).toBeUndefined();
    expect(human).toMatchInlineSnapshot(`
      "
      🎬 Highlight Extraction Pipeline
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - 🎵 Extracting audio from video...
      ✔ Extracted audio (0:04.0 total duration)
      - 📝 Transcribing with ElevenLabs Scribe...
      ✔ Transcribed 2 segments
      - 🔍 Analyzing highlights with Claude...
      ✔ Found 3 potential highlights
      - 📊 Filtering and ranking...
      ✔ Selected 2 highlights (3.1s total)

      Highlights Summary
      ────────────────────────────────────────────────────────────

        1. [0:00.0 - 0:02.0] emotional, 92%
           Strong opening line
           Um, so the paper boat drifts.

        2. [0:02.6 - 0:03.7] informative, 80%
           Quiet ending
           It floats away.

      ────────────────────────────────────────────────────────────
      Total: 2 highlights, 3.1 seconds

      💾 Saved highlights to: <dir>/hl.json

      ✅ Highlight extraction complete!
      "
    `);
  });

  it("--stt openai transcribes an audio file with Whisper", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", OPENAI_API_KEY: "sk-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, envelope } = await run(["highlights", audio, "--stt", "openai", "--criteria", "emotional", "--count", "1"], { json: true });

    expect(exitCode).toBeUndefined();
    expect(envelope).toMatchInlineSnapshot(`
      {
        "command": "remix highlights",
        "costUsd": 0,
        "data": {
          "criteria": "emotional",
          "highlights": [
            {
              "category": "emotional",
              "confidence": 0.92,
              "duration": 2,
              "endTime": 2,
              "index": 1,
              "reason": "Strong opening line",
              "startTime": 0,
              "transcript": "Um, so the paper boat drifts.",
            },
          ],
          "highlightsCount": 1,
          "sourceFile": "<fixtures>/talk.wav",
          "threshold": 0.7,
          "totalDuration": 3.7,
          "totalHighlightDuration": 2,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(net.to(WHISPER)).toHaveLength(1);
    expect(net.to(SCRIBE)).toHaveLength(0);
    expect(files()).toEqual([]);
  });

  it("--use-gemini: --json envelope and human output", async () => {
    useKeys({ GOOGLE_API_KEY: "AIza-fake" });

    const json = await run(["highlights", video, "--use-gemini", "--low-res"], { json: true });
    expect(json.exitCode).toBeUndefined();
    expect(json.envelope).toMatchInlineSnapshot(`
      {
        "command": "remix highlights",
        "costUsd": 0,
        "data": {
          "criteria": "all",
          "highlights": [
            {
              "category": "funny",
              "confidence": 0.85,
              "duration": 2,
              "endTime": 2.5,
              "index": 1,
              "reason": "Visual gag",
              "startTime": 0.5,
              "transcript": "boat tips over",
            },
            {
              "category": "all",
              "confidence": 0.75,
              "duration": 1,
              "endTime": 3.5,
              "index": 2,
              "reason": "Reaction shot",
              "startTime": 2.5,
              "transcript": "",
            },
          ],
          "highlightsCount": 2,
          "sourceFile": "<fixtures>/talk.mp4",
          "threshold": 0.7,
          "totalDuration": 4,
          "totalHighlightDuration": 3,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    const [request] = net.to(GEMINI);
    expect((request.body as { generationConfig: Record<string, unknown> }).generationConfig).toMatchObject({ mediaResolution: "MEDIA_RESOLUTION_LOW" });
    expect(net.to(ANTHROPIC)).toHaveLength(0);

    const human = await run(["highlights", video, "--use-gemini"]);
    expect(human.exitCode).toBeUndefined();
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Highlight Extraction Pipeline
      ────────────────────────────────────────────────────────────
      Using Gemini Video Understanding (visual + audio analysis)

      - 📊 Analyzing video metadata...
      ✔ Video duration: 0:04.0
      - 🎬 Analyzing video with Gemini (visual + audio)...
      ✔ Found 2 highlights via visual+audio analysis
      - 📊 Filtering and ranking...
      ✔ Selected 2 highlights (3.0s total)

      Highlights Summary
      ────────────────────────────────────────────────────────────

        1. [0:00.5 - 0:02.5] funny, 85%
           Visual gag
           boat tips over

        2. [0:02.5 - 0:03.5] all, 75%
           Reaction shot
           

      ────────────────────────────────────────────────────────────
      Total: 2 highlights, 3.0 seconds


      ✅ Highlight extraction complete!
      "
    `);
  });

  it("no highlights: a warning in the envelope, nothing written", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });
    net.on("POST", ANTHROPIC, /^\/v1\/messages$/, () => claudeReply([]));

    const json = await run(["highlights", video, "-o", "hl.json"], { json: true });
    expect(json.exitCode).toBeUndefined();
    expect(json.envelope).toMatchInlineSnapshot(`
      {
        "command": "remix highlights",
        "costUsd": 0,
        "data": {
          "criteria": "all",
          "highlights": [],
          "highlightsCount": 0,
          "sourceFile": "<fixtures>/talk.mp4",
          "threshold": 0.7,
          "totalDuration": 3.7,
          "totalHighlightDuration": 0,
        },
        "elapsedMs": 0,
        "warnings": [
          "No highlights detected in the content",
        ],
      }
    `);
    expect(files()).toEqual([]);

    const human = await run(["highlights", video]);
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Highlight Extraction Pipeline
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - 🎵 Extracting audio from video...
      ✔ Extracted audio (0:04.0 total duration)
      - 📝 Transcribing with ElevenLabs Scribe...
      ✔ Transcribed 2 segments
      - 🔍 Analyzing highlights with Claude...
      ⚠ No highlights detected in the content
      No highlights detected in the content"
    `);
  });

  it("--dry-run prints the parameters and calls nothing", async () => {
    const { exitCode, envelope } = await run(["highlights", video, "--use-gemini", "--count", "3", "--dry-run"], { json: true });

    expect(exitCode).toBeUndefined();
    expect(envelope).toMatchInlineSnapshot(`
      {
        "command": "remix highlights",
        "costUsd": 1,
        "data": {
          "params": {
            "count": "3",
            "criteria": "all",
            "duration": "60",
            "lowRes": false,
            "mediaPath": "<fixtures>/talk.mp4",
            "stt": "auto",
            "threshold": "0.7",
            "useGemini": true,
          },
        },
        "dryRun": true,
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(net.requests).toHaveLength(0);
  });

  it("a rejected Anthropic key exits 4 AUTH_ERROR", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-bad" });
    net.on("POST", ANTHROPIC, /^\/v1\/messages$/, () =>
      jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));

    const { exitCode, error } = await run(["highlights", video], { json: true });

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ code: "AUTH_ERROR", errorKind: "auth", retryable: false });
    expect(String(error?.error)).toContain("invalid x-api-key");
  });

  it("a rejected Scribe key exits 4 AUTH_ERROR before Claude is called", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-bad", ANTHROPIC_API_KEY: "sk-ant-fake" });
    net.on("POST", SCRIBE, /^\/v1\/speech-to-text$/, () =>
      jsonResponse({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401));

    const { exitCode, error } = await run(["highlights", video], { json: true });

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ code: "AUTH_ERROR", errorKind: "auth" });
    expect(String(error?.error)).toMatch(/^Transcription failed: /);
    expect(net.to(ANTHROPIC)).toHaveLength(0);
  });

  it("a missing key exits 4 API_KEY_MISSING before any request", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake" });

    const { exitCode, error } = await run(["highlights", video], { json: true });

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ code: "API_KEY_MISSING" });
    expect(net.requests).toHaveLength(0);
  });

  it("a missing file exits 3 NOT_FOUND", async () => {
    const { exitCode, error } = await run(["highlights", join(dir, "nope.mp4")], { json: true });

    expect(exitCode).toBe(3);
    expect(error).toMatchObject({ code: "NOT_FOUND", error: "File not found: <dir>/nope.mp4" });
  });

  it("a video with no audio track exits 1 and points at --use-gemini", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const json = await run(["highlights", silentVideo], { json: true });
    expect(json.exitCode).toBe(1);
    expect(json.error).toMatchObject({
      code: "ERROR",
      error: "Video has no audio track - cannot transcribe it.",
      suggestion: "Use --use-gemini flag for visual-only analysis of videos without audio.",
    });
    expect(net.requests).toHaveLength(0);

    const human = await run(["highlights", silentVideo]);
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Highlight Extraction Pipeline
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - 🎵 Extracting audio from video...
      ✖ Video has no audio track

        Video has no audio track - cannot transcribe it.
        Use --use-gemini flag for visual-only analysis of videos without audio.
      "
    `);
  });

  it("an unknown --stt value is a usage error", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, error } = await run(["highlights", video, "--stt", "nope"], { json: true });

    expect(exitCode).toBe(2);
    expect(error).toMatchObject({ code: "USAGE_ERROR" });
    expect(net.requests).toHaveLength(0);
  });

  it("the MCP tool reports the same highlights as the CLI", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const reply = await buildMcpDispatcher(manifest)("remix_highlights", { media: video, output: "hl.json" });
    const envelope = JSON.parse(normalize(reply.content[0].text)) as Record<string, unknown>;

    expect(envelope).toMatchObject({ success: true, highlights: 2, totalDuration: 3.7, outputPath: "<dir>/hl.json" });
    expect(files()).toEqual(["hl.json"]);
  });
});

describe.skipIf(!hasFfmpeg)("the MCP tools", () => {
  it("refuse a video with no audio track the way the CLI does, before any request", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });
    const dispatch = buildMcpDispatcher(manifest);

    for (const [name, args] of [
      ["remix_highlights", { media: silentVideo }],
      ["remix_auto_shorts", { video: silentVideo }],
    ] as const) {
      const envelope = JSON.parse((await dispatch(name, args)).content[0].text) as Record<string, unknown>;
      expect(envelope, name).toMatchObject({
        success: false,
        code: "ERROR",
        exitCode: 1,
        error: "Video has no audio track - cannot transcribe it.",
        suggestion: "Use --use-gemini flag for visual-only analysis of videos without audio.",
      });
    }
    expect(net.requests).toHaveLength(0);
    expect(readdirSync(fixtures).sort()).toEqual(["silent.mp4", "talk.mp4", "talk.wav"]);
  });
});

describe.skipIf(!hasFfmpeg)("vibe remix auto-shorts", () => {
  it("Scribe + Claude: one short to -o, --json envelope", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, envelope } = await run(["auto-shorts", video, "-o", "out/best"], { json: true });

    expect(exitCode).toBeUndefined();
    expect(envelope).toMatchInlineSnapshot(`
      {
        "command": "remix auto-shorts",
        "costUsd": 0,
        "data": {
          "aspect": "9:16",
          "outputPath": "<dir>/out/best.mp4",
          "shorts": [
            {
              "confidence": 0.92,
              "duration": 2,
              "endTime": 2,
              "outputPath": "<dir>/out/best.mp4",
              "reason": "Strong opening line",
              "startTime": 0,
            },
          ],
          "targetDuration": 60,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(existsSync(join(dir, "out", "best.mp4"))).toBe(true);
    expect(readdirSync(fixtures).sort()).toEqual(["silent.mp4", "talk.mp4", "talk.wav"]);
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, "out", "best.mp4")]);
    expect(String(probe.stdout).trim()).toBe("270,480");
  });

  it("Scribe + Claude: two shorts to --output-dir, human output", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, human } = await run(["auto-shorts", video, "--count", "2", "--output-dir", "shorts", "-a", "1:1"]);

    expect(exitCode).toBeUndefined();
    expect(human).toMatchInlineSnapshot(`
      "
      🎬 Auto Shorts Generator
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - Extracting audio...
      ✔ Found 3 potential highlights
      Selected top 2 for short generation

      Auto Shorts
      ────────────────────────────────────────────────────────────
      Target duration: 60s
      Aspect ratio: 1:1

      [Short 1] 0:00.0 - 0:02.0 (2.0s)
        Strong opening line
        Confidence: 92%
      [Short 2] 0:02.6 - 0:03.7 (1.1s)
        Quiet ending
        Confidence: 80%

      - Generating short 1/2...
      ✔ Short 1: <dir>/shorts/talk-short-1.mp4
      - Generating short 2/2...
      ✔ Short 2: <dir>/shorts/talk-short-2.mp4

      Generated 2 short(s)
      "
    `);
    expect(readdirSync(join(dir, "shorts")).sort()).toEqual(["talk-short-1.mp4", "talk-short-2.mp4"]);
  });

  it("--analyze-only: --json envelope and human output, nothing written", async () => {
    useKeys({ OPENAI_API_KEY: "sk-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const json = await run(["auto-shorts", video, "--analyze-only", "--count", "2", "-d", "30"], { json: true });
    expect(json.exitCode).toBeUndefined();
    expect(json.envelope).toMatchInlineSnapshot(`
      {
        "command": "remix auto-shorts",
        "costUsd": 0,
        "data": {
          "analyzeOnly": true,
          "aspect": "9:16",
          "shorts": [
            {
              "confidence": 0.92,
              "duration": 2,
              "endTime": 2,
              "reason": "Strong opening line",
              "startTime": 0,
            },
            {
              "confidence": 0.8,
              "duration": 1.1,
              "endTime": 3.7,
              "reason": "Quiet ending",
              "startTime": 2.6,
            },
          ],
          "targetDuration": 30,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(net.to(WHISPER)).toHaveLength(1);

    const human = await run(["auto-shorts", video, "--analyze-only"]);
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Auto Shorts Generator
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - Extracting audio...
      ✔ Found 3 potential highlights
      Selected top 1 for short generation

      Auto Shorts
      ────────────────────────────────────────────────────────────
      Target duration: 60s
      Aspect ratio: 9:16

      [Short 1] 0:00.0 - 0:02.0 (2.0s)
        Strong opening line
        Confidence: 92%

      Use without --analyze-only to generate shorts."
    `);
    expect(files()).toEqual([]);
  });

  it("--use-gemini --analyze-only: --json envelope and human output", async () => {
    useKeys({ GOOGLE_API_KEY: "AIza-fake" });

    const json = await run(["auto-shorts", video, "--use-gemini", "--analyze-only", "--count", "2"], { json: true });
    expect(json.exitCode).toBeUndefined();
    expect(json.envelope).toMatchInlineSnapshot(`
      {
        "command": "remix auto-shorts",
        "costUsd": 0,
        "data": {
          "analyzeOnly": true,
          "aspect": "9:16",
          "shorts": [
            {
              "confidence": 0.85,
              "duration": 2,
              "endTime": 2.5,
              "reason": "Visual gag",
              "startTime": 0.5,
            },
            {
              "confidence": 0.75,
              "duration": 1,
              "endTime": 3.5,
              "reason": "Reaction shot",
              "startTime": 2.5,
            },
          ],
          "targetDuration": 60,
        },
        "elapsedMs": 0,
        "warnings": [],
      }
    `);

    const human = await run(["auto-shorts", video, "--use-gemini", "--analyze-only"]);
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Auto Shorts Generator
      ────────────────────────────────────────────────────────────
      Using Gemini Video Understanding (visual + audio analysis)

      - 🎬 Analyzing video with Gemini (visual + audio)...
      ✔ Found 2 potential shorts via visual+audio analysis
      Selected top 1 for short generation

      Auto Shorts
      ────────────────────────────────────────────────────────────
      Target duration: 60s
      Aspect ratio: 9:16

      [Short 1] 0:00.5 - 0:02.5 (2.0s)
        Visual gag
        Confidence: 85%

      Use without --analyze-only to generate shorts."
    `);
  });

  it("--dry-run prints the parameters and calls nothing", async () => {
    const { exitCode, envelope } = await run(["auto-shorts", video, "--count", "2", "--dry-run"], { json: true });

    expect(exitCode).toBeUndefined();
    expect(envelope).toMatchInlineSnapshot(`
      {
        "command": "remix auto-shorts",
        "costUsd": 2,
        "data": {
          "params": {
            "addCaptions": false,
            "analyzeOnly": false,
            "aspect": "9:16",
            "captionStyle": "bold",
            "count": "2",
            "duration": "60",
            "lowRes": false,
            "stt": "auto",
            "useGemini": false,
            "videoPath": "<fixtures>/talk.mp4",
          },
        },
        "dryRun": true,
        "elapsedMs": 0,
        "warnings": [],
      }
    `);
    expect(net.requests).toHaveLength(0);
  });

  it("no speech exits 1 and points at --use-gemini", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });
    net.on("POST", SCRIBE, /^\/v1\/speech-to-text$/, () => jsonResponse({ language_code: "eng", text: "", words: [] }));

    const { exitCode, error } = await run(["auto-shorts", video], { json: true });

    expect(exitCode).toBe(1);
    expect(error).toMatchObject({ code: "ERROR", error: "No speech found to pick shorts from", suggestion: "Try --use-gemini for visual analysis." });
    expect(net.to(ANTHROPIC)).toHaveLength(0);
  });

  it("no highlights exits 1", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });
    net.on("POST", ANTHROPIC, /^\/v1\/messages$/, () => claudeReply([]));

    const { exitCode, error } = await run(["auto-shorts", video], { json: true });

    expect(exitCode).toBe(1);
    expect(error).toMatchObject({ code: "ERROR", error: "No highlights found" });
  });

  it("a rejected Anthropic key exits 4 AUTH_ERROR", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-bad" });
    net.on("POST", ANTHROPIC, /^\/v1\/messages$/, () =>
      jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));

    const { exitCode, error } = await run(["auto-shorts", video], { json: true });

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ code: "AUTH_ERROR", errorKind: "auth", retryable: false });
    expect(files()).toEqual([]);
  });

  it("a missing key exits 4 API_KEY_MISSING before any request", async () => {
    useKeys({ ANTHROPIC_API_KEY: "sk-ant-fake" });

    const { exitCode, error } = await run(["auto-shorts", video], { json: true });

    expect(exitCode).toBe(4);
    expect(error).toMatchObject({ code: "API_KEY_MISSING" });
    expect(net.requests).toHaveLength(0);
  });

  it("a missing file exits 3 NOT_FOUND", async () => {
    const { exitCode, error } = await run(["auto-shorts", join(dir, "nope.mp4")], { json: true });

    expect(exitCode).toBe(3);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("a video with no audio track exits 1 and points at --use-gemini", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const json = await run(["auto-shorts", silentVideo], { json: true });
    expect(json.exitCode).toBe(1);
    expect(json.error).toMatchObject({
      code: "ERROR",
      error: "Video has no audio track - cannot transcribe it.",
      suggestion: "Use --use-gemini flag for visual-only analysis of videos without audio.",
    });
    expect(net.requests).toHaveLength(0);

    const human = await run(["auto-shorts", silentVideo]);
    expect(human.human).toMatchInlineSnapshot(`
      "
      🎬 Auto Shorts Generator
      ────────────────────────────────────────────────────────────
      Using transcription + Claude (audio-based analysis)

      - Extracting audio...
      ✖ Video has no audio track

        Video has no audio track - cannot transcribe it.
        Use --use-gemini flag for visual-only analysis of videos without audio.
      "
    `);
  });

  it("the MCP tool generates the same short as the CLI", async () => {
    useKeys({ ELEVENLABS_API_KEY: "xi-fake", ANTHROPIC_API_KEY: "sk-ant-fake" });

    const reply = await buildMcpDispatcher(manifest)("remix_auto_shorts", { video, outputDir: "shorts" });
    const envelope = JSON.parse(normalize(reply.content[0].text)) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      success: true,
      shorts: 1,
      shortsDetails: [{ index: 1, duration: 2, confidence: 0.92, outputPath: "<dir>/shorts/talk-short-1.mp4" }],
    });
  });
});
