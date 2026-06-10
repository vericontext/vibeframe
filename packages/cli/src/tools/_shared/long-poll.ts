/**
 * @module tools/_shared/long-poll
 * @description Long-poll promotion for long-running MCP tool calls.
 *
 * MCP hosts (notably Claude Desktop) time out tool calls after a minute or
 * two, while `build`/`render` legitimately run for many minutes. The fix:
 * run the work normally, and if it finishes inside the synchronous window
 * return its result untouched — byte-identical to the unwrapped call, and no
 * job record is ever written. If the window elapses first, persist a local
 * {@link JobRecord} (jobType "build"/"render", provider "local"), return a
 * `promoted` envelope immediately, and let the work continue in-process; the
 * settle handlers write the terminal record that `status_job` then serves.
 *
 * CLI surfaces never reach this module — callers gate on
 * `ctx.surface === "mcp"`.
 */

import type { ToolExecuteResult } from "../define-tool.js";
import {
  createAndWriteJobRecord,
  writeJobRecord,
  type JobRecord,
} from "../../commands/_shared/status-jobs.js";

export interface LocalJobUpdate {
  /** 0-100 when a percentage is known; otherwise omit. */
  progress?: number;
  /** Pipeline stage label, e.g. "assets" | "compose" | "render". */
  stage?: string;
  message?: string;
}

export interface PromotionOptions {
  jobType: "build" | "render";
  /** Absolute project dir — the job record lands in `<projectDir>/.vibeframe/jobs/`. */
  projectDir: string;
  /** CLI equivalent of this invocation, stored on the record for retryWith. */
  command: string;
  /** Synchronous window before promotion. Default 45s; see resolveWindowMs. */
  windowMs?: number;
  /** Heartbeat cadence once promoted. Default 10s. */
  heartbeatMs?: number;
  now?: () => Date;
}

const DEFAULT_WINDOW_MS = 45_000;
const DEFAULT_HEARTBEAT_MS = 10_000;
/** Coalesce job-record disk writes from rapid progress updates. */
const RECORD_WRITE_INTERVAL_MS = 2_000;

/**
 * Resolve the promotion window. `VIBE_MCP_PROMOTE_AFTER_MS` overrides the
 * default; `"off"` or `"0"` disables promotion entirely (pure synchronous
 * behavior — the escape hatch for hosts with generous timeouts).
 */
export function resolveWindowMs(optionMs?: number): number | null {
  const env = process.env.VIBE_MCP_PROMOTE_AFTER_MS;
  if (env !== undefined) {
    if (env === "off" || env === "0") return null;
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (optionMs !== undefined) return optionMs > 0 ? optionMs : null;
  return DEFAULT_WINDOW_MS;
}

/**
 * Run `work`; promote to a polled background job if it outlives the window.
 *
 * The `report` callback passed to `work` is safe to call at any time: before
 * promotion it only buffers the latest update (callers typically also feed
 * `ctx.onProgress` for MCP progress notifications); after promotion it
 * coalesces updates into the job record on disk.
 */
export async function runWithMcpPromotion(
  work: (report: (update: LocalJobUpdate) => void) => Promise<ToolExecuteResult>,
  opts: PromotionOptions
): Promise<ToolExecuteResult> {
  const windowMs = resolveWindowMs(opts.windowMs);
  let latest: LocalJobUpdate = {};
  let record: JobRecord | null = null;
  let lastRecordWriteAt = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const writeRecord = async (patch: Partial<JobRecord>): Promise<void> => {
    if (!record) return;
    record = {
      ...record,
      ...patch,
      updatedAt: (opts.now?.() ?? new Date()).toISOString(),
    };
    try {
      await writeJobRecord(record);
    } catch {
      // A failed status write must never take down the actual work.
    }
  };

  const report = (update: LocalJobUpdate): void => {
    latest = { ...latest, ...update };
    if (!record) return;
    const now = Date.now();
    if (now - lastRecordWriteAt < RECORD_WRITE_INTERVAL_MS) return;
    lastRecordWriteAt = now;
    void writeRecord({
      progress: latest.progress,
      stage: latest.stage,
      message: latest.message,
      heartbeatAt: new Date().toISOString(),
    });
  };

  const workPromise = work(report);

  if (windowMs === null) return workPromise;

  const settled = await Promise.race([
    workPromise.then(
      (result) => ({ kind: "result" as const, result }),
      (error) => ({ kind: "error" as const, error })
    ),
    new Promise<{ kind: "window" }>((resolveRace) => {
      const timer = setTimeout(() => resolveRace({ kind: "window" }), windowMs);
      timer.unref?.();
      // Swallow on both paths: the rejection is consumed by the race
      // participant above (or the settle handlers after promotion).
      workPromise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer)
      );
    }),
  ]);

  if (settled.kind === "result") return settled.result;
  if (settled.kind === "error") throw settled.error;

  // Window elapsed — promote. From here on the work continues in-process and
  // all outcomes land in the job record instead of the tool response.
  const startedAt = (opts.now?.() ?? new Date()).toISOString();
  record = await createAndWriteJobRecord({
    jobType: opts.jobType,
    status: "running",
    provider: "local",
    providerTaskId: `local-${opts.jobType}`,
    projectDir: opts.projectDir,
    command: opts.command,
    progress: latest.progress,
    stage: latest.stage,
    message: latest.message,
    pid: process.pid,
    heartbeatAt: startedAt,
  });
  // providerTaskId must be a non-empty string for the record parser; make it
  // self-referential so logs stay readable.
  await writeRecord({ providerTaskId: record.id });

  heartbeat = setInterval(() => {
    void writeRecord({ heartbeatAt: new Date().toISOString() });
  }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat.unref?.();

  void workPromise
    .then(
      (result) =>
        writeRecord(
          result.success
            ? {
                status: "completed",
                progress: 100,
                resultPayload: result.data,
                outputPath: pickOutputPath(result.data),
              }
            : {
                status: "failed",
                error: result.error ?? "unknown error",
                resultPayload: result.data,
              }
        ),
      (error) =>
        writeRecord({
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
    )
    .finally(() => {
      if (heartbeat) clearInterval(heartbeat);
    });

  return {
    success: true,
    data: {
      promoted: true,
      status: "running",
      jobId: record.id,
      jobType: opts.jobType,
      projectDir: opts.projectDir,
      ...(latest.progress !== undefined ? { progress: latest.progress } : {}),
      ...(latest.stage ? { stage: latest.stage } : {}),
      ...(latest.message ? { message: latest.message } : {}),
      startedAt,
      poll: {
        tool: "status_job",
        args: { jobId: record.id, projectDir: opts.projectDir },
        intervalSeconds: 15,
      },
      retryWith: [`vibe status job ${record.id} --project ${opts.projectDir} --json`],
      hint:
        `${opts.jobType} exceeded the synchronous window and continues inside the MCP server. ` +
        `Poll status_job until status is "completed" (full result under result.payload) or "failed". ` +
        `Do NOT re-run ${opts.jobType} — the work is still running.`,
    },
    humanLines: [`⏳ ${opts.jobType} promoted to background job ${record.id} — poll status_job.`],
  };
}

function pickOutputPath(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const candidate = data.absoluteOutputPath ?? data.outputPath;
  return typeof candidate === "string" ? candidate : undefined;
}
