/**
 * In `--json` mode stdout is one machine-readable document and nothing else:
 * an agent pipes it straight into `JSON.parse`. Human lines (banners,
 * summary tables, "Saved to:" notes) used to leak onto stdout from commands
 * that forgot to gate a `console.log`, e.g. `vibe remix highlights --json`
 * printed "🎬 Highlight Extraction Pipeline" ahead of anything parseable.
 *
 * Spawns the built CLI from a temp directory with an empty HOME and no
 * provider keys, so nothing here can reach a paid provider.
 */

import { beforeAll, describe, expect, it } from "vitest";
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

let cwd = "";
let env: NodeJS.ProcessEnv = {};

function run(args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, env: { ...env, ...extraEnv }, encoding: "utf-8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
      (_error, stdout, stderr) => resolveRun({ code: child.exitCode, stdout, stderr })
    );
    child.stdin?.end();
  });
}

/** Parse `text` as exactly one JSON document, or explain why it is not one. */
function parseOne(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not a single JSON document:\n${text.slice(0, 2000)}`);
  }
}

/**
 * The `--json` contract: stdout is empty or exactly one JSON document, and
 * so is stderr. A success always prints its envelope; a failure prints its
 * error envelope on stderr, or a report envelope on stdout (`inspect`,
 * `render`, and `build` exit non-zero with a full report).
 */
function expectJsonContract(label: string, result: Run): void {
  if (result.code === 0) {
    expect(result.stdout.trim(), `${label}: exit 0 with an empty stdout`).not.toBe("");
  }
  if (result.stdout.trim() !== "") parseOne(result.stdout, `${label} stdout`);
  if (result.stderr.trim() !== "") parseOne(result.stderr, `${label} stderr`);
}

/** A plausible value for a required positional, picked by its name. */
function fillArgument(name: string): string {
  if (/audio/.test(name)) return "a.wav";
  if (/srt|subtitle/.test(name)) return "s.srt";
  if (/image/.test(name)) return "i.png";
  if (/video|media|input|source|file|clip/.test(name)) return "v.mp4";
  if (/project|dir/.test(name)) return "proj";
  return "test";
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), "vibe-json-purity-"));
  const home = mkdtempSync(join(tmpdir(), "vibe-json-purity-home-"));
  env = { PATH: process.env.PATH ?? "", HOME: home, VIBE_NO_DOTENV: "1" };
  writeFileSync(join(cwd, "s.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhello\n");
  if (hasFfmpeg) {
    const make = (args: string[]) =>
      spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd, stdio: "ignore" });
    make(["-f", "lavfi", "-i", "testsrc=d=2:s=160x120", "-f", "lavfi", "-i", "sine=d=2", "-shortest", "v.mp4"]);
    make(["-i", "v.mp4", "-vn", "a.wav"]);
    make(["-i", "v.mp4", "-frames:v", "1", "i.png"]);
  } else {
    // Only existence is checked before the commands below fail.
    writeFileSync(join(cwd, "v.mp4"), "not really a video");
    writeFileSync(join(cwd, "a.wav"), "not really audio");
    writeFileSync(join(cwd, "i.png"), "not really an image");
  }
});

describe("--json keeps human output off stdout", () => {
  // Each printed a banner on stdout before failing on the missing key.
  it.each(
    [
      ["remix", "highlights", "v.mp4"],
      ["remix", "highlights", "v.mp4", "--use-gemini"],
      ["remix", "auto-shorts", "v.mp4"],
      ["remix", "auto-shorts", "v.mp4", "--use-gemini"],
      ["remix", "animated-caption", "v.mp4"],
    ].map((args) => ({ args, name: args.join(" ") }))
  )("vibe $name --json", async ({ args, name }) => {
    const result = await run([...args, "--json"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expectJsonContract(name, result);
  });

  // Each printed only a human table on success, with no envelope at all.
  it.skipIf(!hasFfmpeg).each([
    { args: ["detect", "scenes", "v.mp4"], command: "detect scenes", key: "scenes" },
    { args: ["detect", "silence", "a.wav"], command: "detect silence", key: "silences" },
    { args: ["detect", "beats", "a.wav"], command: "detect beats", key: "beats" },
    { args: ["media", "info", "v.mp4"], command: "media info", key: "format" },
  ])("vibe $command prints its envelope and nothing else", async ({ args, command, key }) => {
    const result = await run([...args, "--json"]);
    expect(result.code, result.stderr).toBe(0);
    const envelope = parseOne(result.stdout, `${command} stdout`) as Record<string, unknown>;
    expect(envelope).toMatchObject({ command, warnings: [] });
    expect(envelope.data).toHaveProperty(key);
  });

  it.skipIf(!hasFfmpeg)("a piped stdout (auto JSON mode) gets the envelope too", async () => {
    const result = await run(["detect", "scenes", "v.mp4"]);
    expect(result.code, result.stderr).toBe(0);
    expect(parseOne(result.stdout, "detect scenes stdout")).toMatchObject({ command: "detect scenes" });
  });

  it.skipIf(!hasFfmpeg)("--quiet prints only the primary value", async () => {
    // A piped stdout would switch on JSON mode, which outranks --quiet.
    const result = await run(["detect", "scenes", "v.mp4", "-o", "scenes.json", "-q"], { VIBE_HUMAN_OUTPUT: "1" });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^\/\S+\/scenes\.json\n$/);
  });

  it("text products still reach stdout when it is piped", async () => {
    const completion = await run(["completion", "zsh"]);
    expect(completion.stdout).toMatch(/^#compdef vibe/);
    const context = await run(["context"]);
    expect(context.stdout).toMatch(/^# VibeFrame/);
  });
});

// Spawns the CLI twice per command (~30s), so it runs with the integration
// suite (`pnpm test:integration`, and CI) rather than every `pnpm test`.
describe.skipIf(!process.env.VIBE_TEST_INTEGRATION)("--json stdout is one document for every command", () => {
  it("holds across the whole command tree", async () => {
    const list = await run(["schema", "--list", "--json"]);
    const paths = (parseOne(list.stdout, "schema --list") as Array<{ path: string }>).map((c) => c.path);
    expect(paths.length).toBeGreaterThan(50);

    const failures: string[] = [];
    const queue = [...paths];
    const worker = async () => {
      for (let path = queue.shift(); path; path = queue.shift()) {
        const command = path.split(".");
        // Commander's usage line names the required positionals: `<video>`.
        const help = await run([...command, "--help"], { VIBE_HUMAN_OUTPUT: "1" });
        const usage = help.stdout.split("\n").find((line) => line.startsWith("Usage:")) ?? "";
        const positionals = [...usage.matchAll(/<([^>.]+)(?:\.\.\.)?>/g)].map((m) => fillArgument(m[1]));
        const label = `vibe ${[...command, ...positionals].join(" ")} --json`;
        try {
          expectJsonContract(label, await run([...command, ...positionals, "--json"]));
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    expect(failures).toEqual([]);
  }, 600_000);
});
