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
 * Codex + Aider are AGENTS.md-driven hosts; they discover the project-root
 * SKILL.md because AGENTS.md points at it in prose (the init-templates
 * AGENTS_MD "Composition rules" section, not an `@`-import).
 *
 * The content is byte-identical to what `loadHyperframesSkillBundle()`
 * uses — same vendored files, same `BUNDLE_VERSION`. Build/render never read
 * these project files (they use the vendored bundle); they exist only so host
 * agents can read the rules and so users can edit them per project.
 *
 * Lean scaffolds: the automatic `vibe init` path passes `lean: true`, so when
 * the Hyperframes skill is already installed globally
 * (`hasGlobalHyperframesSkill()`) it skips the redundant copies — the
 * `.claude/skills/hyperframes/` copy always, and the root `SKILL.md` +
 * `references/` unless a root-reading host (codex/aider/gemini/opencode) needs
 * them. Explicit `vibe scene install-skill` omits `lean`, fully materializing
 * editable copies regardless (the "eject").
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { BUNDLE_VERSION } from "./hf-skill-bundle/bundle.js";
import type { AgentHostId } from "../../utils/agent-host-detect.js";

/**
 * True when the Hyperframes skill is installed at the user's global Claude
 * skills dir (`~/.claude/skills/hyperframes/`). When present, materializing the
 * skill into a project is redundant — the host agent already loads it globally —
 * so `vibe init` keeps the scaffold lean and skips the copies. Explicit
 * `vibe scene install-skill` ignores this (it's the opt-in "eject" path).
 */
export function hasGlobalHyperframesSkill(): boolean {
  return existsSync(join(homedir(), ".claude", "skills", "hyperframes", "SKILL.md"));
}

/**
 * The vendored skill content. Loaded via a lazy `await import` in
 * {@link installHyperframesSkill} (not a top-level import) so loading this
 * module at CLI startup — it's reachable from the `scene` command group —
 * doesn't eagerly evaluate the ~52KB content. `BUNDLE_VERSION` stays a cheap
 * static import.
 */
interface HfBundleContent {
  SKILL_MD: string;
  HOUSE_STYLE_MD: string;
  MOTION_PRINCIPLES_MD: string;
  TYPOGRAPHY_MD: string;
  TRANSITIONS_MD: string;
}

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
  /**
   * Opt into redundancy gating: skip copies the globally-installed Hyperframes
   * skill already provides. The automatic `vibe init` path sets this so the
   * scaffold stays lean; the explicit `vibe scene install-skill` path leaves it
   * false to fully materialize editable copies (the "eject"). Default false.
   */
  lean?: boolean;
  /**
   * Caller signals a root-reading host (codex / aider / gemini / opencode) is
   * present, so the root `SKILL.md` + `references/` must be written even when
   * the global Claude skill exists. Default false. Only consulted when `lean`.
   */
  rootReaderHostPresent?: boolean;
  /**
   * Override the global-skill probe (testing seam). Defaults to
   * {@link hasGlobalHyperframesSkill}. Only consulted when `lean`.
   */
  hasGlobalSkill?: boolean;
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
function universalFiles(c: HfBundleContent): SkillFile[] {
  return [
    { relPath: "SKILL.md", content: c.SKILL_MD },
    { relPath: "references/house-style.md", content: c.HOUSE_STYLE_MD },
    { relPath: "references/motion-principles.md", content: c.MOTION_PRINCIPLES_MD },
    { relPath: "references/typography.md", content: c.TYPOGRAPHY_MD },
    { relPath: "references/transitions.md", content: c.TRANSITIONS_MD },
  ];
}

/**
 * Claude Code skill directory. Same content as universal but mounted
 * under `.claude/skills/hyperframes/` so Claude Code's skill loader
 * picks it up automatically.
 */
function claudeCodeFiles(c: HfBundleContent): SkillFile[] {
  const base = ".claude/skills/hyperframes";
  return [
    { relPath: `${base}/SKILL.md`, content: c.SKILL_MD },
    { relPath: `${base}/references/house-style.md`, content: c.HOUSE_STYLE_MD },
    { relPath: `${base}/references/motion-principles.md`, content: c.MOTION_PRINCIPLES_MD },
    { relPath: `${base}/references/typography.md`, content: c.TYPOGRAPHY_MD },
    { relPath: `${base}/references/transitions.md`, content: c.TRANSITIONS_MD },
  ];
}

/**
 * Cursor's `.mdc` rule file. Cursor's frontmatter is `description` +
 * `globs` (auto-activate when matching files are open) + `alwaysApply`.
 * The body concatenates SKILL.md + references so a single file is enough
 * (Cursor doesn't traverse a directory the way Claude Code does).
 */
function cursorFiles(c: HfBundleContent): SkillFile[] {
  const body = [
    c.SKILL_MD,
    "\n\n## Reference: house-style.md\n\n" + c.HOUSE_STYLE_MD,
    "\n\n## Reference: motion-principles.md\n\n" + c.MOTION_PRINCIPLES_MD,
    "\n\n## Reference: typography.md\n\n" + c.TYPOGRAPHY_MD,
    "\n\n## Reference: transitions.md\n\n" + c.TRANSITIONS_MD,
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

/**
 * Resolve which files to write given the requested hosts and redundancy state.
 *
 * - Root universal files (`SKILL.md` + `references/`) serve root-reading hosts
 *   (codex / aider / gemini / opencode) and per-project editing. Skipped only
 *   when the global skill covers them and no root-reader needs them.
 * - The Claude host copy pure-duplicates the global skill — skipped when the
 *   global skill is present.
 * - Cursor's rule file has no global mechanism — always written when requested.
 *
 * `globalPresent` is only true under lean gating; otherwise everything the
 * hosts request is written (the explicit install / eject path).
 */
function selectFiles(
  hosts: InstallSkillHost[],
  c: HfBundleContent,
  opts: { globalPresent: boolean; rootReaderPresent: boolean },
): SkillFile[] {
  const wantsAll = hosts.includes("all");
  const wantsClaude = wantsAll || hosts.includes("claude-code");
  const wantsCursor = wantsAll || hosts.includes("cursor");

  const out: SkillFile[] = [];
  if (!opts.globalPresent || opts.rootReaderPresent) {
    out.push(...universalFiles(c));
  }
  if (wantsClaude && !opts.globalPresent) {
    out.push(...claudeCodeFiles(c));
  }
  if (wantsCursor) {
    out.push(...cursorFiles(c));
  }
  return out;
}

/**
 * Map an `AgentHostId[]` to whether a root-reading host is present. Codex,
 * Aider, Gemini, and OpenCode read the project-root `SKILL.md` via AGENTS.md
 * prose — they have no global-skill mechanism, so the root files must be
 * written for them even when the global Claude skill exists.
 */
export function deriveRootReaderPresent(detected: AgentHostId[]): boolean {
  return detected.some((id) => id !== "claude-code" && id !== "cursor");
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

  // Lazily pull the ~52KB vendored content only when actually installing.
  const content: HfBundleContent = await import("./hf-skill-bundle/bundle-content.js");
  const lean = opts.lean ?? false;
  const globalPresent = lean
    ? (opts.hasGlobalSkill ?? hasGlobalHyperframesSkill())
    : false;
  const rootReaderPresent = opts.rootReaderHostPresent ?? false;
  const files = selectFiles(opts.hosts, content, {
    globalPresent,
    rootReaderPresent,
  });
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
