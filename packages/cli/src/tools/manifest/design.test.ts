import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { designValidateTool } from "./design.js";
import type { ExecuteContext } from "../define-tool.js";

const ctx = (workingDirectory: string): ExecuteContext => ({ workingDirectory, surface: "cli" });

describe("design_validate tool", () => {
  it("validates a token DESIGN.md and returns parsed colors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-validate-"));
    writeFileSync(
      join(dir, "DESIGN.md"),
      '---\nname: X\ncolors:\n  primary: "#FFFFFF"\n  ground: "#000000"\n---\n## Overview\nMood.\n'
    );
    const r = await designValidateTool.execute({ projectDir: dir }, ctx(dir));
    expect(r.success).toBe(true);
    expect((r.data as { name: string }).name).toBe("X");
    expect((r.data as { colors: Record<string, string> }).colors).toMatchObject({
      primary: "#FFFFFF",
      ground: "#000000",
    });
  });

  it("errors when DESIGN.md is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-validate-"));
    const r = await designValidateTool.execute({ projectDir: dir }, ctx(dir));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/);
  });
});
