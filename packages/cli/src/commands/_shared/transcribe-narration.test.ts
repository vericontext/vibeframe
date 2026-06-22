import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  beatTranscriptRelPath,
  readBeatTranscript,
  transcribeNarrationWords,
} from "./transcribe-narration.js";

describe("beatTranscriptRelPath", () => {
  it("maps a beat id to the canonical assets path", () => {
    expect(beatTranscriptRelPath("hook")).toBe("assets/transcript-hook.json");
  });
});

describe("readBeatTranscript", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "transcribe-narration-test-"));
    mkdirSync(join(projectDir, "assets"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function seedTranscript(beatId: string, content: string): void {
    writeFileSync(join(projectDir, beatTranscriptRelPath(beatId)), content, "utf-8");
  }

  it("returns undefined when the transcript file is missing", async () => {
    expect(await readBeatTranscript(projectDir, "hook")).toBeUndefined();
  });

  it("reads a well-formed word-level transcript", async () => {
    seedTranscript(
      "hook",
      JSON.stringify([
        { text: "Ship", start: 0, end: 0.4 },
        { text: "faster", start: 0.4, end: 0.9 },
      ])
    );
    const words = await readBeatTranscript(projectDir, "hook");
    expect(words).toEqual([
      { text: "Ship", start: 0, end: 0.4 },
      { text: "faster", start: 0.4, end: 0.9 },
    ]);
  });

  it("drops malformed entries and keeps the valid ones", async () => {
    seedTranscript(
      "hook",
      JSON.stringify([
        { text: "ok", start: 0, end: 0.3 },
        { text: "missing-times" },
        { start: 1, end: 2 },
        { text: "nan", start: Number.NaN, end: 1 },
        { text: "good", start: 1, end: 1.5 },
      ])
    );
    const words = await readBeatTranscript(projectDir, "hook");
    expect(words).toEqual([
      { text: "ok", start: 0, end: 0.3 },
      { text: "good", start: 1, end: 1.5 },
    ]);
  });

  it("returns undefined for non-array / malformed JSON", async () => {
    seedTranscript("a", "{ not: valid json");
    seedTranscript("b", JSON.stringify({ text: "x", start: 0, end: 1 }));
    seedTranscript("c", JSON.stringify([]));
    expect(await readBeatTranscript(projectDir, "a")).toBeUndefined();
    expect(await readBeatTranscript(projectDir, "b")).toBeUndefined();
    expect(await readBeatTranscript(projectDir, "c")).toBeUndefined();
  });
});

describe("transcribeNarrationWords", () => {
  it("returns [] (non-fatal) when the audio file cannot be read", async () => {
    const words = await transcribeNarrationWords("/nonexistent/path/narration.wav", {
      apiKey: "sk-test-unused",
    });
    expect(words).toEqual([]);
  });
});
