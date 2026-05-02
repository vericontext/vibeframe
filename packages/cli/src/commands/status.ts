import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";

import { applyTier } from "./_shared/cost-tier.js";
import {
  findProjectRoot,
  inspectProjectStatus,
  makeJobStatusResult,
  readJobRecord,
  refreshJobRecord,
  type JobRecord,
  type JobStatusResult,
  type ProjectStatusResult,
} from "./_shared/status-jobs.js";
import { exitWithError, generalError, isJsonMode, outputSuccess } from "./output.js";

export const statusCommand = new Command("status")
  .description("Inspect local async jobs and project workflow status")
  .addHelpText("after", `
Examples:
  $ vibe status job job_abc123 --json
  $ vibe status job job_abc123 --project my-video --wait -o out.mp4 --json
  $ vibe status project my-video --json
  $ vibe status project my-video --refresh --json
`);

statusCommand
  .command("job")
  .description("Show one async job status")
  .argument("<job-id>", "Local job id from a no-wait command")
  .option("--project <dir>", "Project directory containing .vibeframe/jobs")
  .option("--no-refresh", "Read local job record only; do not call provider APIs")
  .option("--wait", "Wait for completion when the provider status helper supports it")
  .option("-o, --output <path>", "Download result media when complete")
  .action(async (jobId: string, options) => {
    const startedAt = Date.now();
    try {
      const projectDir = options.project ? resolve(options.project) : findProjectRoot();
      const record = await readJobRecord(jobId, projectDir);
      if (!record) {
        exitWithError(generalError(`Job not found: ${jobId}`, `Run 'vibe status project ${projectDir} --json' to list known jobs.`));
      }
      const result = options.refresh === false
        ? localJobStatus(record)
        : await refreshJobRecord(record, {
            wait: options.wait,
            output: options.output,
            workingDirectory: process.cwd(),
          });

      if (isJsonMode()) {
        outputSuccess({
          command: "status job",
          startedAt,
          data: result as unknown as Record<string, unknown>,
          warnings: result.warnings,
        });
        return;
      }
      printJobStatus(result);
    } catch (error) {
      exitWithError(generalError(error instanceof Error ? error.message : String(error)));
    }
  });
applyTier(statusCommand.commands[statusCommand.commands.length - 1], "free");

statusCommand
  .command("project")
  .description("Summarize build, review, and async job status for a project")
  .argument("[project-dir]", "VibeFrame project directory", ".")
  .option("--refresh", "Refresh active supported jobs before summarizing")
  .action(async (projectDirArg: string, options) => {
    const startedAt = Date.now();
    try {
      const result = await inspectProjectStatus(resolve(projectDirArg), {
        refresh: options.refresh === true,
      });
      if (isJsonMode()) {
        outputSuccess({
          command: "status project",
          startedAt,
          data: result as unknown as Record<string, unknown>,
          warnings: result.warnings,
        });
        return;
      }
      printProjectStatus(result);
    } catch (error) {
      exitWithError(generalError(error instanceof Error ? error.message : String(error)));
    }
  });
applyTier(statusCommand.commands[statusCommand.commands.length - 1], "free");

function localJobStatus(record: JobRecord): JobStatusResult {
  return makeJobStatusResult(record, {
    refreshed: false,
    live: { supported: false },
    warnings: [],
  });
}

function printJobStatus(result: JobStatusResult): void {
  const job = result.job;
  console.log();
  console.log(chalk.bold.cyan("Job Status"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Job:       ${chalk.bold(job.id)}`);
  console.log(`  Type:      ${job.jobType}`);
  console.log(`  Status:    ${formatStatus(job.status)}`);
  console.log(`  Provider:  ${job.provider}`);
  console.log(`  Task ID:   ${job.providerTaskId}`);
  if (job.progress !== undefined) console.log(`  Progress:  ${job.progress}%`);
  if (job.resultUrl) console.log(`  Result:    ${job.resultUrl}`);
  if (job.outputPath) console.log(`  Output:    ${job.outputPath}`);
  if (job.error) console.log(`  Error:     ${chalk.red(job.error)}`);
  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) console.log(chalk.yellow(`  Warning: ${warning}`));
  }
}

function printProjectStatus(result: ProjectStatusResult): void {
  console.log();
  console.log(chalk.bold.cyan("Project Status"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:   ${chalk.bold(result.project)}`);
  console.log(`  Status:    ${formatStatus(result.status)} (${result.currentStage})`);
  console.log(`  Beats:     ${result.beats.assetsReady}/${result.beats.total} assets, ${result.beats.compositionsReady}/${result.beats.total} compositions`);
  console.log(`  Build:     ${result.build ? formatBuild(result.build) : chalk.dim("no build-report.json")}`);
  console.log(`  Review:    ${result.review ? formatReview(result.review) : chalk.dim("no review-report.json")}`);
  console.log(`  Jobs:      ${result.jobs.total} total, ${result.jobs.active} active, ${result.jobs.failed} failed`);
  if (result.jobs.latest.length > 0) {
    console.log();
    for (const job of result.jobs.latest.slice(0, 5)) {
      console.log(`  ${formatStatus(job.status)} ${chalk.dim(job.id)} ${job.jobType} ${job.provider}`);
    }
  }
  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) console.log(chalk.yellow(`  Warning: ${warning}`));
  }
}

function formatBuild(build: NonNullable<ProjectStatusResult["build"]>): string {
  const phase = build.phase ?? "unknown";
  const ok = build.success === false ? chalk.red("failed") : chalk.green("ok");
  return `${ok} ${phase}${build.outputPath ? ` -> ${build.outputPath}` : ""}`;
}

function formatReview(review: NonNullable<ProjectStatusResult["review"]>): string {
  const status = review.status ?? "unknown";
  return `${formatStatus(status)} score ${review.score ?? "-"} (${review.issueCount} issue${review.issueCount === 1 ? "" : "s"})`;
}

function formatStatus(status: string): string {
  if (status === "completed" || status === "pass") return chalk.green(status);
  if (status === "failed" || status === "fail") return chalk.red(status);
  if (status === "cancelled") return chalk.gray(status);
  if (status === "running" || status === "queued" || status === "warn") return chalk.yellow(status);
  return chalk.dim(status);
}
