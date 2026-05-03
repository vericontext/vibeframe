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

function runDoctor(cwd = projectDir): { json: ReturnType<typeof JSON.parse>; stderr: string } {
  const out = execFileSync(process.execPath, [CLI, "doctor", "--json"], {
    cwd,
    env: testEnv({ PATH: "/usr/bin:/bin" }),
    encoding: "utf-8",
  });
  return { json: JSON.parse(out), stderr: "" };
}

function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fakeHome,
    VIBEFRAME_CONFIG_HOME: join(fakeHome, ".vibeframe"),
    VIBEFRAME_CACHE_HOME: join(fakeHome, ".vibeframe", "cache"),
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    XDG_CACHE_HOME: join(fakeHome, ".cache"),
    XDG_DATA_HOME: join(fakeHome, ".local", "share"),
    NO_COLOR: "1",
    ...extra,
  };
}

describe("vibe doctor — scope diagnostics", () => {
  it("reports user scope unconfigured + project uninitialized in a fresh environment", () => {
    const { json } = runDoctor();
    const scope = json.data.scope;

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
    expect(json.data.scope.project.initialized).toBe(true);

    const agents = json.data.scope.project.files.find(
      (f: { path: string }) => f.path === "AGENTS.md"
    );
    expect(agents.exists).toBe(true);
  });

  it("flips user.configured=true when ~/.vibeframe/config.yaml exists", () => {
    mkdirSync(join(fakeHome, ".vibeframe"));
    writeFileSync(join(fakeHome, ".vibeframe", "config.yaml"), "providers: {}\n");
    const { json } = runDoctor();
    expect(json.data.scope.user.configured).toBe(true);
    expect(json.data.scope.user.configPath).toContain(".vibeframe");
    expect(json.data.scope.user.source).toBe("user");
  });

  it("agentHosts.detected is empty in a sterilised environment", () => {
    const { json } = runDoctor();
    expect(json.data.scope.agentHosts.detected).toEqual([]);
    expect(json.data.scope.agentHosts.summary).toBe("(none detected)");
  });

  it("agentHosts.detected picks up Claude Code via ~/.claude config dir", () => {
    mkdirSync(join(fakeHome, ".claude"));
    const { json } = runDoctor();
    expect(json.data.scope.agentHosts.detected).toContain("Claude Code");
  });

  it("activeScope is 'user' by default and 'project' when ./.vibeframe/config.yaml exists", () => {
    let { json } = runDoctor();
    expect(json.data.scope.activeScope).toBe("user");
    expect(json.data.scope.project.configFileExists).toBe(false);
    expect(json.data.scope.project.configPath).toContain(".vibeframe");

    mkdirSync(join(projectDir, ".vibeframe"));
    writeFileSync(join(projectDir, ".vibeframe", "config.yaml"), "providers: {}\n");

    ({ json } = runDoctor());
    expect(json.data.scope.activeScope).toBe("project");
    expect(json.data.scope.project.configFileExists).toBe(true);
  });

  it("reports provider keys configured from project config.yaml", () => {
    mkdirSync(join(projectDir, ".vibeframe"));
    writeFileSync(
      join(projectDir, ".vibeframe", "config.yaml"),
      "providers:\n  openai: project-openai\n"
    );

    const { json } = runDoctor();
    expect(json.data.providers.openai.configured).toBe(true);
  });

  it("finds project config from a parent directory when run inside a scene project", () => {
    mkdirSync(join(projectDir, ".vibeframe"));
    writeFileSync(
      join(projectDir, ".vibeframe", "config.yaml"),
      "providers:\n  openai: project-openai\n"
    );
    const sceneDir = join(projectDir, "launch");
    mkdirSync(sceneDir);
    writeFileSync(join(sceneDir, "CLAUDE.md"), "# launch\n");
    writeFileSync(join(sceneDir, "vibe.project.yaml"), "name: launch\n");

    const { json } = runDoctor(sceneDir);
    expect(json.data.scope.activeScope).toBe("project");
    expect(json.data.scope.project.configFileExists).toBe(true);
    expect(json.data.scope.project.configPath).toContain("vibe-doctor-test-");
    expect(json.data.scope.project.configPath).toMatch(/\.vibeframe[\\/]config\.yaml$/);
    expect(json.data.providers.openai.configured).toBe(true);
  });
});

describe("vibe doctor — Plan H scene composer readiness", () => {
  it("reports recommendedMode=batch when no agent host is detected", () => {
    const { json } = runDoctor();
    const sc = json.data.scope.sceneComposer;
    expect(sc.recommendedMode).toBe("batch");
    expect(sc.sceneProjectInCwd).toBe(false);
    expect(sc.skillInstalled).toBe(false);
  });

  it("flips recommendedMode=agent when ~/.claude is present", () => {
    mkdirSync(join(fakeHome, ".claude"));
    const { json } = runDoctor();
    expect(json.data.scope.sceneComposer.recommendedMode).toBe("agent");
  });

  it("VIBE_BUILD_MODE env override beats host auto-detection", () => {
    mkdirSync(join(fakeHome, ".claude"));
    const out = execFileSync(process.execPath, [CLI, "doctor", "--json"], {
      cwd: projectDir,
      env: testEnv({ PATH: "/usr/bin:/bin", VIBE_BUILD_MODE: "batch" }),
      encoding: "utf-8",
    });
    const json = JSON.parse(out);
    expect(json.data.scope.sceneComposer.recommendedMode).toBe("batch");
  });

  it("composer=null when no API keys are present", () => {
    const out = execFileSync(process.execPath, [CLI, "doctor", "--json"], {
      cwd: projectDir,
      env: testEnv({
        // Sterilise — drop every composer key so resolveComposer fails cleanly.
        PATH: "/usr/bin:/bin",
      }),
      encoding: "utf-8",
    });
    const json = JSON.parse(out);
    expect(json.data.scope.sceneComposer.composer).toBeNull();
    expect(json.data.scope.sceneComposer.composerEnvVar).toBeNull();
  });

  it("flags scene project + missing SKILL.md when STORYBOARD.md is in cwd", () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), "## Beat 1 — x\nbody\n");
    const { json } = runDoctor();
    expect(json.data.scope.sceneComposer.sceneProjectInCwd).toBe(true);
    expect(json.data.scope.sceneComposer.skillInstalled).toBe(false);
  });

  it("flips skillInstalled=true once SKILL.md is in the project", () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), "## Beat 1 — x\nbody\n");
    writeFileSync(join(projectDir, "SKILL.md"), "---\nname: hyperframes\n---\n");
    const { json } = runDoctor();
    expect(json.data.scope.sceneComposer.sceneProjectInCwd).toBe(true);
    expect(json.data.scope.sceneComposer.skillInstalled).toBe(true);
  });
});
