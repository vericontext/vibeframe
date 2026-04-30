/**
 * Unit tests for the shell completion generators.
 *
 * Black-box: spawn the CLI binary so we exercise the full
 * action → generator → stdout path. Verifies (1) every visible
 * top-level command appears in each shell's output, (2) cost-tier
 * badges ride along in zsh / fish, and (3) the bash branch falls
 * back to plain word lists.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "..", "..", "dist", "index.js");

function runCompletion(shell: string): string {
  return execFileSync(process.execPath, [CLI, "completion", shell], {
    encoding: "utf-8",
    env: {
      ...process.env,
      VIBE_HUMAN_OUTPUT: "1",
      NO_COLOR: "1",
    },
  });
}

describe("vibe completion zsh", () => {
  const out = runCompletion("zsh");

  it("starts with #compdef vibe", () => {
    expect(out.startsWith("#compdef vibe")).toBe(true);
  });

  it("declares the _vibe completion function", () => {
    expect(out).toContain("_vibe()");
    expect(out).toContain('_describe \'command\' commands');
  });

  it("includes every top-level non-deprecated command", () => {
    for (const cmd of [
      "generate", "edit", "inspect", "audio", "remix",
      "setup", "init", "build", "render", "doctor", "demo",
      "run", "agent", "detect", "batch",
      "schema", "context", "walkthrough", "completion",
    ]) {
      expect(out).toContain(`'${cmd}:`);
    }
  });

  it("annotates paid commands with their cost tier", () => {
    expect(out).toContain("[VERY-HIGH]");
    expect(out).toContain("[HIGH]");
    expect(out).toContain("[FREE]");
  });

  it("includes subcommand cases for groups", () => {
    expect(out).toMatch(/generate\)\s*\n\s*local -a subcommands/);
    expect(out).toMatch(/edit\)\s*\n\s*local -a subcommands/);
  });
});

describe("vibe completion bash", () => {
  const out = runCompletion("bash");

  it("declares _vibe_complete and registers it", () => {
    expect(out).toContain("_vibe_complete()");
    expect(out).toContain("complete -F _vibe_complete vibe");
  });

  it("emits a top-level word list with all commands", () => {
    const m = out.match(/-W "([^"]+)"/);
    expect(m).not.toBeNull();
    const words = m![1].split(" ");
    for (const cmd of ["generate", "edit", "remix", "setup", "doctor"]) {
      expect(words).toContain(cmd);
    }
  });

  it("does NOT include cost tier markers (bash word lists are description-less)", () => {
    expect(out).not.toContain("[VERY-HIGH]");
    expect(out).not.toContain("[FREE]");
  });
});

describe("vibe completion fish", () => {
  const out = runCompletion("fish");

  it("uses __fish_use_subcommand for top level", () => {
    expect(out).toContain("__fish_use_subcommand");
    expect(out).toContain("complete -c vibe");
  });

  it("scopes subcommands via __fish_seen_subcommand_from", () => {
    expect(out).toContain("__fish_seen_subcommand_from generate");
    expect(out).toContain("__fish_seen_subcommand_from edit");
  });

  it("attaches cost tier badges in descriptions", () => {
    expect(out).toContain("[VERY-HIGH]");
  });
});

describe("vibe completion <invalid>", () => {
  it("errors with usage hint", () => {
    let threw = false;
    try {
      execFileSync(process.execPath, [CLI, "completion", "powershell"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });
    } catch (err) {
      threw = true;
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toMatch(/Unknown shell|Supported: zsh, bash, fish/);
    }
    expect(threw).toBe(true);
  });
});
