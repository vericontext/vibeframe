/**
 * @module commands/init
 *
 * `vibe init [project-dir]` — v0.61 C2 project-scope scaffolder.
 *
 * Pairs with v0.61 C1 `vibe setup` (user scope). Where setup writes
 * machine-wide config (`~/.vibeframe/config.json`), init writes
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
  AGENTS_MD,
  CLAUDE_MD,
  GITIGNORE_ADDITIONS,
  renderEnvExample,
  renderProjectYaml,
} from "./_shared/init-templates.js";
import { exitWithError, isJsonMode, outputResult, usageError } from "./output.js";

type AgentSelection = AgentHostId | "all" | "auto";

const VALID_AGENTS: readonly AgentSelection[] = ["claude-code", "codex", "cursor", "aider", "all", "auto"];

interface InitFileAction {
  path: string;
  status: "wrote" | "skipped-exists" | "merged" | "would-write";
  reason?: string;
}

export const initCommand = new Command("init")
  .description("Scaffold project-scope agent files (AGENTS.md / CLAUDE.md / .env.example / .gitignore)")
  .argument("[project-dir]", "Project directory (defaults to cwd)", ".")
  .option("--agent <id>", `Agent target: ${VALID_AGENTS.join(" | ")}`, "auto")
  .option("--force", "Overwrite existing files instead of skipping")
  .option("--dry-run", "Print the file list without writing anything")
  .action(async (projectDirArg: string, options) => {
    const agent = options.agent as AgentSelection;
    if (!VALID_AGENTS.includes(agent)) {
      exitWithError(usageError(`Invalid --agent: ${agent}`, `Must be one of: ${VALID_AGENTS.join(", ")}`));
    }

    const projectDir = resolve(projectDirArg);
    const projectName = basename(projectDir);

    // Resolve which agent hosts we're scaffolding for. "auto" = detect;
    // "all" = every host we know about; otherwise the explicit set.
    const targetHosts = resolveTargets(agent);
    const wantsClaude = targetHosts.includes("claude-code");
    const wantsCrossTool = targetHosts.some((h) => h !== "claude-code");

    const actions: InitFileAction[] = [];

    // Ensure project dir exists (writing into a fresh dir is a common case).
    if (!existsSync(projectDir)) {
      if (options.dryRun) {
        actions.push({ path: projectDir, status: "would-write", reason: "(would create directory)" });
      } else {
        await mkdir(projectDir, { recursive: true });
      }
    }

    // ── AGENTS.md (cross-tool) ─────────────────────────────────────────
    // Always write AGENTS.md unless explicitly Claude-only — it's the
    // canonical agent guidance file and CLAUDE.md imports it.
    if (wantsCrossTool || !wantsClaude) {
      actions.push(await writeIfMissing(
        resolve(projectDir, "AGENTS.md"),
        AGENTS_MD,
        options.force,
        options.dryRun,
      ));
    }

    // ── CLAUDE.md (Claude Code, imports @AGENTS.md) ────────────────────
    if (wantsClaude) {
      actions.push(await writeIfMissing(
        resolve(projectDir, "CLAUDE.md"),
        CLAUDE_MD,
        options.force,
        options.dryRun,
      ));
    }

    // ── .env.example (always) ──────────────────────────────────────────
    actions.push(await writeIfMissing(
      resolve(projectDir, ".env.example"),
      renderEnvExample(),
      options.force,
      options.dryRun,
    ));

    // ── .gitignore (merge — never overwrite) ───────────────────────────
    actions.push(await mergeGitignore(
      resolve(projectDir, ".gitignore"),
      GITIGNORE_ADDITIONS,
      options.dryRun,
    ));

    // ── vibe.project.yaml (only when missing) ──────────────────────────
    actions.push(await writeIfMissing(
      resolve(projectDir, "vibe.project.yaml"),
      renderProjectYaml({ name: projectName }),
      options.force,
      options.dryRun,
    ));

    // ── Output ─────────────────────────────────────────────────────────
    if (isJsonMode()) {
      outputResult({
        command: "init",
        projectDir,
        agent,
        targetHosts,
        actions,
        dryRun: options.dryRun ?? false,
      });
      return;
    }

    console.log();
    console.log(chalk.bold.magenta("VibeFrame Init") + chalk.dim(" — project scope"));
    console.log(chalk.dim("─".repeat(50)));
    console.log(chalk.dim(`Project:  ${projectDir}`));
    console.log(chalk.dim(`Agent:    ${agent}${agent === "auto" ? ` (resolved → ${targetHosts.join(", ") || "fallback"})` : ""}`));
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
      console.log(chalk.dim("    bash <(curl -fsSL https://raw.githubusercontent.com/vericontext/vibeframe/main/scripts/install-skills.sh)"));
      console.log(chalk.dim("                                  Install /vibeframe + /vibe-* slash commands"));
    }
    console.log(chalk.dim("    cp .env.example .env          Add your API keys"));
    console.log(chalk.dim("    vibe doctor                   Check what's configured"));
    console.log(chalk.dim("    vibe scene init my-promo      Scaffold a starter scene project"));
    console.log();
  });

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveTargets(agent: AgentSelection): AgentHostId[] {
  if (agent === "all") {
    return ["claude-code", "codex", "cursor", "aider"];
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
  dryRun: boolean | undefined,
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
async function mergeGitignore(absPath: string, additions: string, dryRun: boolean | undefined): Promise<InitFileAction> {
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
    case "wrote":           return chalk.green("✓");
    case "merged":          return chalk.green("⊕");
    case "skipped-exists":  return chalk.dim("○");
    case "would-write":     return chalk.cyan("→");
    default:                return "?";
  }
}
