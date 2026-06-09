/**
 * @module commands/host
 *
 * App-host integration helpers. VibeFrame remains CLI-first, but host apps
 * can connect through project guidance files and the MCP server.
 */

import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";

import { commandExists } from "../utils/exec-safe.js";
import { applyTier } from "./_shared/cost-tier.js";
import {
  HOST_SELECTIONS,
  hostDefinitions,
  inspectHost,
  planHostSetup,
  resolveHostSelection,
  type HostSelection,
  type HostSetupPlan,
  type HostDoctorResult,
} from "./_shared/host-integration.js";
import { exitWithError, isJsonMode, outputSuccess, usageError } from "./output.js";

export const hostCommand = new Command("host")
  .description("Set up Codex, Claude, and Cursor app integrations")
  .addHelpText(
    "after",
    `
Examples:
  $ vibe host list --json
  $ vibe host setup all                 Print MCP/project config snippets
  $ vibe host setup cursor --write      Write .cursor/mcp.json
  $ vibe host doctor all --json         Check host-app readiness
`
  );

hostCommand
  .command("list")
  .description("List supported app hosts and integration surfaces")
  .action(() => {
    const startedAt = Date.now();
    const hosts = hostDefinitions(resolve(".")).map((host) => ({
      id: host.id,
      label: host.label,
      surfaces: host.surfaces,
      guidanceFiles: host.guidanceFiles,
      notes: host.notes,
    }));

    if (isJsonMode()) {
      outputSuccess({ command: "host list", startedAt, data: { hosts } });
      return;
    }

    console.log();
    console.log(chalk.bold.cyan("Supported Host Apps"));
    console.log(chalk.dim("─".repeat(60)));
    for (const host of hosts) {
      console.log(`  ${chalk.bold(host.label)} ${chalk.dim(`(${host.id})`)}`);
      console.log(chalk.dim(`    surfaces: ${host.surfaces.join(", ")}`));
      if (host.guidanceFiles.length > 0) {
        console.log(chalk.dim(`    files:    ${host.guidanceFiles.join(", ")}`));
      }
    }
    console.log();
  });
applyTier(hostCommand.commands[hostCommand.commands.length - 1], "free");

hostCommand
  .command("setup")
  .description("Print or write Codex/Claude/Cursor MCP and project integration config")
  .argument("[host]", `Host target: ${HOST_SELECTIONS.join(" | ")}`, "all")
  .argument("[project-dir]", "Project directory for project-scoped config", ".")
  .option("--write", "Write config files instead of printing snippets only")
  .option("--dry-run", "Show file actions without writing")
  .option("--force", "Replace an existing vibeframe MCP entry")
  .action(async (hostArg: string, projectDirArg: string, options) => {
    const startedAt = Date.now();
    const selection = validateHostSelection(hostArg);
    const projectDir = resolve(projectDirArg);
    const ids = resolveHostSelection(selection);
    const defs = hostDefinitions(projectDir).filter((host) => ids.includes(host.id));
    const plans: HostSetupPlan[] = [];

    for (const host of defs) {
      plans.push(
        await planHostSetup(host, projectDir, {
          write: Boolean(options.write),
          dryRun: Boolean(options.dryRun),
          force: Boolean(options.force),
        })
      );
    }

    if (isJsonMode()) {
      outputSuccess({
        command: "host setup",
        startedAt,
        ...(options.dryRun ? { dryRun: true } : {}),
        data: {
          projectDir,
          selection,
          write: Boolean(options.write),
          hosts: plans.map(serializeSetupPlan),
        },
        warnings: plans.flatMap((plan) => plan.warnings),
      });
      return;
    }

    printSetupPlans(plans, { write: Boolean(options.write), dryRun: Boolean(options.dryRun) });
  });
applyTier(hostCommand.commands[hostCommand.commands.length - 1], "free");

hostCommand
  .command("doctor")
  .description("Check Codex/Claude/Cursor app integration readiness")
  .argument("[host]", `Host target: ${HOST_SELECTIONS.join(" | ")}`, "all")
  .argument("[project-dir]", "Project directory to inspect", ".")
  .action(async (hostArg: string, projectDirArg: string) => {
    const startedAt = Date.now();
    const selection = validateHostSelection(hostArg);
    const projectDir = resolve(projectDirArg);
    const ids = resolveHostSelection(selection);
    const defs = hostDefinitions(projectDir).filter((host) => ids.includes(host.id));
    const hosts = await Promise.all(defs.map((host) => inspectHost(host, projectDir)));
    const system = {
      vibe: commandExists("vibe"),
      npx: commandExists("npx"),
    };
    const warnings = [
      ...(system.vibe ? [] : ["vibe binary not found on PATH"]),
      ...(system.npx ? [] : ["npx not found on PATH; MCP stdio config needs npx"]),
      ...hosts.flatMap((host) => host.warnings),
    ];

    if (isJsonMode()) {
      outputSuccess({
        command: "host doctor",
        startedAt,
        data: {
          projectDir,
          selection,
          system,
          hosts: hosts.map(serializeDoctorResult),
        },
        warnings,
      });
      return;
    }

    printDoctor(hosts, system, warnings);
  });
applyTier(hostCommand.commands[hostCommand.commands.length - 1], "free");

function validateHostSelection(value: string): HostSelection {
  if ((HOST_SELECTIONS as readonly string[]).includes(value)) return value as HostSelection;
  exitWithError(
    usageError(`Invalid host target: ${value}`, `Must be one of: ${HOST_SELECTIONS.join(", ")}`)
  );
}

function serializeSetupPlan(plan: HostSetupPlan): Record<string, unknown> {
  return {
    id: plan.host.id,
    label: plan.host.label,
    surfaces: plan.host.surfaces,
    configPath: plan.configPath,
    snippet: plan.snippet,
    ...(plan.command ? { command: plan.command } : {}),
    files: plan.files,
    warnings: plan.warnings,
    nextSteps: plan.nextSteps,
  };
}

function serializeDoctorResult(result: HostDoctorResult): Record<string, unknown> {
  return {
    id: result.host.id,
    label: result.host.label,
    surfaces: result.host.surfaces,
    configPath: result.configPath,
    configured: result.configured,
    guidanceFiles: result.guidanceFiles,
    warnings: result.warnings,
    nextSteps: result.nextSteps,
  };
}

function printSetupPlans(plans: HostSetupPlan[], opts: { write: boolean; dryRun: boolean }): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Host Setup"));
  console.log(chalk.dim("─".repeat(60)));
  if (!opts.write) {
    console.log(chalk.dim("Snippet mode — no files were changed. Pass --write to apply."));
  } else if (opts.dryRun) {
    console.log(chalk.dim("Dry run — no files were changed."));
  }

  for (const plan of plans) {
    console.log();
    console.log(chalk.bold(plan.host.label) + chalk.dim(` (${plan.host.id})`));
    console.log(chalk.dim(`Config: ${plan.configPath}`));
    if (plan.command) console.log(chalk.dim(`Command: ${plan.command}`));
    console.log();
    console.log(plan.snippet);
    if (plan.files.length > 0) {
      console.log();
      for (const file of plan.files) {
        console.log(`  ${formatAction(file.status)} ${file.path}${file.reason ? chalk.dim(` ${file.reason}`) : ""}`);
      }
    }
    for (const warning of plan.warnings) console.log(chalk.yellow(`  Warning: ${warning}`));
  }
  console.log();
}

function printDoctor(
  hosts: HostDoctorResult[],
  system: { vibe: boolean; npx: boolean },
  warnings: string[]
): void {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Host Doctor"));
  console.log(chalk.dim("─".repeat(60)));
  console.log(`  vibe: ${system.vibe ? chalk.green("OK") : chalk.red("MISSING")}`);
  console.log(`  npx:  ${system.npx ? chalk.green("OK") : chalk.red("MISSING")}`);
  console.log();
  for (const host of hosts) {
    console.log(chalk.bold(host.host.label) + chalk.dim(` (${host.host.id})`));
    console.log(`  MCP config: ${host.configured ? chalk.green("OK") : chalk.yellow("missing")} ${chalk.dim(host.configPath)}`);
    for (const file of host.guidanceFiles) {
      const ok = file.status !== "missing";
      console.log(`  ${ok ? chalk.green("OK") : chalk.yellow("MISSING")} ${chalk.dim(file.path)}`);
    }
    console.log();
  }
  for (const warning of warnings) console.log(chalk.yellow(`Warning: ${warning}`));
}

function formatAction(status: string): string {
  if (status === "wrote" || status === "merged") return chalk.green("✓");
  if (status.startsWith("would")) return chalk.cyan("→");
  if (status === "missing") return chalk.yellow("!");
  return chalk.dim("○");
}
