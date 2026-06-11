import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyWorkspaceEnv,
  buildServerInstructions,
  ensureSystemPath,
  resolveServerWorkspaceRoot,
  scrubUnresolvedUserConfigEnv,
} from "./instructions.js";

describe("MCP server instructions", () => {
  it("announces the configured workspace root and path rules", () => {
    const instructions = buildServerInstructions("/Users/example/video-workspace");

    expect(instructions).toContain("VibeFrame MCP workspace root: /Users/example/video-workspace");
    expect(instructions).toContain("workspace-relative paths");
    expect(instructions).toContain("Do not create projects in /tmp");
    expect(instructions).toContain("/home/claude");
    expect(instructions).toContain("dry-run or plan");
  });

  it("tells the host agent to surface unspecified build choices to the user", () => {
    const instructions = buildServerInstructions("/Users/example/video-workspace");

    expect(instructions).toContain("ask the user before building");
    expect(instructions).toContain("kokoro = free local");
    expect(instructions).toContain("backdrop image generation");
    expect(instructions).toContain("scene_list_styles");
  });

  it("uses INIT_CWD when npm or npx launched the server from a workspace", () => {
    expect(
      resolveServerWorkspaceRoot({ INIT_CWD: "/Users/example/mcp-workspace" }, "/private/tmp/npm-exec")
    ).toBe("/Users/example/mcp-workspace");
  });

  it("resolves relative INIT_CWD values against the process cwd", () => {
    expect(resolveServerWorkspaceRoot({ INIT_CWD: "video-workspace" }, "/Users/example")).toBe(
      "/Users/example/video-workspace"
    );
  });
});

describe("applyWorkspaceEnv", () => {
  // process.chdir() is unsupported inside vitest workers, so a recording
  // stub stands in for it.
  let tempDir: string;
  let chdirCalls: string[];
  const chdir = (dir: string) => {
    chdirCalls.push(dir);
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vibe-mcpb-ws-"));
    chdirCalls = [];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("chdirs into VIBE_MCP_WORKSPACE", () => {
    const result = applyWorkspaceEnv({ VIBE_MCP_WORKSPACE: tempDir }, chdir);
    expect(result).toBe(tempDir);
    expect(chdirCalls).toEqual([tempDir]);
  });

  it("creates a missing workspace directory", () => {
    const target = join(tempDir, "nested", "workspace");
    expect(existsSync(target)).toBe(false);
    const result = applyWorkspaceEnv({ VIBE_MCP_WORKSPACE: target }, chdir);
    expect(result).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(chdirCalls).toEqual([target]);
  });

  it("is a no-op when the variable is unset or blank", () => {
    expect(applyWorkspaceEnv({}, chdir)).toBeNull();
    expect(applyWorkspaceEnv({ VIBE_MCP_WORKSPACE: "  " }, chdir)).toBeNull();
    expect(chdirCalls).toEqual([]);
  });

  it("stays put when the target is unusable", () => {
    const result = applyWorkspaceEnv({ VIBE_MCP_WORKSPACE: "\0invalid" }, chdir);
    expect(result).toBeNull();
    expect(chdirCalls).toEqual([]);
  });
});

describe("ensureSystemPath", () => {
  let existingDir: string;

  beforeEach(() => {
    existingDir = mkdtempSync(join(tmpdir(), "vibe-path-"));
  });

  afterEach(() => {
    rmSync(existingDir, { recursive: true, force: true });
  });

  it("appends missing well-known dirs that exist on disk", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const added = ensureSystemPath(env, [existingDir, "/nonexistent-dir-xyz"]);
    expect(added).toEqual([existingDir]);
    expect(env.PATH).toBe(`/usr/bin:/bin:${existingDir}`);
  });

  it("is a no-op when the dir is already on PATH", () => {
    const env: NodeJS.ProcessEnv = { PATH: `/usr/bin:${existingDir}` };
    expect(ensureSystemPath(env, [existingDir])).toEqual([]);
    expect(env.PATH).toBe(`/usr/bin:${existingDir}`);
  });

  it("handles an unset PATH", () => {
    const env: NodeJS.ProcessEnv = {};
    const added = ensureSystemPath(env, [existingDir]);
    expect(added).toEqual([existingDir]);
    expect(env.PATH).toBe(existingDir);
  });
});

describe("scrubUnresolvedUserConfigEnv", () => {
  it("removes literal ${user_config.*} values left by unfilled extension fields", () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: "${user_config.anthropic_api_key}",
      OPENAI_API_KEY: " ${user_config.openai_api_key} ",
      ELEVENLABS_API_KEY: "real-key",
      PATH: "/usr/bin",
    };
    const removed = scrubUnresolvedUserConfigEnv(env);
    expect(removed.sort()).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ELEVENLABS_API_KEY).toBe("real-key");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("leaves values that merely contain a template substring", () => {
    const env: NodeJS.ProcessEnv = {
      NOTE: "uses ${user_config.workspace} internally",
      EMPTY: "",
    };
    expect(scrubUnresolvedUserConfigEnv(env)).toEqual([]);
    expect(env.NOTE).toBeDefined();
    expect(env.EMPTY).toBe("");
  });
});
