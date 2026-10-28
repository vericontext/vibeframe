/**
 * The grade, speed-ramp, reframe, and upscale executors against real FFmpeg
 * on generated clips. Claude and Whisper are mocked and `fetch` throws, so
 * nothing here can reach a provider; keys are passed in explicitly, so no
 * config or `.env` is read.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@vibeframe/ai-providers";
import { ffprobeVideoSize } from "../../../utils/exec-safe.js";

const claude = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  analyzeColorGrade: vi.fn(),
  analyzeForSpeedRamp: vi.fn(),
  analyzeFrameForReframe: vi.fn(),
  constructed: 0,
}));

vi.mock("@vibeframe/ai-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vibeframe/ai-providers")>()),
  ClaudeProvider: class {
    constructor() {
      claude.constructed += 1;
    }
    initialize = claude.initialize;
    analyzeColorGrade = claude.analyzeColorGrade;
    analyzeForSpeedRamp = claude.analyzeForSpeedRamp;
    analyzeFrameForReframe = claude.analyzeFrameForReframe;
  },
}));

vi.mock("../transcription.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../transcription.js")>()),
  transcribeAudioFile: vi.fn(),
}));

const { transcribeAudioFile } = await import("../transcription.js");
const { executeGrade } = await import("./grade.js");
const { executeSpeedRamp, atempoChain } = await import("./speed-ramp.js");
const { executeReframe, centerCrop, averageCrop, parseAspect } = await import("./reframe.js");
const { executeUpscale } = await import("./upscale.js");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

let dir: string;
/** 320x240, 4 s, with a sine audio track. */
let withAudio: string;
/** 320x240, 2 s, video only. */
let silent: string;

function ffmpeg(args: string[]): void {
  const run = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
}

const reframeTempDirs = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("vibe-reframe-")));

beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network is off in this test");
  });
  if (!hasFfmpeg) return;
  dir = await mkdtemp(join(tmpdir(), "vibe-edit-exec-"));
  withAudio = join(dir, "with-audio.mp4");
  silent = join(dir, "silent.mp4");
  ffmpeg([
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=4",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", withAudio,
  ]);
  ffmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  claude.constructed = 0;
});

describe("reframe crop math", () => {
  it("parses W:H and rejects anything else", () => {
    expect(parseAspect("9:16")).toBeCloseTo(0.5625);
    expect(parseAspect("1:1")).toBe(1);
    for (const bad of ["wide", "9x16", "0:1", "1:0", ":", "9:16:1"]) expect(parseAspect(bad)).toBeUndefined();
  });

  it("center crop is the largest even-sized crop of the ratio, centered", () => {
    expect(centerCrop(1920, 1080, 9 / 16)).toEqual({ x: 657, y: 0, width: 606, height: 1080 });
    expect(centerCrop(1080, 1920, 1)).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
    expect(centerCrop(320, 240, 9 / 16)).toEqual({ x: 93, y: 0, width: 134, height: 240 });
  });

  it("averages analyzed positions and clamps them inside the source", () => {
    const base = centerCrop(320, 240, 9 / 16);
    expect(averageCrop([{ cropX: 10, cropY: 0 }, { cropX: 30, cropY: 0 }], base, 320, 240)).toEqual({ ...base, x: 20, y: 0 });
    expect(averageCrop([{ cropX: 900, cropY: -5 }], base, 320, 240)).toEqual({ ...base, x: 320 - base.width, y: 0 });
  });

  it("has nothing to average with no frames, instead of a NaN crop", () => {
    expect(averageCrop([], centerCrop(320, 240, 1), 320, 240)).toBeUndefined();
  });
});

describe("atempoChain", () => {
  it("splits speeds outside one atempo's 0.5-2.0 range so the audio is kept", () => {
    expect(atempoChain(1.5)).toBe("atempo=1.500");
    expect(atempoChain(4)).toBe("atempo=2.000,atempo=2.000");
    expect(atempoChain(0.25)).toBe("atempo=0.500,atempo=0.500");
  });
});

describe.skipIf(!hasFfmpeg)("executeReframe", () => {
  it("center focus is a free FFmpeg crop: no Claude, no key", async () => {
    const output = join(dir, "center.mp4");
    const result = await executeReframe({ videoPath: withAudio, aspect: "9:16", output });
    expect(result).toMatchObject({ success: true, outputPath: output, focus: "center", crop: { x: 93, y: 0, width: 134, height: 240 } });
    expect(claude.constructed).toBe(0);
    expect(await ffprobeVideoSize(output)).toEqual({ width: 134, height: 240 });
  });

  it("auto focus crops at the average Claude position", async () => {
    let call = 0;
    claude.analyzeFrameForReframe.mockImplementation(async () => {
      call += 1;
      return { cropX: call === 1 ? 10 : 30, cropY: 0, cropWidth: 135, cropHeight: 240, confidence: 0.9, subjectDescription: `frame ${call}` };
    });
    const before = reframeTempDirs();
    const output = join(dir, "auto.mp4");
    const result = await executeReframe({ videoPath: withAudio, focus: "auto", apiKey: "test-key", output, frameDelayMs: 0 });

    expect(claude.initialize).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(claude.analyzeFrameForReframe).toHaveBeenCalledTimes(2);
    expect(claude.analyzeFrameForReframe.mock.calls[0][2]).toMatchObject({ focusMode: "auto", sourceWidth: 320, sourceHeight: 240 });
    if (!result.success) throw new Error(result.error);
    expect(result.cropKeyframes.map((kf) => kf.cropX)).toEqual([10, 30]);
    expect(result.crop).toEqual({ x: 20, y: 0, width: 134, height: 240 });
    expect(await ffprobeVideoSize(output)).toEqual({ width: 134, height: 240 });
    expect(reframeTempDirs()).toEqual(before);
  });

  it("fails, writes nothing, and cleans up when no frame can be analyzed", async () => {
    claude.analyzeFrameForReframe.mockRejectedValue(new Error("bad frame"));
    const before = reframeTempDirs();
    const output = join(dir, "never.mp4");
    const result = await executeReframe({ videoPath: withAudio, focus: "face", apiKey: "test-key", output, frameDelayMs: 0 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure).toMatchObject({ code: "API_ERROR", retryable: true });
    expect(result.error).toBe("Reframe analysis failed on frame 1/2: bad frame");
    expect(claude.analyzeFrameForReframe).toHaveBeenCalledTimes(1);
    expect(existsSync(output)).toBe(false);
    expect(reframeTempDirs()).toEqual(before);
  });

  it("fails on the first frame that cannot be analyzed, without calling Claude for the rest", async () => {
    // Before, a failed frame was skipped and the crop averaged over the rest,
    // so the run reported success on a crop Claude never fully agreed to.
    claude.analyzeFrameForReframe
      .mockResolvedValueOnce({ cropX: 10, cropY: 0, cropWidth: 135, cropHeight: 240, confidence: 0.9, subjectDescription: "frame 1" })
      .mockRejectedValueOnce(new ProviderError({ kind: "provider", provider: "claude", message: "claude returned no parseable reframe JSON" }))
      .mockResolvedValue({ cropX: 30, cropY: 0, cropWidth: 135, cropHeight: 240, confidence: 0.9, subjectDescription: "later frame" });
    const longer = join(dir, "six-seconds.mp4");
    ffmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", longer]);
    const before = reframeTempDirs();
    const output = join(dir, "partial.mp4");
    const result = await executeReframe({ videoPath: longer, focus: "auto", apiKey: "test-key", output, frameDelayMs: 0 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure).toMatchObject({ code: "API_ERROR", errorKind: "provider" });
    expect(result.error).toContain("frame 2/3");
    expect(result.error).toContain("no parseable reframe JSON");
    expect(claude.analyzeFrameForReframe).toHaveBeenCalledTimes(2);
    expect(existsSync(output)).toBe(false);
    expect(reframeTempDirs()).toEqual(before);
  });

  it("fails when a frame analysis returns a non-finite position instead of dropping it", async () => {
    claude.analyzeFrameForReframe.mockResolvedValue({ cropX: Number.NaN, cropY: 0, cropWidth: 135, cropHeight: 240, confidence: 0.9, subjectDescription: "?" });
    const result = await executeReframe({ videoPath: withAudio, focus: "auto", apiKey: "test-key", analyzeOnly: true, frameDelayMs: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure).toMatchObject({ errorKind: "provider" });
    expect(claude.analyzeFrameForReframe).toHaveBeenCalledTimes(1);
  });

  it("carries the provider error kind when every frame fails on the provider", async () => {
    claude.analyzeFrameForReframe.mockRejectedValue(new ProviderError({ kind: "auth", provider: "claude", message: "invalid x-api-key" }));
    const result = await executeReframe({ videoPath: withAudio, focus: "auto", apiKey: "test-key", frameDelayMs: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.failure).toMatchObject({ code: "AUTH_ERROR", errorKind: "auth" });
  });

  it("analyzeOnly computes the crop without writing a file", async () => {
    const result = await executeReframe({ videoPath: withAudio, aspect: "1:1", analyzeOnly: true });
    expect(result).toMatchObject({ success: true, crop: { width: 240, height: 240 } });
    if (result.success) expect(result.outputPath).toBeUndefined();
  });

  it("rejects a bad aspect, a bad focus, and a missing file as structured failures", async () => {
    expect(await executeReframe({ videoPath: withAudio, aspect: "wide" })).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
    expect(await executeReframe({ videoPath: withAudio, focus: "sideways" as never })).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
    expect(await executeReframe({ videoPath: join(dir, "nope.mp4") })).toMatchObject({ success: false, failure: { code: "NOT_FOUND" } });
  });
});

describe.skipIf(!hasFfmpeg)("executeSpeedRamp", () => {
  it("a video without audio is a usage error, before any transcription", async () => {
    const result = await executeSpeedRamp({ videoPath: silent, apiKey: "test-key", stt: "openai", sttApiKey: "test-key" });
    expect(result).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
    expect(result.success ? "" : result.error).toContain("no audio stream");
    expect(transcribeAudioFile).not.toHaveBeenCalled();
    expect(claude.constructed).toBe(0);
  });

  it("a failed transcription keeps its provider error kind", async () => {
    vi.mocked(transcribeAudioFile).mockResolvedValue({ id: "", status: "failed", error: "quota exceeded", errorKind: "quota" });
    const result = await executeSpeedRamp({ videoPath: withAudio, apiKey: "test-key", stt: "openai", sttApiKey: "test-key" });
    expect(result).toMatchObject({ success: false, failure: { errorKind: "quota" } });
  });

  it("applies the average planned speed and keeps the audio", async () => {
    vi.mocked(transcribeAudioFile).mockResolvedValue({
      id: "t",
      status: "completed",
      segments: [{ id: 0, startTime: 0, endTime: 4, text: "hello there", confidence: 1 }],
    } as never);
    claude.analyzeForSpeedRamp.mockResolvedValue({
      keyframes: [
        { time: 0, speed: 1, reason: "start" },
        { time: 2, speed: 3, reason: "fast" },
      ],
    });
    const output = join(dir, "ramped.mp4");
    const result = await executeSpeedRamp({ videoPath: withAudio, apiKey: "test-key", stt: "openai", sttApiKey: "test-key", output });

    expect(result).toMatchObject({ success: true, outputPath: output, avgSpeed: 2 });
    const audio = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", output], { encoding: "utf-8" });
    expect(audio.stdout.trim()).toBe("audio");
  });

  it("no keyframes from Claude is a retryable failure, not a NaN speed", async () => {
    vi.mocked(transcribeAudioFile).mockResolvedValue({
      id: "t",
      status: "completed",
      segments: [{ id: 0, startTime: 0, endTime: 4, text: "hello", confidence: 1 }],
    } as never);
    claude.analyzeForSpeedRamp.mockResolvedValue({ keyframes: [] });
    const result = await executeSpeedRamp({ videoPath: withAudio, apiKey: "test-key", stt: "openai", sttApiKey: "test-key", analyzeOnly: true });
    expect(result).toMatchObject({ success: false, failure: { code: "API_ERROR", retryable: true } });
  });
});

describe.skipIf(!hasFfmpeg)("executeGrade", () => {
  it("a preset needs no key and writes the graded file", async () => {
    claude.analyzeColorGrade.mockResolvedValue({ ffmpegFilter: "eq=contrast=1.1", description: "test grade" });
    const output = join(dir, "graded.mp4");
    const result = await executeGrade({ videoPath: silent, preset: "vintage", output });
    expect(result).toMatchObject({ success: true, outputPath: output, style: "vintage" });
    expect(claude.initialize).not.toHaveBeenCalled();
    expect(existsSync(output)).toBe(true);
  });

  it("an unknown preset is a usage error", async () => {
    expect(await executeGrade({ videoPath: silent, preset: "nope" })).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
  });
});

describe.skipIf(!hasFfmpeg)("executeUpscale", () => {
  it("scales with FFmpeg and rejects scales other than 2 or 4", async () => {
    const output = join(dir, "up.mp4");
    expect(await executeUpscale({ videoPath: silent, scale: 2, output })).toMatchObject({ success: true, outputPath: output, targetRes: "640x480" });
    expect(await ffprobeVideoSize(output)).toEqual({ width: 640, height: 480 });
    expect(await executeUpscale({ videoPath: silent, scale: 3 })).toMatchObject({ success: false, failure: { code: "USAGE_ERROR" } });
  });
});
