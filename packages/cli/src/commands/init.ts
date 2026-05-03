/**
 * @module commands/init
 *
 * `vibe init [project-dir]` — v0.61 C2 project-scope scaffolder.
 *
 * Pairs with v0.61 C1 `vibe setup` (user scope). Where setup writes
 * machine-wide config (`~/.vibeframe/config.yaml`), init writes
 * project-local files: `AGENTS.md` (cross-tool), `CLAUDE.md` (Claude
 * Code, imports `@AGENTS.md`), `.env.example`, `.gitignore` additions,
 * and an optional `vibe.project.yaml`.
 *
 * Scaffolding decision tree:
 *   - Always: `.gitignore` additions, `.env.example`
 *   - If Claude Code detected (or `--agent claude|all`): `CLAUDE.md`
 *   - If any non-Claude host detected (or `--agent codex|cursor|all`): `AGENTS.md`
 *   - If neither detected: write `AGENTS.md` anyway (safe default; works
 *     for future-installed agents)
 *
 * **Idempotent by default**: existing files are skipped (the user's
 * customisations are sacred). `--force` overwrites them. `--dry-run`
 * prints the file list without writing.
 */

import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { detectedAgentHosts, type AgentHostId } from "../utils/agent-host-detect.js";
import {
  describeSceneScaffold,
  isSceneScaffoldProfile,
  scaffoldSceneProject,
  type SceneAspect,
} from "./_shared/scene-project.js";
import { getVisualStyle, visualStyleNames } from "./_shared/visual-styles.js";
import { draftStoryboardFromBrief } from "./_shared/storyboard-draft.js";
import { projectConfigJson, VIBE_CONFIG_FILENAME } from "./_shared/project-config.js";
import { deriveInstallHosts, installHyperframesSkill } from "./_shared/install-skill.js";
import {
  AGENTS_MD,
  CLAUDE_MD,
  GEMINI_MD,
  GITIGNORE_ADDITIONS,
  renderEnvExample,
  renderProjectYaml,
} from "./_shared/init-templates.js";
import { exitWithError, isJsonMode, outputSuccess, usageError } from "./output.js";

type AgentSelection = AgentHostId | "all" | "auto";
type InitType = "agent" | "scene";

const VALID_AGENTS: readonly AgentSelection[] = [
  "claude-code",
  "codex",
  "cursor",
  "aider",
  "gemini-cli",
  "opencode",
  "all",
  "auto",
];

interface InitFileAction {
  path: string;
  status: "wrote" | "skipped-exists" | "merged" | "would-write";
  reason?: string;
}

export const initCommand = new Command("init")
  .description("Scaffold a VibeFrame project (video scene project or project-scope agent files)")
  .argument("[project-dir]", "Project directory (defaults to cwd)", ".")
  .option(
    "--type <type>",
    "Project type: scene (video project) | agent (agent files only)",
    "scene"
  )
  .option(
    "--profile <profile>",
    "Scene profile: minimal (storyboard/design only), agent (recommended), full (render scaffold upfront)",
    "agent"
  )
  .option(
    "--from <brief>",
    "Draft STORYBOARD.md and DESIGN.md from a brief string or text/markdown file"
  )
  .option("-r, --ratio <ratio>", "Scene aspect ratio: 16:9, 9:16, 1:1, 4:5", "16:9")
  .option("-d, --duration <sec>", "Default scene/root duration in seconds", "10")
  .option("--visual-style <name>", "Seed scene DESIGN.md from a named style")
  .option("--agent <id>", `Agent target: ${VALID_AGENTS.join(" | ")}`, "auto")
  .option("--force", "Overwrite existing files instead of skipping")
  .option("--dry-run", "Print the file list without writing anything")
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    const initType = String(options.type ?? "scene") as InitType;
    if (initType !== "scene" && initType !== "agent") {
      exitWithError(usageError(`Invalid --type: ${initType}`, "Must be one of: scene, agent"));
    }

    if (initType === "scene") {
      await runSceneInit(projectDirArg, options, startedAt);
      return;
    }

    const agent = options.agent as AgentSelection;
    if (!VALID_AGENTS.includes(agent)) {
      exitWithError(
        usageError(`Invalid --agent: ${agent}`, `Must be one of: ${VALID_AGENTS.join(", ")}`)
      );
    }

    const projectDir = resolve(projectDirArg);
    const projectName = basename(projectDir);

    // Resolve which agent hosts we're scaffolding for. "auto" = detect;
    // "all" = every host we know about; otherwise the explicit set.
    const targetHosts = resolveTargets(agent);
    const wantsClaude = targetHosts.includes("claude-code");
    const wantsGemini = targetHosts.includes("gemini-cli");
    const wantsCrossTool = targetHosts.some((h) => h !== "claude-code");

    const actions: InitFileAction[] = [];

    // Ensure project dir exists (writing into a fresh dir is a common case).
    if (!existsSync(projectDir)) {
      if (options.dryRun) {
        actions.push({
          path: projectDir,
          status: "would-write",
          reason: "(would create directory)",
        });
      } else {
        await mkdir(projectDir, { recursive: true });
      }
    }

    // ── AGENTS.md (cross-tool) ─────────────────────────────────────────
    // Always write AGENTS.md unless explicitly Claude-only — it's the
    // canonical agent guidance file and CLAUDE.md imports it.
    if (wantsCrossTool || !wantsClaude) {
      actions.push(
        await writeIfMissing(
          resolve(projectDir, "AGENTS.md"),
          AGENTS_MD,
          options.force,
          options.dryRun
        )
      );
    }

    // ── CLAUDE.md (Claude Code, imports @AGENTS.md) ────────────────────
    if (wantsClaude) {
      actions.push(
        await writeIfMissing(
          resolve(projectDir, "CLAUDE.md"),
          CLAUDE_MD,
          options.force,
          options.dryRun
        )
      );
    }

    // ── GEMINI.md (Gemini CLI, parallels CLAUDE.md) ────────────────────
    // Gemini CLI's primary context file is GEMINI.md (per
    // https://geminicli.com/docs/cli/gemini-md/). Same import-from-
    // AGENTS.md pattern as CLAUDE.md so the canonical guidance lives
    // in one place and host-specific overrides go in the wrapper.
    if (wantsGemini) {
      actions.push(
        await writeIfMissing(
          resolve(projectDir, "GEMINI.md"),
          GEMINI_MD,
          options.force,
          options.dryRun
        )
      );
    }

    // ── .env.example (always) ──────────────────────────────────────────
    actions.push(
      await writeIfMissing(
        resolve(projectDir, ".env.example"),
        renderEnvExample(),
        options.force,
        options.dryRun
      )
    );

    // ── .gitignore (merge — never overwrite) ───────────────────────────
    actions.push(
      await mergeGitignore(resolve(projectDir, ".gitignore"), GITIGNORE_ADDITIONS, options.dryRun)
    );

    // ── vibe.config.json (TO-BE project contract, only when missing) ───
    actions.push(
      await writeIfMissing(
        resolve(projectDir, VIBE_CONFIG_FILENAME),
        projectConfigJson({ name: projectName }),
        options.force,
        options.dryRun
      )
    );

    // ── vibe.project.yaml (legacy, only when missing) ──────────────────
    actions.push(
      await writeIfMissing(
        resolve(projectDir, "vibe.project.yaml"),
        renderProjectYaml({ name: projectName }),
        options.force,
        options.dryRun
      )
    );

    // ── Output ─────────────────────────────────────────────────────────
    if (isJsonMode()) {
      outputSuccess({
        command: "init",
        startedAt,
        ...(options.dryRun ? { dryRun: true } : {}),
        data: {
          projectDir,
          agent,
          targetHosts,
          actions,
        },
      });
      return;
    }

    console.log();
    console.log(chalk.bold.magenta("VibeFrame Init") + chalk.dim(" — project scope"));
    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.dim(`Project:  ${projectDir}`));
    console.log(
      chalk.dim(
        `Agent:    ${agent}${agent === "auto" ? ` (resolved → ${targetHosts.join(", ") || "fallback"})` : ""}`
      )
    );
    console.log();

    for (const a of actions) {
      const icon = formatStatusIcon(a.status);
      const rel = a.path.replace(projectDir + "/", "");
      const note = a.reason ? chalk.dim(` ${a.reason}`) : "";
      console.log(`  ${icon} ${rel}${note}`);
    }

    if (options.dryRun) {
      console.log();
      console.log(chalk.dim("Dry run — no files were written. Re-run without --dry-run to apply."));
      return;
    }

    console.log();
    console.log(chalk.bold("  Next steps:"));
    if (wantsClaude) {
      console.log(
        chalk.dim(
          "    bash <(curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh)"
        )
      );
      console.log(
        chalk.dim("                                  Install /vibeframe + /vibe-* slash commands")
      );
    }
    console.log(chalk.dim("    cp .env.example .env          Add your API keys"));
    console.log(chalk.dim("    vibe doctor                   Check what's configured"));
    console.log(chalk.dim("    vibe init my-promo --type scene  Scaffold a starter video project"));
    console.log();
  });

// ── Helpers ──────────────────────────────────────────────────────────────

const VALID_SCENE_ASPECTS: SceneAspect[] = ["16:9", "9:16", "1:1", "4:5"];

async function runSceneInit(
  projectDirArg: string,
  options: Record<string, unknown>,
  startedAt: number
): Promise<void> {
  const profile = String(options.profile ?? "agent");
  if (!isSceneScaffoldProfile(profile)) {
    exitWithError(
      usageError(`Invalid --profile: ${profile}`, "Must be one of: minimal, agent, full")
    );
  }

  const aspect = String(options.ratio ?? "16:9") as SceneAspect;
  if (!VALID_SCENE_ASPECTS.includes(aspect)) {
    exitWithError(
      usageError(`Invalid --ratio: ${aspect}`, `Must be one of: ${VALID_SCENE_ASPECTS.join(", ")}`)
    );
  }

  const duration = Number.parseFloat(String(options.duration ?? "10"));
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) {
    exitWithError(
      usageError(
        `Invalid --duration: ${String(options.duration)}`,
        "Duration must be a positive number of seconds (≤3600)"
      )
    );
  }

  const visualStyle = options.visualStyle ? getVisualStyle(String(options.visualStyle)) : undefined;
  if (options.visualStyle && !visualStyle) {
    exitWithError(
      usageError(
        `Unknown visual style: ${String(options.visualStyle)}`,
        `Valid: ${visualStyleNames()}. Browse with \`vibe scene list-styles\`.`
      )
    );
  }

  const projectDir = resolve(projectDirArg);
  const projectName = basename(projectDir);
  const groups = describeSceneScaffold({ dir: projectDir, profile });
  const fromBrief =
    typeof options.from === "string" && options.from.trim()
      ? await readBriefOrLiteral(String(options.from), process.cwd())
      : null;

  if (options.dryRun) {
    if (!isJsonMode()) {
      printSceneInitPlan({
        projectDir,
        profile,
        aspect,
        duration,
        visualStyleName: visualStyle?.name ?? null,
        briefSummary: fromBrief ? summariseBrief(fromBrief) : null,
        groups,
        dryRun: true,
      });
      return;
    }
    outputSuccess({
      command: "init",
      startedAt,
      dryRun: true,
      data: {
        type: "scene",
        projectDir,
        name: projectName,
        profile,
        aspect,
        duration,
        visualStyle: visualStyle?.name ?? null,
        from: fromBrief ? summariseBrief(fromBrief) : null,
        groups,
      },
    });
    return;
  }

  const result = await scaffoldSceneProject({
    dir: projectDir,
    name: projectName,
    aspect,
    duration,
    visualStyle,
    profile,
  });
  const draftWarnings: string[] = [];
  if (fromBrief) {
    const draft = draftStoryboardFromBrief({
      name: projectName,
      brief: fromBrief,
      durationSec: duration,
      aspect,
      visualStyle,
    });
    const storyboardPath = resolve(projectDir, "STORYBOARD.md");
    const designPath = resolve(projectDir, "DESIGN.md");
    if (options.force || result.created.includes(storyboardPath) || !existsSync(storyboardPath)) {
      await writeFile(storyboardPath, draft.storyboardMd, "utf-8");
      if (!result.created.includes(storyboardPath)) result.created.push(storyboardPath);
    }
    if (options.force || result.created.includes(designPath) || !existsSync(designPath)) {
      await writeFile(designPath, draft.designMd, "utf-8");
      if (!result.created.includes(designPath)) result.created.push(designPath);
    }
    draftWarnings.push(...draft.warnings);
  }
  const detectedIds = detectedAgentHosts().map((h) => h.id);
  const skillResult =
    profile === "agent" || profile === "full"
      ? await installHyperframesSkill({
          projectDir,
          hosts: deriveInstallHosts(detectedIds),
        })
      : { success: true, files: [], bundleVersion: "not-installed" };

  if (isJsonMode()) {
    outputSuccess({
      command: "init",
      startedAt,
      data: {
        type: "scene",
        projectDir,
        name: projectName,
        profile,
        aspect,
        duration,
        visualStyle: visualStyle?.name ?? null,
        from: fromBrief ? summariseBrief(fromBrief) : null,
        created: result.created,
        merged: result.merged,
        skipped: result.skipped,
        groups: result.groups,
        skillFiles: skillResult.files,
        skillBundleVersion: skillResult.bundleVersion,
        warnings: draftWarnings,
      },
    });
    return;
  }

  console.log();
  console.log(chalk.bold.magenta("VibeFrame Init") + chalk.dim(" — video project ready"));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`${chalk.dim("Project")}  ${projectDir}`);
  console.log(`${chalk.dim("Profile")}  ${profile} ${chalk.dim(sceneProfileSummary(profile))}`);
  if (fromBrief) console.log(`${chalk.dim("Brief")}    ${summariseBrief(fromBrief)}`);
  for (const warning of draftWarnings) console.log(chalk.yellow(`Warning: ${warning}`));
  console.log();
  console.log(chalk.bold("Edit first"));
  console.log(
    `  ${chalk.cyan("STORYBOARD.md")}  ${chalk.dim("beats: narration, backdrop, minimum duration")}`
  );
  console.log(
    `  ${chalk.cyan("DESIGN.md")}      ${chalk.dim("palette, typography, motion rules")}`
  );
  console.log();
  console.log(chalk.bold("Then run"));
  console.log(
    `  ${chalk.cyan("vibe build")}   ${chalk.dim("build storyboard assets/compositions")}`
  );
  console.log(`  ${chalk.cyan("vibe render")}  ${chalk.dim("render final MP4")}`);
  console.log();
  console.log(chalk.bold("Files"));
  for (const p of result.created)
    console.log(chalk.green(`    + ${p.replace(projectDir + "/", "")}`));
  for (const p of result.merged)
    console.log(chalk.yellow(`    ~ ${p.replace(projectDir + "/", "")} (merged)`));
  for (const p of result.skipped)
    console.log(chalk.dim(`    · ${p.replace(projectDir + "/", "")} (kept existing)`));
  for (const f of skillResult.files.filter((f) => f.status === "wrote")) {
    console.log(chalk.green(`    + ${f.path.replace(projectDir + "/", "")}`));
  }
  console.log();
  console.log(chalk.dim(`Tip: cd ${projectDirArg} before running the next commands.`));
  console.log();
}

function sceneProfileSummary(profile: string): string {
  if (profile === "minimal") return "(storyboard/design only)";
  if (profile === "agent") return "(recommended: + local agent authoring rules)";
  return "(+ render scaffold upfront)";
}

function printSceneInitPlan(opts: {
  projectDir: string;
  profile: string;
  aspect: SceneAspect;
  duration: number;
  visualStyleName: string | null;
  briefSummary: string | null;
  groups: ReturnType<typeof describeSceneScaffold>;
  dryRun: boolean;
}): void {
  console.log();
  console.log(chalk.bold.magenta("VibeFrame Init") + chalk.dim(opts.dryRun ? " — dry run" : ""));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`${chalk.dim("Project")}  ${opts.projectDir}`);
  console.log(
    `${chalk.dim("Profile")}  ${opts.profile} ${chalk.dim(sceneProfileSummary(opts.profile))}`
  );
  console.log(`${chalk.dim("Canvas")}   ${opts.aspect} · ${opts.duration}s default`);
  if (opts.briefSummary) console.log(`${chalk.dim("Brief")}    ${opts.briefSummary}`);
  if (opts.visualStyleName) console.log(`${chalk.dim("Style")}    ${opts.visualStyleName}`);
  console.log();
  console.log(chalk.bold("Edit first"));
  console.log(
    `  ${chalk.cyan("STORYBOARD.md")}  ${chalk.dim("beats: narration, backdrop, minimum duration")}`
  );
  console.log(
    `  ${chalk.cyan("DESIGN.md")}      ${chalk.dim("palette, typography, motion rules")}`
  );
  console.log();
  console.log(chalk.bold("Project contents"));
  printGroup("authoring", opts.groups.authoring, opts.projectDir);
  printGroup("agent", opts.groups.agent, opts.projectDir);
  printGroup("render", opts.groups.render, opts.projectDir);
  console.log();
  console.log(
    chalk.dim("Dry run — no files were written. Re-run without --dry-run to create the project.")
  );
  console.log();
}

function printGroup(label: string, files: string[], projectDir: string): void {
  if (files.length === 0) return;
  console.log(`  ${chalk.bold(label)}`);
  for (const file of files) {
    console.log(chalk.dim(`    ${file.replace(projectDir + "/", "")}`));
  }
}

async function readBriefOrLiteral(value: string, cwd: string): Promise<string> {
  const candidate = resolve(cwd, value);
  if (existsSync(candidate)) {
    return readFile(candidate, "utf-8");
  }
  return value;
}

function summariseBrief(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  return compact.length > 100 ? `${compact.slice(0, 97)}...` : compact;
}

function resolveTargets(agent: AgentSelection): AgentHostId[] {
  if (agent === "all") {
    return ["claude-code", "codex", "cursor", "aider", "gemini-cli", "opencode"];
  }
  if (agent === "auto") {
    const detected = detectedAgentHosts().map((h) => h.id);
    if (detected.length > 0) return detected;
    // No host detected — return empty so the renderer falls back to
    // writing AGENTS.md (the safe-default branch in the action loop).
    return [];
  }
  return [agent];
}

async function writeIfMissing(
  absPath: string,
  content: string,
  force: boolean | undefined,
  dryRun: boolean | undefined
): Promise<InitFileAction> {
  const exists = existsSync(absPath);
  if (exists && !force) {
    return { path: absPath, status: "skipped-exists", reason: "(use --force to overwrite)" };
  }
  if (dryRun) {
    return { path: absPath, status: "would-write" };
  }
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf-8");
  return { path: absPath, status: "wrote" };
}

/**
 * .gitignore needs MERGE semantics, not overwrite — the user almost
 * certainly has lines we don't want to clobber. We append our block only
 * when our marker line isn't already present.
 */
async function mergeGitignore(
  absPath: string,
  additions: string,
  dryRun: boolean | undefined
): Promise<InitFileAction> {
  const marker = "# VibeFrame";
  if (!existsSync(absPath)) {
    if (dryRun) return { path: absPath, status: "would-write" };
    await writeFile(absPath, additions.trimStart(), "utf-8");
    return { path: absPath, status: "wrote" };
  }
  const existing = await readFile(absPath, "utf-8");
  if (existing.includes(marker)) {
    return { path: absPath, status: "skipped-exists", reason: "(already has VibeFrame block)" };
  }
  if (dryRun) return { path: absPath, status: "merged" };
  const trailing = existing.endsWith("\n") ? "" : "\n";
  await writeFile(absPath, existing + trailing + additions, "utf-8");
  return { path: absPath, status: "merged" };
}

function formatStatusIcon(status: InitFileAction["status"]): string {
  switch (status) {
    case "wrote":
      return chalk.green("✓");
    case "merged":
      return chalk.green("⊕");
    case "skipped-exists":
      return chalk.dim("○");
    case "would-write":
      return chalk.cyan("→");
    default:
      return "?";
  }
}
