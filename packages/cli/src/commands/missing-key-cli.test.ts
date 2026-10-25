/**
 * Every paid command reports a missing provider key the same way: the
 * `ApiKeyError` envelope (`API_KEY_MISSING`, exit 4, "Set X in .env, or run:
 * vibe setup") as the only thing on stderr in `--json` mode, before any
 * spend. Spawns the built CLI with an empty HOME and no keys in the
 * environment, from a temp directory with no `.env` above it.
 */

import { describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../../dist/index.js");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function makeWorkspace(): { cwd: string; env: NodeJS.ProcessEnv } {
  const cwd = mkdtempSync(join(tmpdir(), "vibe-missing-key-"));
  const home = mkdtempSync(join(tmpdir(), "vibe-missing-key-home-"));
  // Only existence is checked before the key; the bytes never reach a provider.
  writeFileSync(join(cwd, "v.mp4"), "not really a video");
  writeFileSync(join(cwd, "a.mp3"), "not really audio");
  writeFileSync(join(cwd, "s.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhello\n");
  return { cwd, env: { PATH: process.env.PATH ?? "", HOME: home } };
}

function run(cwd: string, env: NodeJS.ProcessEnv, args: string[]): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args, "--json"],
      { cwd, env, encoding: "utf-8", timeout: 60_000 },
      (_error, stdout, stderr) => resolveRun({ code: child.exitCode, stdout, stderr })
    );
    child.stdin?.end();
  });
}

function expectMissingKey(result: Run, envVar: string, label: string): void {
  expect({ label, code: result.code, stdout: result.stdout }).toEqual({ label, code: 4, stdout: "" });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.stderr) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stderr is not a single JSON document:\n${result.stderr}`);
  }
  expect(parsed, label).toMatchObject({
    success: false,
    code: "API_KEY_MISSING",
    exitCode: 4,
    retryable: false,
  });
  expect(String(parsed.suggestion), label).toContain(`Set ${envVar} in .env, or run: vibe setup`);
}

const CASES: Array<{ args: string[]; envVar: string; ffmpeg?: boolean }> = [
  // Previously API_ERROR: the catch-all wrapped the ApiKeyError.
  { args: ["generate", "video", "a cat", "-p", "grok"], envVar: "XAI_API_KEY" },
  { args: ["generate", "thumbnail", "a cat"], envVar: "OPENAI_API_KEY" },
  { args: ["audio", "list-voices"], envVar: "ELEVENLABS_API_KEY" },
  // Previously API_ERROR: the executor returned its own "X required" string.
  { args: ["generate", "motion", "a title"], envVar: "ANTHROPIC_API_KEY" },
  // Previously AUTH_ERROR: a missing key is not a rejected key.
  { args: ["generate", "narration", "hi", "-p", "openai"], envVar: "OPENAI_API_KEY" },
  { args: ["generate", "narration", "hi", "-p", "elevenlabs"], envVar: "ELEVENLABS_API_KEY" },
  { args: ["generate", "video-extend", "task-123"], envVar: "KLING_API_KEY" },
  // Already right; kept so they stay right.
  { args: ["generate", "sound-effect", "boom"], envVar: "ELEVENLABS_API_KEY" },
  { args: ["generate", "music", "lofi", "--no-wait"], envVar: "ELEVENLABS_API_KEY" },
  { args: ["edit", "translate-srt", "s.srt", "--target", "ko"], envVar: "ANTHROPIC_API_KEY" },
  { args: ["audio", "dub", "a.mp3", "-l", "ko"], envVar: "OPENAI_API_KEY" },
  // These check for FFmpeg first.
  // Previously exit 0 with a spinner and no JSON at all.
  { args: ["edit", "grade", "v.mp4", "--style", "warm film"], envVar: "ANTHROPIC_API_KEY", ffmpeg: true },
  { args: ["edit", "reframe", "v.mp4"], envVar: "ANTHROPIC_API_KEY", ffmpeg: true },
  // Previously ERROR (exit 1).
  { args: ["edit", "speed-ramp", "v.mp4"], envVar: "OPENAI_API_KEY", ffmpeg: true },
];

describe("missing provider keys", () => {
  it("every paid command reports API_KEY_MISSING (exit 4) as the only stderr JSON", async () => {
    const { cwd, env } = makeWorkspace();
    const cases = CASES.filter((c) => hasFfmpeg || !c.ffmpeg);
    const results = await Promise.all(cases.map((c) => run(cwd, env, c.args)));
    cases.forEach((c, i) => expectMissingKey(results[i], c.envVar, c.args.join(" ")));
  }, 120_000);
});

describe("edit fill-gaps on a file that is not a timeline", () => {
  it("is a usage error naming the file, not a JSON parse failure", async () => {
    const { cwd, env } = makeWorkspace();
    const result = await run(cwd, env, ["edit", "fill-gaps", "v.mp4"]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      code: "USAGE_ERROR",
      error: expect.stringContaining("Not a timeline project:"),
    });
  }, 60_000);
});
