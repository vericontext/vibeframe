/**
 * `vibe run` command — Execute declarative YAML video pipelines.
 *
 * Video as Code: define reproducible, shareable video workflows in YAML.
 * Each step maps to an existing CLI command's execute function.
 *
 * Usage:
 *   vibe run pipeline.yaml
 *   vibe run pipeline.yaml --dry-run
 *   vibe run pipeline.yaml --resume
 *   vibe run pipeline.yaml -o ./output/
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadPipeline, executePipeline } from "../pipeline/index.js";
import type { PipelineBudget } from "../pipeline/types.js";
import { outputResult, exitWithError, generalError, usageError } from "./output.js";
import { loadEnv } from "../utils/api-key.js";

export const runCommand = new Command("run")
  .description("Execute a YAML video pipeline (Video as Code)")
  .argument("<pipeline>", "Path to pipeline YAML file")
  .option("-o, --output <dir>", "Output directory for step results")
  .option("--dry-run", "Validate and show execution plan without running")
  .option("--resume", "Resume from last checkpoint (skip completed steps)")
  .option("--fail-fast", "Stop on first failed step (default: continue)")
  .option("--budget-usd <n>", "Abort if upper-bound cost estimate exceeds this USD amount", parseFloat)
  .option("--budget-tokens <n>", "Abort if provider token usage exceeds this count", parseInt)
  .option("--max-errors <n>", "Abort if failed step count exceeds this", parseInt)
  .option("--effort <level>", "LLM effort level: low|medium|high|xhigh (Opus 4.7)")
  .option("--json", "Output results as JSON")
  .addHelpText("after", `
Examples:
  $ vibe run my-pipeline.yaml
  $ vibe run my-pipeline.yaml --dry-run
  $ vibe run my-pipeline.yaml --resume -o ./output/
  $ vibe run my-pipeline.yaml --fail-fast
  $ vibe run my-pipeline.yaml --budget-usd 5 --max-errors 2
  $ vibe run my-pipeline.yaml --effort xhigh

Pipeline YAML format:
  name: my-video
  budget:              # optional — executor aborts when exceeded
    costUsd: 5.00
    maxToolErrors: 3
  effort: xhigh        # optional — Opus 4.7 Task Budgets
  steps:
    - id: image
      action: generate-image
      prompt: "sunset over mountains"
      output: backdrop.png
    - id: video
      action: generate-video
      prompt: "camera push in"
      image: $image.output
      duration: 10
      output: scene.mp4

Variable references: $step_id.output, $step_id.data.field, \${ENV_VAR}

Cost: Depends on steps. Use --dry-run to preview before executing.
Run 'vibe schema run' for structured parameter info.
`)
  .action(async (pipelinePath: string, options) => {
    // Pipeline steps call execute*() functions directly (not CLI actions),
    // so we must ensure .env is loaded before executor dispatches steps.
    loadEnv();
    const isJson = options.json || process.env.VIBE_JSON_OUTPUT === "1";

    // Build CLI budget override from flags (merged with manifest.budget in executor)
    const cliBudget: PipelineBudget = {};
    if (typeof options.budgetUsd === "number") cliBudget.costUsd = options.budgetUsd;
    if (typeof options.budgetTokens === "number") cliBudget.tokens = options.budgetTokens;
    if (typeof options.maxErrors === "number") cliBudget.maxToolErrors = options.maxErrors;
    const hasBudgetFlag = Object.keys(cliBudget).length > 0;

    if (options.effort && !["low", "medium", "high", "xhigh"].includes(options.effort)) {
      exitWithError(usageError(
        `Invalid --effort level: ${options.effort}`,
        "Use one of: low, medium, high, xhigh",
      ));
    }

    try {
      // Load and validate pipeline
      const manifest = await loadPipeline(pipelinePath);
      if (options.effort) manifest.effort = options.effort;

      if (!isJson) {
        console.log();
        console.log(chalk.bold.cyan(`  Pipeline: ${manifest.name}`));
        if (manifest.description) console.log(chalk.dim(`  ${manifest.description}`));
        console.log(chalk.dim(`  ${manifest.steps.length} steps`));
        if (manifest.effort) console.log(chalk.dim(`  effort: ${manifest.effort}`));
        console.log(chalk.dim("  " + "─".repeat(50)));
        console.log();
      }

      // Dry run
      if (options.dryRun) {
        const result = await executePipeline(manifest, {
          dryRun: true,
          outputDir: options.output,
          budget: hasBudgetFlag ? cliBudget : undefined,
        });

        if (isJson) {
          outputResult({
            dryRun: true,
            command: "run",
            name: manifest.name,
            steps: result.steps.map(s => ({ id: s.id, action: s.action, estimatedCost: (s.data as Record<string, unknown>)?.estimatedCost })),
            totalSteps: result.totalSteps,
            budget: result.budget,
          });
        } else {
          console.log(chalk.bold("  Execution Plan:"));
          console.log();
          for (let i = 0; i < result.steps.length; i++) {
            const step = result.steps[i];
            const est = (step.data as Record<string, unknown>)?.estimatedCost;
            const costTag = est ? chalk.dim(` ~${est}`) : "";
            console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.bold(step.id)} ${chalk.dim(`→ ${step.action}`)}${costTag}`);
          }
          if (result.budget) {
            console.log();
            console.log(chalk.dim(`  Total upper-bound: $${result.budget.estimatedCostUsd.toFixed(2)}`));
            if (result.budget.abortedBy) {
              console.log(chalk.yellow(`  ⚠ Budget ceiling exceeded (${result.budget.abortedBy}) — execution will abort.`));
            }
          }
          console.log();
          console.log(chalk.dim("  Run without --dry-run to execute."));
        }
        return;
      }

      // Execute pipeline
      const spinner = !isJson ? ora("Starting pipeline...").start() : null;

      const result = await executePipeline(manifest, {
        outputDir: options.output,
        resume: options.resume,
        failFast: options.failFast,
        budget: hasBudgetFlag ? cliBudget : undefined,
      });

      spinner?.stop();

      if (isJson) {
        outputResult({
          success: result.success,
          name: result.name,
          error: result.error,
          completedSteps: result.completedSteps,
          totalSteps: result.totalSteps,
          totalDuration: result.totalDuration,
          outputDir: result.outputDir,
          budget: result.budget,
          steps: result.steps.map(s => ({
            id: s.id,
            action: s.action,
            success: s.success,
            output: s.output,
            duration: s.duration,
            error: s.error,
            data: s.data,
          })),
        });
      } else {
        console.log();
        for (const step of result.steps) {
          const icon = step.success ? chalk.green("✓") : chalk.red("✗");
          const time = step.duration ? chalk.dim(` (${(step.duration / 1000).toFixed(1)}s)`) : "";
          const output = step.output ? chalk.dim(` → ${step.output}`) : "";
          console.log(`  ${icon} ${step.id}${time}${output}`);
          if (!step.success && step.error) {
            console.log(`    ${chalk.red(step.error)}`);
          }
        }

        console.log();
        console.log(chalk.dim("  " + "─".repeat(50)));
        console.log(`  ${chalk.bold(`${result.completedSteps}/${result.totalSteps} steps completed`)}${result.success ? chalk.green(" ✓") : ""}`);
        if (result.error) {
          console.log(chalk.red(`  ${result.error}`));
        }
        if (result.totalDuration) {
          console.log(chalk.dim(`  Total: ${(result.totalDuration / 1000).toFixed(1)}s`));
        }
        if (result.budget) {
          console.log(chalk.dim(`  Est. spent: $${result.budget.estimatedCostUsd.toFixed(2)}${result.budget.tokensUsed ? ` · ${result.budget.tokensUsed} tokens` : ""} · ${result.budget.toolErrors} errors`));
          if (result.budget.abortedBy) {
            console.log(chalk.yellow(`  ⚠ Aborted by budget: ${result.budget.abortedBy}`));
          }
        }
        if (result.outputDir) {
          console.log(chalk.dim(`  Output: ${result.outputDir}`));
        }
        console.log();

        if (!result.success) {
          console.log(chalk.dim("  Use --resume to retry failed steps."));
          console.log();
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(msg));
    }
  });
