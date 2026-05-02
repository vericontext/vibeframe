/**
 * @module manifest/status
 * @description Project/job status tools for agent and MCP surfaces.
 */

import { z } from "zod";
import { resolve } from "node:path";

import { defineTool, type AnyTool } from "../define-tool.js";
import {
  findProjectRoot,
  inspectProjectStatus,
  makeJobStatusResult,
  readJobRecord,
  refreshJobRecord,
} from "../../commands/_shared/status-jobs.js";

export const statusJobTool = defineTool({
  name: "status_job",
  category: "status",
  cost: "free",
  description:
    "Read one local async job record and optionally refresh supported provider status. Supports Runway/Kling video and Replicate music live checks.",
  schema: z.object({
    jobId: z.string().describe("Local job id returned by a no-wait command."),
    projectDir: z.string().optional().describe("Project directory containing .vibeframe/jobs. Defaults to nearest project root."),
    refresh: z.boolean().optional().describe("Call provider status APIs when supported. Default true."),
    wait: z.boolean().optional().describe("Wait for completion when supported."),
    output: z.string().optional().describe("Download result media to this path when complete."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : findProjectRoot(ctx.workingDirectory);
    const record = await readJobRecord(args.jobId, projectDir);
    if (!record) return { success: false, error: `Job not found: ${args.jobId}` };
    const result = args.refresh === false
      ? makeJobStatusResult(record, {
          refreshed: false,
          live: { supported: false },
          warnings: [],
        })
      : await refreshJobRecord(record, {
          wait: args.wait,
          output: args.output ? resolve(ctx.workingDirectory, args.output) : undefined,
          workingDirectory: ctx.workingDirectory,
        });
    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      humanLines: [
        `Job ${result.job.id}: ${result.job.status} (${result.job.provider})`,
        ...(result.job.outputPath ? [`output: ${result.job.outputPath}`] : []),
      ],
    };
  },
});

export const statusProjectTool = defineTool({
  name: "status_project",
  category: "status",
  cost: "free",
  description:
    "Summarize build-report.json, review-report.json, and local async job records for a VibeFrame project.",
  schema: z.object({
    projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
    refresh: z.boolean().optional().describe("Refresh active supported jobs before summarizing. Default false."),
  }),
  async execute(args, ctx) {
    const projectDir = args.projectDir ? resolve(ctx.workingDirectory, args.projectDir) : ctx.workingDirectory;
    const result = await inspectProjectStatus(projectDir, { refresh: args.refresh === true });
    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      humanLines: [
        `Project status: ${result.status} (${result.currentStage}), ${result.jobs.active} active job(s), ${result.jobs.failed} failed job(s)`,
        ...(result.build ? [`build: ${result.build.phase ?? "unknown"}`] : []),
        ...(result.review ? [`review: ${result.review.status ?? "unknown"} score ${result.review.score ?? "-"}`] : []),
      ],
    };
  },
});

export const statusTools: readonly AnyTool[] = [
  statusJobTool as unknown as AnyTool,
  statusProjectTool as unknown as AnyTool,
];
