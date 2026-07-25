/**
 * @file error-envelopes.test.ts
 *
 * Contract/drift detection for the CLI's STRUCTURED ERROR envelope — the JSON
 * that `exitWithError()` (commands/output.ts) writes to stderr when a command
 * fails. Companion to `envelope-snapshots.test.ts`, which only covers the
 * SUCCESS envelope (`outputSuccess`) and `--describe` schemas; the error
 * envelope was previously untested.
 *
 * Why:
 * - Agents and MCP hosts parse the error envelope (`code`, `exitCode`,
 *   `retryWith`, `recoverable`) to decide recovery. A regression that renames
 *   or drops a field, or changes a code/exit-code, silently breaks that
 *   contract. Snapshots make it visible in PR review.
 * - This test also guards against fabricated contracts: the real envelope has
 *   no `hint` field and uses SCREAMING_SNAKE codes with no `E_` prefix.
 *
 * The asserted codes/exit-codes were verified by running the built CLI:
 *   NOT_FOUND=3, USAGE_ERROR=2, API_ERROR=5, ERROR=1 (the ExitCode enum in
 *   commands/output.ts).
 *
 * Maintenance:
 * - Intentional envelope change → update with `pnpm -F @vibeframe/cli exec
 *   vitest run -u` and review the diff.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import { rmSync } from "node:fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = `node ${resolve(here, "../../dist/index.js")}`;

// Hermetic env: identical rationale to envelope-snapshots.test.ts. Pass only
// PATH (so `node` resolves) + a fake HOME, and run from /tmp so the CLI's
// loadEnv() can't walk up to the monorepo .env. This makes the API-key-missing
// path deterministic regardless of the host/CI environment.
const HERMETIC_ENV = { PATH: process.env.PATH ?? "", HOME: "/tmp/vibeframe-test-home" };
const HERMETIC_CWD = "/tmp";

interface CliErrorResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI command that is expected to FAIL. Unlike envelope-snapshots'
 * runCli, this captures stderr (where the error envelope is written) and
 * tolerates a non-zero exit (execSync throws — we read status/stdout/stderr
 * off the thrown error).
 */
function runCliExpectError(args: string): CliErrorResult {
  try {
    const stdout = execSync(`${CLI} ${args}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: HERMETIC_ENV,
      cwd: HERMETIC_CWD,
    });
    // Exited 0 — unexpected for these cases; surface it so the test fails loudly.
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: err.status ?? null,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

interface ErrorCase {
  name: string;
  cmd: string;
  code: string;
  exitCode: number;
}

// Each case is a deterministic, no-network invocation. Paths are fixed /tmp
// paths so the `error`/`message` strings are stable across machines.
const cases: ErrorCase[] = [
  {
    name: "edit fade — missing input file (NOT_FOUND)",
    cmd: "edit fade /tmp/nonexistent.mp4 --json",
    code: "NOT_FOUND",
    exitCode: 3,
  },
  {
    name: "edit translate-srt — missing required option (USAGE_ERROR, empty retryWith)",
    cmd: "edit translate-srt /tmp/nonexistent.srt --json",
    code: "USAGE_ERROR",
    exitCode: 2,
  },
  {
    name: "build — invalid --mode (USAGE_ERROR, suggestion + retryWith)",
    cmd: "build /tmp/nonexistent-project --mode bogus --json",
    code: "USAGE_ERROR",
    exitCode: 2,
  },
  {
    name: "generate image — no API key, hermetic (API_ERROR)",
    cmd: 'generate image "a test prompt" -p openai --json',
    code: "API_ERROR",
    exitCode: 5,
  },
];

describe("structured error envelope (exitWithError → stderr)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const res = runCliExpectError(c.cmd);

      // Exit code is part of the contract.
      expect(res.status).toBe(c.exitCode);

      // The envelope is valid JSON on stderr.
      const env = JSON.parse(res.stderr) as Record<string, unknown>;

      // Shape contract — the real StructuredError fields.
      expect(env.success).toBe(false);
      expect(env.code).toBe(c.code);
      expect(env.exitCode).toBe(c.exitCode);
      expect(typeof env.error).toBe("string");
      expect(typeof env.message).toBe("string");
      expect(typeof env.retryable).toBe("boolean");
      expect(typeof env.recoverable).toBe("boolean");
      expect(Array.isArray(env.retryWith)).toBe(true);

      // Regression guard against a fabricated field — the real envelope has
      // no `hint`.
      expect(env).not.toHaveProperty("hint");

      // Lock the full envelope shape (codes are stable; /tmp paths keep
      // messages deterministic).
      expect(env).toMatchSnapshot();
    });
  }
});

describe("--max-cost refusal (COST_CAP_EXCEEDED)", () => {
  // This contract had no test, which is why it drifted: the gate used to emit
  // a *success* envelope carrying a warning (exit 1, fields buried under
  // `data`), while README and vibeframe.ai documented an error envelope. On
  // top of that, `plan` reported COST_CAP_EXCEEDED/exit 1 under --json but
  // USAGE_ERROR/exit 2 without it - two contracts for one condition,
  // switched by a formatting flag.
  //
  // Build a throwaway project so the estimate is non-zero, then cap below it.
  const projectDir = "/tmp/vibeframe-costcap-fixture";

  function run(cmd: string): CliErrorResult {
    return runCliExpectError(cmd);
  }

  beforeAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
    execSync(`${CLI} init ${projectDir} --from "a 30 second test video" --json`, {
      encoding: "utf-8",
      stdio: "ignore",
      env: HERMETIC_ENV,
      cwd: HERMETIC_CWD,
    });
  });

  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  for (const cmd of [
    `build ${projectDir} --dry-run --max-cost 0.01 --json`,
    `plan ${projectDir} --max-cost 0.01 --json`,
  ]) {
    it(`${cmd.split(" ")[0]} refuses on stderr with the standard error envelope`, () => {
      const res = run(cmd);

      // Refusal is a failure: exit 1, nothing on stdout, envelope on stderr.
      expect(res.status).toBe(1);
      expect(res.stdout.trim()).toBe("");

      const env = JSON.parse(res.stderr) as Record<string, unknown>;
      expect(env.success).toBe(false);
      expect(env.code).toBe("COST_CAP_EXCEEDED");
      expect(env.exitCode).toBe(1);
      expect(env.recoverable).toBe(true);
      expect(typeof env.error).toBe("string");
      expect(env.suggestion).toBe("Raise --max-cost or reduce the stage/provider scope.");

      // retryWith must offer a real way forward, including raising the cap to
      // the actual estimate.
      const retryWith = env.retryWith as string[];
      expect(Array.isArray(retryWith)).toBe(true);
      expect(retryWith.some((r) => r.includes("--max-cost"))).toBe(true);

      // The priced plan rides along, so a refused caller does not have to make
      // a second call to learn what it would have cost.
      const data = env.data as Record<string, unknown>;
      expect(data).toBeDefined();
      expect(typeof data.costCapUsd).toBe("number");

      // The old shape must not come back.
      expect(env).not.toHaveProperty("warnings");
    });
  }

  it("plan reports the same code and exit status with and without --json", () => {
    const json = run(`plan ${projectDir} --max-cost 0.01 --json`);
    const plain = run(`plan ${projectDir} --max-cost 0.01`);
    expect(plain.status).toBe(json.status);
    // Non-TTY stdout auto-enables JSON, so both emit the envelope; the point
    // is that neither downgrades to USAGE_ERROR/exit 2.
    expect(JSON.parse(plain.stderr).code).toBe("COST_CAP_EXCEEDED");
  });
});

describe("structured error envelope — catch-all code", () => {
  // A non-framework failure (ffprobe on a missing file) still produces a valid
  // envelope with the generic ERROR(1) code. Message embeds tool output, so we
  // assert the contract fields but do not snapshot it.
  it("detect scenes — wraps an unexpected failure as ERROR(1)", () => {
    const res = runCliExpectError("detect scenes /tmp/nonexistent.mp4 --json");
    expect(res.status).toBe(1);
    const env = JSON.parse(res.stderr) as Record<string, unknown>;
    expect(env.success).toBe(false);
    expect(env.code).toBe("ERROR");
    expect(env.exitCode).toBe(1);
    expect(typeof env.error).toBe("string");
    expect(env).not.toHaveProperty("hint");
  });
});
