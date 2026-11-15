/**
 * Pruning a project's take media: `<project>/.vibeframe/media/`.
 *
 * A project take keeps a copy of its output bytes there so it can be
 * promoted back after its slot file was regenerated. Copies pile up with
 * every regeneration. Pruning removes:
 * - copies no take refers to (a take file was deleted), and temp files a
 *   crashed copy left behind (older than an hour, so a copy in progress is
 *   left alone): always, since nothing can use them;
 * - with `slotsOnly`, also the copies of takes that do not fill a beat slot
 *   now. Those takes stay recorded (prompt, cost, provenance) but can no
 *   longer be promoted from their copy; the result names them.
 *
 * Take records and slot files are never touched. Free and local.
 */

import { existsSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { executorFailure, usageError, type ExecutorFailure } from "../commands/output.js";
import { projectSlots } from "./slots.js";
import { findProject, listTakes, projectTakeStore, takeMediaPath } from "./take.js";

export interface TakePruneOptions {
  /** The directory the call runs from; the project is found around it. */
  cwd: string;
  /** The project to prune, instead of the one around `cwd`. */
  projectDir?: string;
  /** Also remove the copies of takes that do not fill a slot now. */
  slotsOnly?: boolean;
  dryRun?: boolean;
}

export type PruneReason = "unreferenced" | "temp" | "not-in-slot";

export interface PrunedFile {
  /** The file name under `.vibeframe/media/`. */
  file: string;
  bytes: number;
  reason: PruneReason;
  /** The takes whose copy it was (for `not-in-slot`). */
  takeIds?: string[];
}

export interface TakePruneResult {
  success: true;
  dryRun: boolean;
  projectDir: string;
  /** `.vibeframe/media/`, relative to the project. */
  mediaDir: string;
  removed: PrunedFile[];
  /** Total size of the removed files. A copy-on-write clone may have used less disk than this. */
  freedBytes: number;
  /** Copies left in place. */
  kept: number;
  /** Takes that lost their copy and can be promoted only while their output file is unchanged. */
  unpromotable: string[];
}

const MEDIA_DIR = join(".vibeframe", "media");
/** A temp file younger than this may be a copy still in progress. */
const TEMP_GRACE_MS = 60 * 60 * 1000;

export async function executeTakePrune(options: TakePruneOptions, now: Date = new Date()): Promise<TakePruneResult | ExecutorFailure> {
  const projectDir = options.projectDir ? resolve(options.cwd, options.projectDir) : findProject(options.cwd);
  if (!projectDir || !existsSync(projectDir)) {
    return executorFailure(
      usageError("No VibeFrame project here; only project takes keep media copies.", "Run inside a project, or pass --project <dir>."),
    );
  }
  const mediaDir = join(projectDir, MEDIA_DIR);
  const base = { success: true as const, dryRun: options.dryRun === true, projectDir, mediaDir: MEDIA_DIR };
  let names: string[];
  try {
    names = (await readdir(mediaDir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return { ...base, removed: [], freedBytes: 0, kept: 0, unpromotable: [] };
  }

  // Which takes each copy belongs to, and which of those fill a slot now.
  const owners = new Map<string, string[]>();
  for (const take of await listTakes(projectTakeStore(projectDir))) {
    for (const output of take.outputs) {
      const name = basename(takeMediaPath(projectDir, output));
      owners.set(name, [...(owners.get(name) ?? []), take.id]);
    }
  }
  const inSlot = new Set(projectSlots(projectDir).keys());

  const removed: PrunedFile[] = [];
  let kept = 0;
  for (const name of names.sort()) {
    const takeIds = owners.get(name);
    const path = join(mediaDir, name);
    const info = await stat(path);
    let reason: PruneReason | undefined;
    if (name.endsWith(".tmp")) reason = now.getTime() - info.mtimeMs > TEMP_GRACE_MS ? "temp" : undefined;
    else if (!takeIds) reason = "unreferenced";
    else if (options.slotsOnly && !takeIds.some((id) => inSlot.has(id))) reason = "not-in-slot";
    if (!reason) {
      kept += 1;
      continue;
    }
    const bytes = info.size;
    if (!options.dryRun) await rm(path, { force: true });
    removed.push({ file: name, bytes, reason, ...(reason === "not-in-slot" ? { takeIds } : {}) });
  }

  return {
    ...base,
    removed,
    freedBytes: removed.reduce((sum, file) => sum + file.bytes, 0),
    kept,
    unpromotable: [...new Set(removed.flatMap((file) => file.takeIds ?? []))].sort(),
  };
}
