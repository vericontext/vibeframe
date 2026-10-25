/**
 * `vibe run` end to end: every catalog action has a handler, an unknown
 * action is refused before any step runs, and a failed step makes the run
 * exit non-zero. Spawns the built CLI from a temp directory with no keys in
 * reach; every step here is a free FFmpeg path.
 */

import { describe, expect, it } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "vibe-run-cli-")));
  const home = mkdtempSync(join(tmpdir(), "vibe-run-cli-home-"));
  const made = spawnSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
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
      { cwd, env, encoding: "utf-8", timeout: 120_000 },
      (_error, stdout, stderr) => resolveRun({ code: child.exitCode, stdout, stderr })
    );
    child.stdin?.end();
  });
}

function duration(path: string): number {
  return Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf-8" }).stdout);
}

function pipeline(cwd: string, steps: string): string {
  writeFileSync(join(cwd, "p.yaml"), `name: t\nsteps:\n${steps}`);
  return "p.yaml";
}

describe.skipIf(!hasFfmpeg)("vibe run", () => {
  it("edit-interpolate runs the same executor as `vibe edit interpolate`", async () => {
    const { cwd, env } = makeWorkspace();
    const file = pipeline(cwd, "  - id: slow\n    action: edit-interpolate\n    input: v.mp4\n    factor: 2\n    mode: fast\n");
    const [piped, direct] = await Promise.all([
      run(cwd, env, ["run", file]),
      run(cwd, env, ["edit", "interpolate", "v.mp4", "--mode", "fast"]),
    ]);

    expect({ code: piped.code, stderr: piped.stderr }).toEqual({ code: 0, stderr: "" });
    const step = JSON.parse(piped.stdout).data.steps[0];
    expect(step).toMatchObject({ id: "slow", success: true, data: { originalFps: 10, targetFps: 20, factor: 2 } });
    expect(step.output).toBe(join(cwd, "t-output", "slow-motion.mp4"));
    expect(duration(step.output)).toBeCloseTo(2, 0);

    expect({ code: direct.code, stderr: direct.stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(direct.stdout).data.outputPath).toBe(join(cwd, "v-slow2x.mp4"));
    expect(duration(join(cwd, "v-slow2x.mp4"))).toBeCloseTo(2, 0);
  }, 180_000);

  it("refuses an unknown action as a usage error before any step runs", async () => {
    const { cwd, env } = makeWorkspace();
    const file = pipeline(
      cwd,
      "  - id: fade\n    action: edit-fade\n    input: v.mp4\n  - id: old\n    action: export\n",
    );
    const result = await run(cwd, env, ["run", file]);
    expect(result.code).toBe(2);
    const error = JSON.parse(result.stderr);
    expect(error).toMatchObject({ code: "USAGE_ERROR" });
    expect(error.error).toContain("Step 'old' has unknown action 'export'");
    expect(existsSync(join(cwd, "t-output"))).toBe(false);
  }, 60_000);

  it("a failed step makes the run exit 1 with the step report attached", async () => {
    const { cwd, env } = makeWorkspace();
    const file = pipeline(
      cwd,
      "  - id: ok\n    action: edit-fade\n    input: v.mp4\n  - id: bad\n    action: edit-fade\n    input: missing.mp4\n",
    );
    const result = await run(cwd, env, ["run", file]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    const error = JSON.parse(result.stderr);
    expect(error).toMatchObject({
      success: false,
      code: "ERROR",
      retryWith: [`vibe run ${file} --resume`],
      data: { completedSteps: 1, totalSteps: 2 },
    });
    expect(error.data.steps.map((s: { id: string; success: boolean }) => [s.id, s.success])).toEqual([["ok", true], ["bad", false]]);
  }, 120_000);
});
