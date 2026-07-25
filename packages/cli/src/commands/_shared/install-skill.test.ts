import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../utils/exec-safe.js", () => ({
  execSafe: vi.fn(),
  execSafeSync: vi.fn(),
  commandExists: vi.fn(() => true),
}));

import { execSafe } from "../../utils/exec-safe.js";
import {
  HYPERFRAMES_SKILL_PACKAGE,
  PROJECT_SKILL_PATH,
  buildInstallSkillArgs,
  installHyperframesSkill,
  resolveSkillReference,
} from "./install-skill.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "vibe-install-skill-"));
  vi.mocked(execSafe).mockReset();
  vi.mocked(execSafe).mockResolvedValue({ stdout: "Installed 1 skill", stderr: "" });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** Materialise what upstream's installer would leave behind. */
function seedProjectSkill(): void {
  mkdirSync(join(projectDir, ".agents", "skills", "hyperframes"), { recursive: true });
  writeFileSync(
    join(projectDir, ".agents", "skills", "hyperframes", "SKILL.md"),
    "# rules",
    "utf-8"
  );
}

describe("buildInstallSkillArgs", () => {
  it("targets upstream's repo and the hyperframes skill, non-interactively", () => {
    expect(buildInstallSkillArgs()).toEqual([
      "-y",
      "skills",
      "add",
      HYPERFRAMES_SKILL_PACKAGE,
      "-s",
      "hyperframes",
      "-y",
    ]);
  });

  it("adds --global when asked", () => {
    expect(buildInstallSkillArgs({ global: true })).toContain("--global");
  });
});

describe("resolveSkillReference", () => {
  it("returns null when nothing is installed", () => {
    expect(resolveSkillReference(projectDir)).toBeNull();
  });

  it("prefers upstream's install location", () => {
    seedProjectSkill();
    expect(resolveSkillReference(projectDir)).toBe(PROJECT_SKILL_PATH);
  });

  it("still honours a legacy root SKILL.md from an older scaffold", () => {
    writeFileSync(join(projectDir, "SKILL.md"), "# old rules", "utf-8");
    expect(resolveSkillReference(projectDir)).toBe("SKILL.md");
  });
});

describe("installHyperframesSkill", () => {
  it("runs upstream's installer in the project directory", async () => {
    const r = await installHyperframesSkill({ projectDir, hasGlobalSkill: false });

    expect(r.success).toBe(true);
    expect(r.status).toBe("installed");
    expect(execSafe).toHaveBeenCalledWith("npx", buildInstallSkillArgs(), { cwd: projectDir });
  });

  it("skips the install when the project already has the rules", async () => {
    seedProjectSkill();
    const r = await installHyperframesSkill({ projectDir, hasGlobalSkill: false });

    expect(r.status).toBe("already-installed");
    expect(r.skillPath).toBe(PROJECT_SKILL_PATH);
    expect(execSafe).not.toHaveBeenCalled();
  });

  it("reinstalls over an existing copy when forced", async () => {
    seedProjectSkill();
    const r = await installHyperframesSkill({ projectDir, hasGlobalSkill: false, force: true });

    expect(r.status).toBe("installed");
    expect(execSafe).toHaveBeenCalledOnce();
  });

  it("reports the command without running it on a dry run", async () => {
    const r = await installHyperframesSkill({ projectDir, hasGlobalSkill: false, dryRun: true });

    expect(r.status).toBe("would-install");
    expect(r.command).toContain(`skills add ${HYPERFRAMES_SKILL_PACKAGE}`);
    expect(execSafe).not.toHaveBeenCalled();
  });

  it("surfaces an actionable error when the installer cannot run", async () => {
    vi.mocked(execSafe).mockRejectedValue(new Error("npx: command not found"));
    const r = await installHyperframesSkill({ projectDir, hasGlobalSkill: false });

    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("npx: command not found");
    expect(r.retryWith).toEqual([r.command]);
  });
});
