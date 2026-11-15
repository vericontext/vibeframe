/**
 * Settling a submitted take.
 *
 * A generation that returns before the provider finishes (`--no-wait`, a
 * build whose wait ran out) is recorded as a `submitted` take with no
 * output. `vibe status job` later sees the job finish and settles that
 * take once: its status, its output files (hashed, and preserved for a
 * project take), what the provider billed, and `settledAt`. A take that is
 * not `submitted` is left alone, so refreshing a job again changes nothing.
 */

import { existsSync } from "node:fs";

import type { VideoUsage } from "@vibeframe/ai-providers";

import { findTake } from "./query.js";
import { costOf, preserveOutput, storedPath, takesDisabled } from "./record.js";
import { hashFile, writeTake, type Take, type TakeFile } from "./take.js";

export interface SettleTakeOptions {
  takeId: string;
  /** Where the job ran; the take is looked up from here. */
  cwd: string;
  status: "completed" | "failed";
  /** The downloaded result, for a completed job. */
  outputPath?: string;
  /** What the provider reported the finished job charged. */
  usage?: VideoUsage;
  error?: string;
}

export interface SettleTakeResult {
  takeId: string;
  /** False when the take was already settled (or never submitted), so nothing was written. */
  settled: boolean;
  take?: Take;
}

export async function settleSubmittedTake(options: SettleTakeOptions, now: Date = new Date()): Promise<SettleTakeResult | undefined> {
  if (takesDisabled()) return undefined;
  const found = await findTake(options.takeId, { cwd: options.cwd });
  if (!found) return undefined;
  const { take, store } = found;
  if (take.status !== "submitted") return { takeId: take.id, settled: false, take };

  const outputs: TakeFile[] = [];
  if (options.status === "completed" && options.outputPath && existsSync(options.outputPath)) {
    const file = await hashFile(options.outputPath);
    outputs.push({ ...file, path: storedPath(options.outputPath, store.projectDir) });
    if (store.projectDir) await preserveOutput(store.projectDir, options.outputPath, file);
  }
  // A charge reported at completion replaces the estimate made at submission.
  const cost = options.usage ? costOf([{ ...options.usage, at: now.getTime() }], () => take.cost) : take.cost;
  const settled: Take = {
    ...take,
    status: options.status,
    outputs: outputs.length > 0 ? outputs : take.outputs,
    cost,
    ...(options.status === "failed" ? { error: { message: options.error ?? "The provider job failed." } } : {}),
    settledAt: now.toISOString(),
  };
  await writeTake(settled, store);
  return { takeId: take.id, settled: true, take: settled };
}
