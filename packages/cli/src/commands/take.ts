/**
 * `vibe take`: read the record of every paid generation.
 *
 * Every `generate video`, `generate image`, `edit image`, and video
 * extension leaves a take (see takes/take.ts and docs/take-graph.md). These
 * commands list them, show one in full, and total the spend, saying how much
 * of it is provider billing and how much is estimate.
 */

import { Command } from "commander";
import chalk from "chalk";

import { applyTiers } from "./_shared/cost-tier.js";
import { exitWithError, failureFromError, isJsonMode, notFoundError, outputSuccess, usageError } from "./output.js";
import { executeTakeList, executeTakeLog, executeTakeShow, type TakeScope } from "../takes/query.js";
import type { TakeKind } from "../takes/take.js";

const KINDS: readonly TakeKind[] = ["video", "image"];

function scopeOf(options: { project?: string; global?: boolean }): TakeScope {
  return { cwd: process.cwd(), projectDir: options.project, global: options.global === true };
}

function kindOf(value: unknown): TakeKind | undefined {
  if (value === undefined) return undefined;
  if (!KINDS.includes(value as TakeKind)) {
    exitWithError(usageError(`Invalid --kind "${String(value)}".`, `Use one of: ${KINDS.join(", ")}.`));
  }
  return value as TakeKind;
}

function usd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export const takeCommand = new Command("take")
  .description("List, inspect, and total the record of every paid generation (takes)")
  .addHelpText("after", `
A take is one generation as it happened: prompt, parameters, inputs and
outputs by hash, provider session, parent take, and cost with its basis
(reported by the provider, metered, estimate, or tier upper bound).

Inside a project, takes live in <project>/.vibeframe/takes/; elsewhere in
~/.vibeframe/takes/. Every take is also a line in ~/.vibeframe/ledger.jsonl,
which --global reads to cover every project on this machine.

Examples:
  $ vibe take list --json
  $ vibe take list --kind video --limit 10
  $ vibe take show take_mh2k1x0a_1f2e3d4c --json
  $ vibe take log --since 2026-11-01 --json
  $ vibe take log --global
`);

takeCommand
  .command("list")
  .description("List takes, newest first")
  .option("--project <dir>", "Read this project's takes instead of the one around the current directory")
  .option("--global", "Read the global ledger: every take on this machine, in any project")
  .option("--kind <kind>", `Only this kind: ${KINDS.join(", ")}`)
  .option("--beat <id>", "Only takes a build made for this storyboard beat")
  .option("--since <date>", "Only takes made on or after this date (e.g. 2026-11-01)")
  .option("--limit <n>", "Most takes to show (default 50)")
  .action(async (options) => {
    const startedAt = Date.now();
    try {
      const limit = options.limit !== undefined ? Number(options.limit) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
        exitWithError(usageError(`Invalid --limit "${options.limit}".`, "Use a positive whole number."));
      }
      const result = await executeTakeList(scopeOf(options), {
        kind: kindOf(options.kind),
        beatId: options.beat,
        since: options.since,
        limit,
      });
      if (isJsonMode()) {
        outputSuccess({ command: "take list", startedAt, data: result as unknown as Record<string, unknown> });
        return;
      }
      if (result.takes.length === 0) {
        console.log(chalk.dim(`No takes in ${result.store}.`));
        return;
      }
      for (const take of result.takes) {
        const where = take.beatId ? ` beat ${take.beatId}` : "";
        console.log(
          `${chalk.bold(take.id)}  ${take.createdAt.slice(0, 16).replace("T", " ")}  ${take.kind} ${take.operation}  ${take.provider}${take.model ? `/${take.model}` : ""}  ${take.status}  ${usd(take.usd)} (${take.basis})${where}`,
        );
      }
      if (result.total > result.takes.length) console.log(chalk.dim(`${result.takes.length} of ${result.total} shown; use --limit for more.`));
    } catch (error) {
      exitWithError(failureFromError(error, "Could not list takes", { fallback: "general" }));
    }
  });

takeCommand
  .command("show")
  .description("Show one take in full")
  .argument("<take-id>", "Take id, e.g. take_mh2k1x0a_1f2e3d4c")
  .option("--project <dir>", "Look in this project first")
  .action(async (id: string, options) => {
    const startedAt = Date.now();
    try {
      const found = await executeTakeShow(id, scopeOf(options));
      if (!found) {
        exitWithError({ ...notFoundError(id), error: `Take not found: ${id}`, suggestion: "Run 'vibe take list --global' to see every take on this machine." });
      }
      if (isJsonMode()) {
        outputSuccess({ command: "take show", startedAt, data: { store: found.store, take: found.take } as unknown as Record<string, unknown> });
        return;
      }
      const { take } = found;
      console.log(chalk.bold(take.id));
      console.log(`  ${take.kind} ${take.operation} · ${take.provider}${take.model ? `/${take.model}` : ""} · ${take.status}`);
      console.log(`  cost ${usd(take.cost.usd)} (${take.cost.basis})`);
      if (take.parent) console.log(`  parent ${take.parent}`);
      console.log(`  prompt ${take.prompt}`);
      for (const output of take.outputs) console.log(`  output ${output.path}`);
      for (const input of take.inputs) console.log(`  input (${input.role}) ${input.path}`);
      console.log(chalk.dim(`  ${take.origin.via}: ${take.origin.command} · ${take.createdAt}`));
    } catch (error) {
      exitWithError(failureFromError(error, "Could not read the take", { fallback: "general" }));
    }
  });

takeCommand
  .command("log")
  .description("Total the spend on takes, and how much of it is provider billing")
  .option("--project <dir>", "Total this project's takes instead of the one around the current directory")
  .option("--global", "Total the global ledger: every take on this machine, in any project")
  .option("--kind <kind>", `Only this kind: ${KINDS.join(", ")}`)
  .option("--beat <id>", "Only takes a build made for this storyboard beat")
  .option("--since <date>", "Only takes made on or after this date (e.g. 2026-11-01)")
  .action(async (options) => {
    const startedAt = Date.now();
    try {
      const result = await executeTakeLog(scopeOf(options), { kind: kindOf(options.kind), beatId: options.beat, since: options.since });
      if (isJsonMode()) {
        outputSuccess({ command: "take log", startedAt, data: result as unknown as Record<string, unknown> });
        return;
      }
      console.log(`${chalk.bold(usd(result.totalUsd))} over ${result.takes} take(s)${result.since ? ` since ${result.since}` : ""} (${result.store})`);
      const billed = result.byBasis.reported + result.byBasis.metered;
      console.log(`  billing ${usd(billed)} · estimate ${usd(result.byBasis.estimate)} · upper bound ${usd(result.byBasis["upper-bound"])}`);
      if (result.failed.takes > 0) console.log(`  failed takes ${result.failed.takes} (${usd(result.failed.usd)})`);
      for (const g of result.byModel) console.log(`  ${g.key}  ${g.takes} take(s)  ${usd(g.usd)}`);
    } catch (error) {
      exitWithError(failureFromError(error, "Could not total takes", { fallback: "general" }));
    }
  });

applyTiers(takeCommand, { list: "free", show: "free", log: "free" });
