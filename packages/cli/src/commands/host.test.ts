import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-host-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function runHost(args: string[]): string {
  return execFileSync(process.execPath, [CLI, "host", ...args, "--json"], {
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
  });
}

describe("vibe host (black-box)", () => {
  it("lists supported hosts", () => {
    const result = JSON.parse(runHost(["list"]));
    expect(result.command).toBe("host list");
    expect(result.data.hosts.map((host: { id: string }) => host.id)).toEqual([
      "codex",
      "claude-code",
      "claude-desktop",
      "cursor",
    ]);
  });

  it("prints setup snippets without writing by default", () => {
    const result = JSON.parse(runHost(["setup", "cursor", projectDir]));
    expect(result.command).toBe("host setup");
    expect(result.data.hosts[0].snippet).toContain("@vibeframe/mcp-server");
    expect(existsSync(join(projectDir, ".cursor", "mcp.json"))).toBe(false);
  });

  it("writes project-scoped Cursor MCP config with --write", () => {
    const result = JSON.parse(runHost(["setup", "cursor", projectDir, "--write"]));
    const mcpPath = join(projectDir, ".cursor", "mcp.json");
    expect(result.data.hosts[0].files.some((file: { status: string }) => file.status === "wrote")).toBe(true);
    expect(JSON.parse(readFileSync(mcpPath, "utf-8")).mcpServers.vibeframe.command).toBe("npx");
  });

  it("reports host doctor status", () => {
    runHost(["setup", "codex", projectDir, "--write"]);
    const result = JSON.parse(runHost(["doctor", "codex", projectDir]));
    expect(result.command).toBe("host doctor");
    expect(result.data.hosts[0].configured).toBe(true);
  });
});
