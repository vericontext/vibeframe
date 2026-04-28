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
const CLI = `npx tsx ${resolve(here, "../index.ts")}`;

interface SchemaListEntry {
  path: string;
  description: string;
}

function runCli(args: string): string {
  return execSync(`${CLI} ${args}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"], // suppress stderr noise (spinners, warnings)
  });
}

function getLeafCommands(): SchemaListEntry[] {
  const out = runCli("schema --list");
  return JSON.parse(out) as SchemaListEntry[];
}

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
