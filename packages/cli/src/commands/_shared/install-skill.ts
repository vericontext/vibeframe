/**
 * @module _shared/install-skill
 *
 * Phase H1 — install the vendored Hyperframes skill bundle into a user's
 * scene project so that the host agent (Claude Code, Cursor, Codex, Aider,
 * etc.) can read the framework rules + house style directly. This is the
 * agentic-CLI-native pattern: the host agent is the sole LLM that reasons
 * about scene composition, and it does so with the skill files in its
 * context — VibeFrame's CLI is the deterministic toolbelt.
 *
 * Layout written:
 *
 *   <project>/
 *     SKILL.md                              # universal — all agents see this
 *     references/
 *       house-style.md
 *       motion-principles.md
 *       typography.md
 *       transitions.md
 *     .claude/skills/hyperframes/           # if hosts includes "claude-code"
 *       SKILL.md (copy)
 *       references/{house-style,...}.md
 *     .cursor/rules/hyperframes.mdc         # if hosts includes "cursor"
 *
 * Codex + Aider are AGENTS.md-driven hosts; they read the project root
 * SKILL.md via an `@SKILL.md` reference in AGENTS.md (handled by the
 * init-templates AGENTS_MD section, not here).
 *
 * The content is byte-identical to what `loadHyperframesSkillBundle()`
 * uses — same vendored files, same `BUNDLE_VERSION`. After install, the
 * agentic compose path (Phase H2) reads these files instead of the
 * vendored TS string constants, so users can edit them per project.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  HOUSE_STYLE_MD,
  MOTION_PRINCIPLES_MD,
  SKILL_MD,
  TRANSITIONS_MD,
  TYPOGRAPHY_MD,
} from "./hf-skill-bundle/bundle-content.js";
import { BUNDLE_VERSION } from "./hf-skill-bundle/bundle.js";
import type { AgentHostId } from "../../utils/agent-host-detect.js";

/** Hosts the install-skill command knows file layouts for. */
export type InstallSkillHost = "claude-code" | "cursor" | "all";

export interface InstallSkillOptions {
  /** Project directory (must exist or be creatable). */
  projectDir: string;
  /**
   * Hosts to install host-specific copies for. The universal `SKILL.md` +
   * `references/` directory at the project root are always written.
   * Pass `["all"]` to install every host-specific layout.
   */
  hosts: InstallSkillHost[];
  /** Overwrite existing files. Default false (skip-on-exist). */
  force?: boolean;
  /** Don't write — just describe what would happen. */
  dryRun?: boolean;
}

export type InstallSkillFileStatus =
  | "wrote"
  | "skipped-exists"
  | "would-write"
  | "would-skip-exists";

export interface InstallSkillFileAction {
  path: string;
  status: InstallSkillFileStatus;
  bytes: number;
}

export interface InstallSkillResult {
  success: boolean;
  bundleVersion: string;
  files: InstallSkillFileAction[];
}

interface SkillFile {
  /** Path relative to project root. */
  relPath: string;
  content: string;
}

/**
 * Universal skill files written to project root. These are what
 * AGENTS.md `@SKILL.md` references and what Codex / Aider / generic
 * agents discover by walking the project tree.
 */
function universalFiles(): SkillFile[] {
  return [
    { relPath: "SKILL.md", content: SKILL_MD },
    { relPath: "references/house-style.md", content: HOUSE_STYLE_MD },
    { relPath: "references/motion-principles.md", content: MOTION_PRINCIPLES_MD },
    { relPath: "references/typography.md", content: TYPOGRAPHY_MD },
    { relPath: "references/transitions.md", content: TRANSITIONS_MD },
  ];
}

/**
 * Claude Code skill directory. Same content as universal but mounted
 * under `.claude/skills/hyperframes/` so Claude Code's skill loader
 * picks it up automatically.
 */
function claudeCodeFiles(): SkillFile[] {
  const base = ".claude/skills/hyperframes";
  return [
    { relPath: `${base}/SKILL.md`, content: SKILL_MD },
    { relPath: `${base}/references/house-style.md`, content: HOUSE_STYLE_MD },
    { relPath: `${base}/references/motion-principles.md`, content: MOTION_PRINCIPLES_MD },
    { relPath: `${base}/references/typography.md`, content: TYPOGRAPHY_MD },
    { relPath: `${base}/references/transitions.md`, content: TRANSITIONS_MD },
  ];
}

/**
 * Cursor's `.mdc` rule file. Cursor's frontmatter is `description` +
 * `globs` (auto-activate when matching files are open) + `alwaysApply`.
 * The body concatenates SKILL.md + references so a single file is enough
 * (Cursor doesn't traverse a directory the way Claude Code does).
 */
function cursorFiles(): SkillFile[] {
  const body = [
    SKILL_MD,
    "\n\n## Reference: house-style.md\n\n" + HOUSE_STYLE_MD,
    "\n\n## Reference: motion-principles.md\n\n" + MOTION_PRINCIPLES_MD,
    "\n\n## Reference: typography.md\n\n" + TYPOGRAPHY_MD,
    "\n\n## Reference: transitions.md\n\n" + TRANSITIONS_MD,
  ].join("");

  // Strip upstream Hyperframes frontmatter (Cursor uses its own shape) and
  // wrap with cursor-style frontmatter. Globs target HTML inside scene
  // projects so the rule auto-activates only when the user is editing
  // composition files.
  const stripped = body.replace(/^---\n[\s\S]*?\n---\n/, "");
  const cursorFrontmatter = `---
description: "Hyperframes composition rules — animation, type, transitions, scene HTML invariants. Auto-activates on composition HTML."
globs: ["compositions/**/*.html", "**/scene-*.html"]
alwaysApply: false
---

`;

  return [
    { relPath: ".cursor/rules/hyperframes.mdc", content: cursorFrontmatter + stripped },
  ];
}

/** Resolve which host-specific layouts to install based on `hosts`. */
function selectHostFiles(hosts: InstallSkillHost[]): SkillFile[] {
  const wantsAll = hosts.includes("all");
  const wantsClaude = wantsAll || hosts.includes("claude-code");
  const wantsCursor = wantsAll || hosts.includes("cursor");
  const out: SkillFile[] = [];
  if (wantsClaude) out.push(...claudeCodeFiles());
  if (wantsCursor) out.push(...cursorFiles());
  return out;
}

/**
 * Install Hyperframes skill files at the project + host-specific paths.
 *
 * Idempotent by default — existing files are skipped (logged as
 * `skipped-exists`). Pass `force: true` to overwrite. `dryRun: true`
 * reports the same actions but with `would-*` status and writes nothing.
 */
export async function installHyperframesSkill(opts: InstallSkillOptions): Promise<InstallSkillResult> {
  const projectDir = resolve(opts.projectDir);
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  const files = [...universalFiles(), ...selectHostFiles(opts.hosts)];
  const actions: InstallSkillFileAction[] = [];

  if (!dryRun && !existsSync(projectDir)) {
    await mkdir(projectDir, { recursive: true });
  }

  for (const file of files) {
    const absPath = join(projectDir, file.relPath);
    const exists = existsSync(absPath);
    const bytes = Buffer.byteLength(file.content, "utf-8");

    if (exists && !force) {
      actions.push({
        path: relative(projectDir, absPath) || file.relPath,
        status: dryRun ? "would-skip-exists" : "skipped-exists",
        bytes,
      });
      continue;
    }

    if (dryRun) {
      actions.push({ path: file.relPath, status: "would-write", bytes });
      continue;
    }

    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, file.content, "utf-8");
    actions.push({ path: file.relPath, status: "wrote", bytes });
  }

  return {
    success: true,
    bundleVersion: BUNDLE_VERSION,
    files: actions,
  };
}

/**
 * Map an `AgentHostId[]` (from `detectedAgentHosts()`) to the
 * install-skill command's host vocabulary. Codex / Aider don't get
 * host-specific layouts — they read the universal `SKILL.md` via
 * AGENTS.md, so they're filtered out here.
 */
export function deriveInstallHosts(detected: AgentHostId[]): InstallSkillHost[] {
  const out: InstallSkillHost[] = [];
  if (detected.includes("claude-code")) out.push("claude-code");
  if (detected.includes("cursor")) out.push("cursor");
  return out;
}
