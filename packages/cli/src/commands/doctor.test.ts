/**
 * Black-box tests for `vibe doctor` v0.61 scope diagnostics. Spawns the
 * CLI binary with a clean $HOME and a fresh cwd so we know exactly what
 * the scope status should be.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

let projectDir: string;
let fakeHome: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-doctor-test-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vibe-doctor-home-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

function runDoctor(): { json: ReturnType<typeof JSON.parse>; stderr: string } {
  const out = execFileSync(
    process.execPath,
    [CLI, "doctor", "--json"],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: "/usr/bin:/bin",
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    },
  );
  return { json: JSON.parse(out), stderr: "" };
}

describe("vibe doctor — scope diagnostics", () => {
  it("reports user scope unconfigured + project uninitialized in a fresh environment", () => {
    const { json } = runDoctor();
    const scope = json.result.scope;

    expect(scope.user.configured).toBe(false);
    expect(scope.project.initialized).toBe(false);
    expect(scope.project.files).toHaveLength(3);
    expect(scope.project.files.map((f: { path: string }) => f.path).sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "vibe.project.yaml",
    ]);
    expect(scope.project.files.every((f: { exists: boolean }) => !f.exists)).toBe(true);
  });

  it("flips project.initialized=true when AGENTS.md is present", () => {
    writeFileSync(join(projectDir, "AGENTS.md"), "# AGENTS\n");
    const { json } = runDoctor();
    expect(json.result.scope.project.initialized).toBe(true);

    const agents = json.result.scope.project.files.find((f: { path: string }) => f.path === "AGENTS.md");
    expect(agents.exists).toBe(true);
  });

  it("flips user.configured=true when ~/.vibeframe/config.yaml exists", () => {
    mkdirSync(join(fakeHome, ".vibeframe"));
    writeFileSync(join(fakeHome, ".vibeframe", "config.yaml"), "providers: {}\n");
    const { json } = runDoctor();
    expect(json.result.scope.user.configured).toBe(true);
    expect(json.result.scope.user.configPath).toContain(".vibeframe");
  });

  it("agentHosts.detected is empty in a sterilised environment", () => {
    const { json } = runDoctor();
    expect(json.result.scope.agentHosts.detected).toEqual([]);
    expect(json.result.scope.agentHosts.summary).toBe("(none detected)");
  });

  it("agentHosts.detected picks up Claude Code via ~/.claude config dir", () => {
    mkdirSync(join(fakeHome, ".claude"));
    const { json } = runDoctor();
    expect(json.result.scope.agentHosts.detected).toContain("Claude Code");
  });
});
