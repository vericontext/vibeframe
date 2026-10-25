/**
 * The free `vibe edit` paths write their output in `--json` mode, exactly
 * as in human mode. Spawns the built CLI from a temp directory with an
 * empty HOME and no keys in the environment, so no `.env` or config with
 * real keys is in reach.
 */

import { describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
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
  // realpath: the CLI reports paths from its process.cwd(), which resolves /var -> /private/var on macOS.
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "vibe-edit-free-")));
  const home = mkdtempSync(join(tmpdir(), "vibe-edit-free-home-"));
  const made = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    join(cwd, "v.mp4"),
  ]);
  if (made.status !== 0) throw new Error(`ffmpeg fixture failed: ${made.stderr}`);
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

function videoSize(path: string): string {
  return spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path], {
    encoding: "utf-8",
  }).stdout.trim();
}

/** stdout is one JSON envelope whose `data.outputPath` exists on disk. */
function expectWritten(result: Run, label: string): string {
  expect({ label, code: result.code, stderr: result.stderr }).toEqual({ label, code: 0, stderr: "" });
  const envelope = JSON.parse(result.stdout) as { data: { outputPath?: string } };
  const outputPath = envelope.data.outputPath;
  expect(outputPath, label).toBeTruthy();
  expect(existsSync(outputPath!), `${label}: ${outputPath} exists`).toBe(true);
  return outputPath!;
}

describe.skipIf(!hasFfmpeg)("free edit paths write their output in --json mode", () => {
  it("grade --preset, reframe --focus center, and upscale each write the file they report", async () => {
    const { cwd, env } = makeWorkspace();
    const [grade, reframe, square, upscale, legacyFlag] = await Promise.all([
      run(cwd, env, ["edit", "grade", "v.mp4", "--preset", "cinematic-warm"]),
      run(cwd, env, ["edit", "reframe", "v.mp4", "--focus", "center"]),
      run(cwd, env, ["edit", "reframe", "v.mp4", "--focus", "center", "-a", "1:1", "-o", "square.mp4", "--keyframes", "kf.json"]),
      run(cwd, env, ["edit", "upscale", "v.mp4"]),
      run(cwd, env, ["edit", "upscale", "v.mp4", "--ffmpeg", "--scale", "4", "-o", "up4.mp4"]),
    ]);

    expect(expectWritten(grade, "grade")).toBe(join(cwd, "v-graded.mp4"));
    expect(videoSize(join(cwd, "v-graded.mp4"))).toBe("320x240");

    expect(expectWritten(reframe, "reframe")).toBe(join(cwd, "v-9x16.mp4"));
    expect(videoSize(join(cwd, "v-9x16.mp4"))).toBe("134x240");
    expect(JSON.parse(reframe.stdout)).toMatchObject({ costUsd: 0, data: { focus: "center", crop: { x: 93, y: 0, width: 134, height: 240 } } });

    expect(expectWritten(square, "reframe 1:1")).toBe(join(cwd, "square.mp4"));
    expect(videoSize(join(cwd, "square.mp4"))).toBe("240x240");
    expect(existsSync(join(cwd, "kf.json"))).toBe(true);

    expect(expectWritten(upscale, "upscale")).toBe(join(cwd, "v-upscaled-2x.mp4"));
    expect(videoSize(join(cwd, "v-upscaled-2x.mp4"))).toBe("640x480");

    expect(expectWritten(legacyFlag, "upscale --ffmpeg")).toBe(join(cwd, "up4.mp4"));
    expect(videoSize(join(cwd, "up4.mp4"))).toBe("1280x960");
  }, 120_000);

  it("analyze-only reports no outputPath and writes nothing", async () => {
    const { cwd, env } = makeWorkspace();
    const result = await run(cwd, env, ["edit", "grade", "v.mp4", "--preset", "vintage", "--analyze-only"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data.outputPath).toBeUndefined();
    expect(existsSync(join(cwd, "v-graded.mp4"))).toBe(false);
  }, 60_000);

  it("the removed Replicate upscale options fail as usage errors before any work", async () => {
    const { cwd, env } = makeWorkspace();
    const result = await run(cwd, env, ["edit", "upscale", "v.mp4", "--model", "real-esrgan"]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({ code: "USAGE_ERROR" });
    expect(existsSync(join(cwd, "v-upscaled-2x.mp4"))).toBe(false);
  }, 60_000);
});
