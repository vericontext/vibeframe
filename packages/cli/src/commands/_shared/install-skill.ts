/**
 * @module _shared/install-skill
 *
 * Put the Hyperframes composition rules where the host agent will read them,
 * by running upstream's own installer instead of shipping a copy.
 *
 * VibeFrame used to vendor a snapshot of Hyperframes' skill markdown and write
 * it into each project under hand-maintained per-host layouts (project-root
 * `SKILL.md` + `references/`, `.claude/skills/hyperframes/`,
 * `.cursor/rules/hyperframes.mdc`). That snapshot went stale - upstream has
 * since restructured the skill into a router plus a `references/` tree and
 * ships 31 skills, none of which a frozen copy can follow - and the two host
 * layouts covered a fraction of what upstream's installer reaches.
 *
 *   npx skills add heygen-com/hyperframes -s hyperframes -y
 *
 * installs to `.agents/skills/hyperframes/`, serves ~19 agents universally
 * (Amp, Antigravity, Cline, Codex, and more), symlinks the ones that want
 * their own directory (Claude Code, Eve), and records the result in
 * `skills-lock.json`. The generated `AGENTS.md` has pointed users at this
 * command for a while; now the code agrees with the docs.
 *
 * Nothing in build or render reads these files. They exist so the host agent
 * can read the rules while it authors scene HTML.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { execSafe } from "../../utils/exec-safe.js";

/** Upstream repository the `skills` CLI installs from. */
export const HYPERFRAMES_SKILL_PACKAGE = "heygen-com/hyperframes";

/** The command a user can run by hand to get the same result. */
export const HYPERFRAMES_SKILL_INSTALL_COMMAND = `npx skills add ${HYPERFRAMES_SKILL_PACKAGE}`;

/** Where upstream's installer puts the skill inside a project. */
export const PROJECT_SKILL_PATH = join(".agents", "skills", "hyperframes", "SKILL.md");

/**
 * True when the Hyperframes skill is installed at the user's global Claude
 * skills dir (`~/.claude/skills/hyperframes/`). A host agent already loads it
 * from there, so installing into the project is redundant.
 */
export function hasGlobalHyperframesSkill(): boolean {
  return existsSync(join(homedir(), ".claude", "skills", "hyperframes", "SKILL.md"));
}

/** True when upstream's installer has already run in this project. */
export function hasProjectHyperframesSkill(projectDir: string): boolean {
  return existsSync(join(resolve(projectDir), PROJECT_SKILL_PATH));
}

/**
 * Project-relative path to the composition rules a host agent should read, or
 * `null` when neither the project nor the global install has them.
 *
 * The bare root `SKILL.md` is still honoured: projects scaffolded before the
 * switch to upstream's installer have one, and it should keep working.
 */
export function resolveSkillReference(projectDir: string): string | null {
  const dir = resolve(projectDir);
  if (existsSync(join(dir, PROJECT_SKILL_PATH))) return PROJECT_SKILL_PATH;
  if (existsSync(join(dir, "SKILL.md"))) return "SKILL.md";
  return null;
}

/**
 * True when the host agent can read the Hyperframes rules from anywhere -
 * this project or the user's global skills dir. Callers that only need to
 * decide whether to nag should use this rather than
 * {@link resolveSkillReference}, which is about the in-project path and is
 * null for a global-only install.
 */
export function hyperframesSkillAvailable(projectDir: string): boolean {
  return resolveSkillReference(projectDir) !== null || hasGlobalHyperframesSkill();
}

export type InstallSkillStatus = "installed" | "already-installed" | "would-install" | "failed";

export interface InstallSkillOptions {
  /** Project to install into. The installer runs with this as its cwd. */
  projectDir: string;
  /** Install at user level (`~/.claude/skills/...`) rather than per project. */
  global?: boolean;
  /** Reinstall even when the skill is already present. */
  force?: boolean;
  /** Report the command without running it. */
  dryRun?: boolean;
  /**
   * Override the global-skill probe. Testing seam - a developer machine that
   * already has the skill would otherwise short-circuit every install.
   */
  hasGlobalSkill?: boolean;
}

export interface InstallSkillResult {
  success: boolean;
  status: InstallSkillStatus;
  /** The exact command run (or that would run). */
  command: string;
  /** Project-relative path to the installed rules, when they are present. */
  skillPath: string | null;
  /** Installer output, trimmed. Present on a real run. */
  output?: string;
  error?: string;
  retryWith?: string[];
}

/** Build the argv for upstream's installer. Pure - unit-testable. */
export function buildInstallSkillArgs(opts: { global?: boolean } = {}): string[] {
  const args = ["-y", "skills", "add", HYPERFRAMES_SKILL_PACKAGE, "-s", "hyperframes", "-y"];
  if (opts.global) args.push("--global");
  return args;
}

/**
 * Run upstream's installer for the Hyperframes skill.
 *
 * Skips when the skill is already available (globally or in the project)
 * unless `force` is set, so calling it twice costs nothing.
 */
export async function installHyperframesSkill(
  opts: InstallSkillOptions
): Promise<InstallSkillResult> {
  const projectDir = resolve(opts.projectDir);
  const args = buildInstallSkillArgs({ global: opts.global });
  const command = `npx ${args.join(" ")}`;

  const globalPresent = opts.hasGlobalSkill ?? hasGlobalHyperframesSkill();
  const alreadyThere = opts.global
    ? globalPresent
    : hasProjectHyperframesSkill(projectDir) || globalPresent;

  if (alreadyThere && !opts.force) {
    return {
      success: true,
      status: "already-installed",
      command,
      skillPath: resolveSkillReference(projectDir),
    };
  }

  if (opts.dryRun) {
    return {
      success: true,
      status: "would-install",
      command,
      skillPath: resolveSkillReference(projectDir),
    };
  }

  try {
    const { stdout } = await execSafe("npx", args, { cwd: projectDir });
    return {
      success: true,
      status: "installed",
      command,
      skillPath: resolveSkillReference(projectDir),
      output: stdout.trim() || undefined,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: "failed",
      command,
      skillPath: resolveSkillReference(projectDir),
      error:
        `Could not install the Hyperframes skill: ${reason}. ` +
        `It needs network access and npx on PATH.`,
      retryWith: [command],
    };
  }
}
