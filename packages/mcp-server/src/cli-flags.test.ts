import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { handleCliFlags } from "./cli-flags.js";

describe("handleCliFlags", () => {
  let log: MockInstance;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("prints usage and returns true for --help / -h", () => {
    for (const flag of ["--help", "-h"]) {
      log.mockClear();
      expect(handleCliFlags([flag], "1.2.3")).toBe(true);
      expect(log).toHaveBeenCalledOnce();
      const out = String(log.mock.calls[0][0]);
      expect(out).toContain("VibeFrame MCP Server v1.2.3");
      expect(out).toContain("@vibeframe/mcp-server");
    }
  });

  it("prints the bare version and returns true for --version / -V", () => {
    for (const flag of ["--version", "-V"]) {
      log.mockClear();
      expect(handleCliFlags([flag], "1.2.3")).toBe(true);
      expect(log).toHaveBeenCalledWith("1.2.3");
    }
  });

  it("returns false and prints nothing for no args (server should boot)", () => {
    expect(handleCliFlags([], "1.2.3")).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns false for unknown args so the server still boots", () => {
    expect(handleCliFlags(["--workspace", "/tmp/x"], "1.2.3")).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
