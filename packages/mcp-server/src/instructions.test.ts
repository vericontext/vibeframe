import { describe, expect, it } from "vitest";
import { buildServerInstructions, resolveServerWorkspaceRoot } from "./instructions.js";

describe("MCP server instructions", () => {
  it("announces the configured workspace root and path rules", () => {
    const instructions = buildServerInstructions("/Users/example/video-workspace");

    expect(instructions).toContain("VibeFrame MCP workspace root: /Users/example/video-workspace");
    expect(instructions).toContain("workspace-relative paths");
    expect(instructions).toContain("Do not create projects in /tmp");
    expect(instructions).toContain("/home/claude");
    expect(instructions).toContain("dry-run or plan");
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
