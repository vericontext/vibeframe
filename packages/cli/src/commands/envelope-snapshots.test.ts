/**
 * @file envelope-snapshots.test.ts
 *
 * Drift detection for Issue #33's CLI UX standardization. Snapshots:
 *   1. The JSON Schema returned by `vibe <cmd> --describe` for every
 *      leaf command (catches schema/option/argument drift).
 *   2. The `--dry-run --json` envelope shape for representative
 *      commands across the major groups (catches success-envelope
 *      drift — keys moved, renamed, removed).
 *
 * Why:
 * - The new `outputSuccess()` envelope (#194-#199, v0.72.0) is now load-bearing.
 *   Every agent / MCP host parses `data.X` not `X`. A regression that
 *   re-flattens or renames keys would silently break agent integrations.
 *   Snapshots make the regression visible in PR review.
 * - `--describe` is the agent's discovery channel for parameters. Drift
 *   in option descriptions / enum hints / argument shapes invalidates
 *   prompts that were written against the old schema.
 *
 * Normalization:
 * - `elapsedMs` is replaced with `<elapsedMs>` before snapshotting (it
 *   varies per run). Other fields are kept verbatim.
 * - Cost-estimate-driven `costUsd` is stable per command and not normalized.
 *
 * Maintenance:
 * - When a snapshot diff is INTENTIONAL (e.g. you renamed a key on
 *   purpose), run with `-u` (`pnpm -F @vibeframe/cli exec vitest run -u`)
 *   to update the snapshot file, then review the diff.
 * - When a snapshot diff is UNINTENTIONAL, the test names will tell
 *   you which command and which channel (--describe vs --dry-run).
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = `node ${resolve(here, "../../dist/index.js")}`;

interface SchemaListEntry {
  path: string;
  description: string;
  surface: string;
  replacement?: string;
}

// Hermetic env: snapshot tests must not depend on dev-only API keys leaking
// in via the monorepo .env (which the CLI's loadEnv() walks up to find).
// 1. Pass only PATH so `node` resolves; fake HOME so user config isn't read.
// 2. Run from a temp cwd outside the monorepo so loadEnv() can't find a
//    pnpm-workspace.yaml ancestor → no .env auto-load → keys are truly absent.
const HERMETIC_ENV = { PATH: process.env.PATH ?? "", HOME: "/tmp/vibeframe-test-home" };
const HERMETIC_CWD = "/tmp";

function runCli(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"], // suppress stderr noise (spinners, warnings)
    env: HERMETIC_ENV,
    cwd: HERMETIC_CWD,
  });
}

function getLeafCommands(): SchemaListEntry[] {
  const out = runCli("schema --list");
  return JSON.parse(out) as SchemaListEntry[];
}

describe("schema product surface taxonomy", () => {
  it("adds surface metadata to every listed command", () => {
    const leaves = getLeafCommands();
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((leaf) => typeof leaf.surface === "string")).toBe(true);
    expect(leaves.find((leaf) => leaf.path === "generate.speech")).toMatchObject({
      surface: "legacy",
      replacement: "vibe generate narration",
    });
  });

  it("filters schema --list by product surface", () => {
    const out = runCli("schema --list --surface public");
    const leaves = JSON.parse(out) as SchemaListEntry[];
    expect(leaves.length).toBeGreaterThan(0);
    expect(leaves.every((leaf) => leaf.surface === "public")).toBe(true);
    expect(leaves.map((leaf) => leaf.path)).toContain("build");
    expect(leaves.map((leaf) => leaf.path)).not.toContain("generate.speech");
  });
});

describe("CLI help product surface taxonomy", () => {
  it("prints root help without leaking Commander help exceptions", () => {
    const help = runCli("");
    expect(help).toContain("Usage: vibe [options] [command]");
    expect(help).not.toContain("CommanderError");
    expect(help).not.toContain("at _Command._exit");
  });

  it("supports version as a command alias for the --version option", () => {
    const optionVersion = runCli("--version").trim();
    const commandVersion = runCli("version").trim();
    expect(commandVersion).toBe(optionVersion);
    expect(commandVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("keeps legacy/internal commands out of root cost examples", () => {
    const help = runCli("--help");
    const footer = help.slice(help.indexOf("Cost tiers"));
    expect(footer).toContain("generate.narration");
    expect(footer).not.toContain("generate.speech");
    expect(footer).not.toContain("generate.storyboard");
    expect(footer).not.toContain("generate.music-status");
    expect(footer).not.toContain("generate.video-cancel");
    expect(footer).not.toContain("scene.compose-prompts");
  });

  it("keeps generate help focused on public primitives with legacy replacements", () => {
    const help = runCli("generate --help");
    expect(help).toContain("narration|voiceover");
    expect(help).not.toMatch(/\n\s+speech\|tts\b/);
    expect(help).not.toMatch(/\n\s+storyboard\s+\[options\]/);
    expect(help).not.toMatch(/\n\s+background\s+\[options\]/);
    expect(help).toContain("generate speech       Legacy alias; use 'vibe generate narration'");
    expect(help).toContain("generate storyboard   Legacy primitive; use 'vibe init --from'");
  });

  it("keeps inspect help focused on project/render/media with replacements", () => {
    const help = runCli("inspect --help");
    expect(help).toContain("project [options]");
    expect(help).toContain("render [options]");
    expect(help).toContain("media [options]");
    expect(help).not.toMatch(/\n\s+video\s+\[options\]/);
    expect(help).not.toMatch(/\n\s+review\s+\[options\]/);
    expect(help).toContain("inspect video    Legacy alias; use 'vibe inspect media'");
    expect(help).toContain("inspect review   Legacy render review; use 'vibe inspect render --ai'");
  });

  it("keeps remix help focused on repurposing and points regeneration to build", () => {
    const help = runCli("remix --help");
    expect(help).toContain("highlights [options]");
    expect(help).toContain("auto-shorts|shorts");
    expect(help).toContain("animated-caption [options]");
    expect(help).not.toMatch(/\n\s+regenerate-scene\s+\[options\]/);
    expect(help).toContain(
      "remix regenerate-scene  Use 'vibe build <project> --beat <id> --force --json'"
    );
  });
});

/** Replace varying fields so snapshots are deterministic. */
function normalizeEnvelope(json: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  if (typeof clone.elapsedMs === "number") clone.elapsedMs = "<elapsedMs>";
  return clone;
}

// ── 1. --describe snapshots for every leaf command ────────────────────────

describe("CLI --describe schemas (drift detection)", () => {
  const leaves = getLeafCommands();

  for (const leaf of leaves) {
    it(`vibe ${leaf.path.replace(/\./g, " ")} --describe`, () => {
      const cmdParts = leaf.path.replace(/\./g, " ");
      const out = runCli(`${cmdParts} --describe`);
      const schema = JSON.parse(out);
      expect(schema).toMatchSnapshot();
    });
  }
});

// ── 2. --dry-run --json envelope snapshots (representative slice) ─────────
//
// Hand-picked: one command per major group, exercising both free + paid
// tiers and dry-run + non-dry-run path conventions. We intentionally
// don't snapshot every command's dry-run output — that would require
// per-command fixtures and would catch the same shape drift as the
// helper-level snapshot below. The list here is the canary set: if the
// envelope shape regresses, these will trip first.

describe("envelope shape (--dry-run --json)", () => {
  // Each entry: a deterministic invocation that doesn't touch the
  // network or filesystem (beyond the ephemeral fixture), with stable
  // output keys. Args are chosen to avoid "missing required arg"
  // exits and to keep cost estimates pinned.

  // Cases that don't require a real input file on disk (dry-run path
  // runs *before* file validation). Edit/audio commands are skipped
  // here — their dry-run check follows file existence validation, so
  // they need a fixture; the envelope shape is already covered by the
  // generate.* samples below (same outputSuccess helper).
  const cases: Array<{ name: string; cmd: string }> = [
    {
      name: "detect scenes (free, basic)",
      cmd: "detect scenes /tmp/nonexistent.mp4 --dry-run --json",
    },
    {
      name: "generate image (low cost, OpenAI default)",
      cmd: 'generate image "test prompt" --dry-run --json -p openai',
    },
    {
      name: "generate video (high cost, async)",
      cmd: 'generate video "test" --dry-run --json',
    },
    {
      name: "generate speech (medium cost)",
      cmd: 'generate speech "hello" --dry-run --json',
    },
    {
      name: "generate background (low cost)",
      cmd: 'generate background "sunset over ocean" --dry-run --json',
    },
    {
      name: "inspect render AI (low cost, dry-run)",
      cmd: "inspect render /tmp/nonexistent-project --ai --dry-run --json",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = runCli(c.cmd);
      const json = JSON.parse(out);
      const normalized = normalizeEnvelope(json);
      expect(normalized).toMatchSnapshot();
    });
  }
});
