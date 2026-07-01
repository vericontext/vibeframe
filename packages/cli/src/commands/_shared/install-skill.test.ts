import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deriveInstallHosts,
  deriveRootReaderPresent,
  installHyperframesSkill,
} from "./install-skill.js";

describe("installHyperframesSkill", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "install-skill-test-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("writes universal SKILL.md + references regardless of host selection", async () => {
    const r = await installHyperframesSkill({ projectDir, hosts: [] });

    expect(r.success).toBe(true);
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, "references/house-style.md"))).toBe(true);
    expect(existsSync(join(projectDir, "references/motion-principles.md"))).toBe(true);
    expect(existsSync(join(projectDir, "references/typography.md"))).toBe(true);
    expect(existsSync(join(projectDir, "references/transitions.md"))).toBe(true);
  });

  it("preserves the upstream Hyperframes frontmatter on the universal SKILL.md", async () => {
    await installHyperframesSkill({ projectDir, hosts: [] });
    const content = readFileSync(join(projectDir, "SKILL.md"), "utf-8");
    // Upstream skill ships with `name: hyperframes` Agent-Skills frontmatter.
    expect(content).toMatch(/^---\nname: hyperframes\n/);
    expect(content).toContain("description:");
  });

  it("installs Claude Code layout under .claude/skills/hyperframes/", async () => {
    await installHyperframesSkill({ projectDir, hosts: ["claude-code"] });

    const claudeBase = join(projectDir, ".claude/skills/hyperframes");
    expect(existsSync(join(claudeBase, "SKILL.md"))).toBe(true);
    expect(existsSync(join(claudeBase, "references/house-style.md"))).toBe(true);
    expect(existsSync(join(claudeBase, "references/motion-principles.md"))).toBe(true);
    expect(existsSync(join(claudeBase, "references/typography.md"))).toBe(true);
    expect(existsSync(join(claudeBase, "references/transitions.md"))).toBe(true);
  });

  it("installs Cursor layout as a single .mdc with cursor-style frontmatter", async () => {
    await installHyperframesSkill({ projectDir, hosts: ["cursor"] });

    const cursorPath = join(projectDir, ".cursor/rules/hyperframes.mdc");
    expect(existsSync(cursorPath)).toBe(true);

    const content = readFileSync(cursorPath, "utf-8");
    expect(content).toMatch(/^---\ndescription:/);
    expect(content).toContain("globs:");
    expect(content).toContain("alwaysApply: false");
    // Cursor frontmatter replaces upstream's `name: hyperframes` block.
    expect(content).not.toContain("\nname: hyperframes\n");
    // But the body still has the rules.
    expect(content).toContain("HARD-GATE");
    // And the references are concatenated in.
    expect(content).toContain("Reference: motion-principles.md");
    expect(content).toContain("Reference: typography.md");
  });

  it("'all' installs every host-specific layout in addition to universal", async () => {
    const r = await installHyperframesSkill({ projectDir, hosts: ["all"] });

    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude/skills/hyperframes/SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".cursor/rules/hyperframes.mdc"))).toBe(true);

    // 5 universal + 5 claude + 1 cursor = 11
    expect(r.files).toHaveLength(11);
    expect(r.files.every((f) => f.status === "wrote")).toBe(true);
  });

  it("skips existing files unless force is set", async () => {
    // Pre-create a SKILL.md the user "customised"
    writeFileSync(join(projectDir, "SKILL.md"), "# user wrote this", "utf-8");

    const r = await installHyperframesSkill({ projectDir, hosts: [] });
    const skillAction = r.files.find((f) => f.path === "SKILL.md");
    expect(skillAction?.status).toBe("skipped-exists");

    // Verify the user's content survived
    expect(readFileSync(join(projectDir, "SKILL.md"), "utf-8")).toBe("# user wrote this");

    // Force overwrites
    const forced = await installHyperframesSkill({ projectDir, hosts: [], force: true });
    const forcedAction = forced.files.find((f) => f.path === "SKILL.md");
    expect(forcedAction?.status).toBe("wrote");
    expect(readFileSync(join(projectDir, "SKILL.md"), "utf-8")).not.toBe("# user wrote this");
    expect(readFileSync(join(projectDir, "SKILL.md"), "utf-8")).toMatch(/^---\nname: hyperframes\n/);
  });

  it("dry-run reports actions without writing", async () => {
    const r = await installHyperframesSkill({ projectDir, hosts: ["all"], dryRun: true });

    // Same number of would-write actions as a real install
    expect(r.files).toHaveLength(11);
    expect(r.files.every((f) => f.status === "would-write")).toBe(true);

    // No files actually written
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(false);
    expect(existsSync(join(projectDir, "references"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude"))).toBe(false);
    expect(existsSync(join(projectDir, ".cursor"))).toBe(false);
  });

  it("dry-run distinguishes would-write vs would-skip-exists", async () => {
    mkdirSync(join(projectDir, "references"), { recursive: true });
    writeFileSync(join(projectDir, "SKILL.md"), "existing", "utf-8");

    const r = await installHyperframesSkill({ projectDir, hosts: [], dryRun: true });
    const skillAction = r.files.find((f) => f.path === "SKILL.md");
    expect(skillAction?.status).toBe("would-skip-exists");

    const houseAction = r.files.find((f) => f.path === "references/house-style.md");
    expect(houseAction?.status).toBe("would-write");
  });

  it("creates the project directory if it doesn't exist", async () => {
    const fresh = join(projectDir, "nested/new-project");
    expect(existsSync(fresh)).toBe(false);

    const r = await installHyperframesSkill({ projectDir: fresh, hosts: [] });
    expect(r.success).toBe(true);
    expect(existsSync(join(fresh, "SKILL.md"))).toBe(true);
  });

  it("returns the bundle version (matches what loadHyperframesSkillBundle uses)", async () => {
    const r = await installHyperframesSkill({ projectDir, hosts: [] });
    // Format is `<sha>-<YYYY-MM-DD>` per BUNDLE_VERSION docstring.
    expect(r.bundleVersion).toMatch(/^[0-9a-f]+-\d{4}-\d{2}-\d{2}$/);
  });
});

describe("installHyperframesSkill — lean redundancy gating", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "install-skill-lean-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("lean + global skill present: writes nothing for a Claude-only project", async () => {
    const r = await installHyperframesSkill({
      projectDir,
      hosts: ["claude-code"],
      lean: true,
      hasGlobalSkill: true,
    });

    expect(r.files).toHaveLength(0);
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(false);
    expect(existsSync(join(projectDir, "references"))).toBe(false);
    expect(existsSync(join(projectDir, ".claude/skills/hyperframes"))).toBe(false);
  });

  it("lean + global skill present: still writes Cursor rules (no global mechanism)", async () => {
    const r = await installHyperframesSkill({
      projectDir,
      hosts: ["cursor"],
      lean: true,
      hasGlobalSkill: true,
    });

    // Cursor rule only — no root universal, no claude copy.
    expect(existsSync(join(projectDir, ".cursor/rules/hyperframes.mdc"))).toBe(true);
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(false);
    expect(r.files.map((f) => f.path)).toEqual([".cursor/rules/hyperframes.mdc"]);
  });

  it("lean + global skill present + root-reading host: writes root SKILL.md, skips claude copy", async () => {
    const r = await installHyperframesSkill({
      projectDir,
      hosts: ["claude-code"],
      lean: true,
      hasGlobalSkill: true,
      rootReaderHostPresent: true,
    });

    // Root files for codex/aider present; the redundant claude copy is skipped.
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, "references/house-style.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude/skills/hyperframes"))).toBe(false);
    expect(r.files.some((f) => f.path.startsWith(".claude/"))).toBe(false);
  });

  it("lean + no global skill: writes everything (fallback so nothing is lost)", async () => {
    await installHyperframesSkill({
      projectDir,
      hosts: ["claude-code"],
      lean: true,
      hasGlobalSkill: false,
    });

    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude/skills/hyperframes/SKILL.md"))).toBe(true);
  });

  it("not lean (eject): writes everything even when a global skill exists", async () => {
    const r = await installHyperframesSkill({
      projectDir,
      hosts: ["all"],
      // no `lean` — the explicit install path; hasGlobalSkill is ignored
      hasGlobalSkill: true,
    });

    expect(r.files).toHaveLength(11);
    expect(existsSync(join(projectDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".claude/skills/hyperframes/SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".cursor/rules/hyperframes.mdc"))).toBe(true);
  });
});

describe("deriveRootReaderPresent", () => {
  it("true when a non-Claude/non-Cursor host is present", () => {
    expect(deriveRootReaderPresent(["codex"])).toBe(true);
    expect(deriveRootReaderPresent(["aider"])).toBe(true);
    expect(deriveRootReaderPresent(["gemini-cli"])).toBe(true);
    expect(deriveRootReaderPresent(["claude-code", "codex"])).toBe(true);
  });

  it("false for Claude/Cursor-only or empty", () => {
    expect(deriveRootReaderPresent(["claude-code"])).toBe(false);
    expect(deriveRootReaderPresent(["cursor"])).toBe(false);
    expect(deriveRootReaderPresent(["claude-code", "cursor"])).toBe(false);
    expect(deriveRootReaderPresent([])).toBe(false);
  });
});

describe("deriveInstallHosts", () => {
  it("maps claude-code + cursor through; drops codex + aider", () => {
    expect(deriveInstallHosts(["claude-code"])).toEqual(["claude-code"]);
    expect(deriveInstallHosts(["cursor"])).toEqual(["cursor"]);
    expect(deriveInstallHosts(["claude-code", "cursor"])).toEqual(["claude-code", "cursor"]);
    expect(deriveInstallHosts(["codex"])).toEqual([]);
    expect(deriveInstallHosts(["aider"])).toEqual([]);
    expect(deriveInstallHosts(["claude-code", "codex", "aider"])).toEqual(["claude-code"]);
  });

  it("returns empty when nothing detected", () => {
    expect(deriveInstallHosts([])).toEqual([]);
  });
});
