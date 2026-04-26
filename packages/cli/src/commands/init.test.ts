/**
 * Black-box smoke tests for `vibe init`. Spawns the built CLI binary in
 * a temp dir so the agent-host detection sees a clean $HOME and doesn't
 * accidentally pick up the developer's local Claude install.
 *
 * The point of testing the registered command (rather than calling
 * action() directly) is to catch wiring regressions: missing
 * registration, broken arg parsing, malformed JSON output.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

let projectDir: string;
let fakeHome: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-init-test-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vibe-init-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

function runInit(args: string[] = []): { stdout: string; stderr: string } {
  try {
    const out = execFileSync(
      process.execPath,
      [CLI, "init", projectDir, ...args, "--json"],
      {
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: "/usr/bin:/bin",  // strip developer-local agent binaries
          NO_COLOR: "1",
        },
        encoding: "utf-8",
      },
    );
    return { stdout: out, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("vibe init (black-box)", () => {
  it("scaffolds AGENTS.md / .env.example / .gitignore / vibe.project.yaml in a fresh dir with --agent all", () => {
    const { stdout } = runInit(["--agent", "all"]);
    const result = JSON.parse(stdout);

    expect(result.command).toBe("init");
    expect(result.actions.every((a: { status: string }) => a.status === "wrote")).toBe(true);

    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(projectDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".env.example"))).toBe(true);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(projectDir, "vibe.project.yaml"))).toBe(true);

    // CLAUDE.md imports AGENTS.md so they stay single-sourced.
    expect(readFileSync(join(projectDir, "CLAUDE.md"), "utf-8")).toContain("@AGENTS.md");

    // vibe.project.yaml uses the directory basename as the project name.
    const yaml = readFileSync(join(projectDir, "vibe.project.yaml"), "utf-8");
    expect(yaml).toMatch(/^name: vibe-init-test-/m);
  });

  it("is idempotent — second run skips existing files (--force overwrites)", () => {
    runInit(["--agent", "all"]);
    const { stdout } = runInit(["--agent", "all"]);
    const result = JSON.parse(stdout);

    const skipped = result.actions.filter((a: { status: string }) => a.status === "skipped-exists");
    expect(skipped.length).toBeGreaterThan(0);
    expect(result.actions.every((a: { status: string }) => a.status !== "wrote")).toBe(true);
  });

  it("with --agent claude-code writes CLAUDE.md but skips AGENTS.md (Claude-only mode)", () => {
    const { stdout } = runInit(["--agent", "claude-code"]);
    const result = JSON.parse(stdout);

    const paths = result.actions.map((a: { path: string }) => a.path);
    expect(paths.some((p: string) => p.endsWith("CLAUDE.md"))).toBe(true);
    expect(paths.some((p: string) => p.endsWith("AGENTS.md"))).toBe(false);
  });

  it("with --agent codex writes AGENTS.md but skips CLAUDE.md (cross-tool only)", () => {
    const { stdout } = runInit(["--agent", "codex"]);
    const result = JSON.parse(stdout);

    const paths = result.actions.map((a: { path: string }) => a.path);
    expect(paths.some((p: string) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(paths.some((p: string) => p.endsWith("CLAUDE.md"))).toBe(false);
  });

  it("with --agent auto and no detected hosts, falls back to AGENTS.md (safe default)", () => {
    // Fake $HOME has no .claude / .codex / .cursor — and PATH is stripped.
    const { stdout } = runInit(["--agent", "auto"]);
    const result = JSON.parse(stdout);

    const paths = result.actions.map((a: { path: string }) => a.path);
    expect(paths.some((p: string) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(result.targetHosts).toEqual([]);
  });

  it("merges .gitignore additions instead of overwriting an existing file", () => {
    writeFileSync(join(projectDir, ".gitignore"), "node_modules/\ndist/\n");
    runInit(["--agent", "all"]);

    const merged = readFileSync(join(projectDir, ".gitignore"), "utf-8");
    expect(merged).toContain("node_modules/");
    expect(merged).toContain("# VibeFrame");
    expect(merged).toContain(".env");
    expect(merged).toContain("renders/");
  });

  it("--dry-run emits would-write actions and creates no files", () => {
    const { stdout } = runInit(["--agent", "all", "--dry-run"]);
    const result = JSON.parse(stdout);

    expect(result.dryRun).toBe(true);
    expect(result.actions.every((a: { status: string }) => a.status === "would-write")).toBe(true);
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
  });

  it("rejects invalid --agent values", () => {
    const { stderr } = runInit(["--agent", "bogus"]);
    expect(stderr).toMatch(/Invalid --agent: bogus/);
  });
});
