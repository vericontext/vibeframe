/**
 * Recording takes from the generation executors.
 *
 * `withTake` runs one generation inside a usage meter, then writes the take
 * from what the call returned and what it billed. The executors call it, so
 * the CLI, MCP tools, YAML pipeline, and project builds all leave the same
 * record. A take is written only when the provider was reached: a refused
 * input or a missing key leaves nothing, a provider failure that billed or
 * a submitted job does.
 */

import { randomBytes } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { meterUsage, priceUsage, type UsageRecord, type VideoJob } from "@vibeframe/ai-providers";
import {
  TAKE_SCHEMA_VERSION,
  hashFile,
  newTakeId,
  takeMediaPath,
  takeStoreFor,
  writeTake,
  type Take,
  type TakeCost,
  type TakeFile,
  type TakeInput,
  type TakeKind,
  type TakeOperation,
  type TakeOrigin,
  type TakeSlot,
  type TakeStatus,
  type TakeVia,
} from "./take.js";

/** Who is asking; executors fill in the rest. */
export interface TakeContext {
  via: TakeVia;
  command: string;
  cwd?: string;
  beatId?: string;
  /** The beat slot a build is filling. */
  asset?: TakeSlot;
  parent?: string;
}

/** Turn recording off (tests of unrelated behaviour, a host that keeps its own record). */
export function takesDisabled(): boolean {
  return process.env.VIBE_TAKES === "off";
}

/** What an executor knows once its call returned. */
export interface TakeOutcome {
  /** False when the provider was never reached; nothing is recorded. */
  reached: boolean;
  status: TakeStatus;
  provider: string;
  model?: string;
  session?: VideoJob;
  outputs: string[];
  error?: { message: string; kind?: string };
  /** The cost when nothing was metered: an estimate or the tier upper bound. */
  fallbackCost: () => Pick<TakeCost, "usd" | "basis">;
}

export interface TakeRequest {
  kind: TakeKind;
  operation: TakeOperation;
  prompt: string;
  params: Record<string, unknown>;
  inputs: Array<{ role: TakeInput["role"]; path: string }>;
}

/** A project take stores paths relative to its project, so the record moves with it. */
function storedPath(path: string, projectDir: string | undefined): string {
  const absolute = resolve(path);
  if (!projectDir) return absolute;
  const rel = relative(projectDir, absolute);
  return rel.startsWith("..") || isAbsolute(rel) ? absolute : rel;
}

export function costOf(usage: UsageRecord[], fallback: () => Pick<TakeCost, "usd" | "basis">): TakeCost {
  if (usage.length === 0) return fallback();
  const priced = priceUsage(usage);
  if (priced.unpriced.length === usage.length) return { ...fallback(), usage };
  const reported = usage.every((record) => record.amount.unit === "usd");
  return {
    usd: priced.costUsd,
    basis: reported ? "reported" : priced.estimated ? "estimate" : "metered",
    usage,
  };
}

/**
 * Keep a project take's output bytes under its content hash, so the take can
 * be promoted after its slot file was regenerated. A copy-on-write clone
 * where the filesystem supports it (APFS, Btrfs), a plain copy otherwise.
 */
async function preserveOutput(projectDir: string, source: string, file: TakeFile): Promise<void> {
  const target = takeMediaPath(projectDir, file);
  if (existsSync(target)) return;
  await mkdir(dirname(target), { recursive: true });
  // Two takes with the same bytes (a build's narration and music can be) may
  // land here at once: each copies to its own temp file, and either rename
  // leaves the same content.
  const temp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await copyFile(source, temp, constants.COPYFILE_FICLONE);
  await rename(temp, target);
}

function dropUndefined(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));
}

/**
 * Run `fn` (one generation), record its take, and return its result with
 * the take id. Recording never fails the generation: a write error is
 * reported on the result as `takeError` instead.
 */
export async function withTake<T extends object>(
  context: TakeContext | undefined,
  request: TakeRequest,
  fn: () => Promise<T>,
  outcome: (result: T) => TakeOutcome,
): Promise<T & { takeId?: string; takeError?: string }> {
  if (takesDisabled()) return fn();
  const createdAt = new Date();
  const { result, usage } = await meterUsage(fn);
  const done = outcome(result);
  if (!done.reached && usage.length === 0) return result;

  const ctx: TakeContext = context ?? { via: "cli", command: "" };
  const cwd = resolve(ctx.cwd ?? process.cwd());
  const store = takeStoreFor(cwd);
  try {
    const inputs: TakeInput[] = [];
    for (const input of request.inputs) {
      if (/^https?:\/\//.test(input.path)) {
        inputs.push({ role: input.role, path: input.path });
        continue;
      }
      const file = await hashFile(input.path);
      inputs.push({ role: input.role, ...file, path: storedPath(input.path, store.projectDir) });
    }
    const outputs: TakeFile[] = [];
    for (const path of done.outputs) {
      const file = await hashFile(path);
      outputs.push({ ...file, path: storedPath(path, store.projectDir) });
      if (store.projectDir) await preserveOutput(store.projectDir, path, file);
    }
    // A project take may be committed, so it names no absolute path: the project is where it lives.
    const origin: TakeOrigin = {
      via: ctx.via,
      command: ctx.command,
      cwd: store.projectDir ? storedPath(cwd, store.projectDir) || "." : cwd,
      ...(ctx.beatId ? { beatId: ctx.beatId } : {}),
      ...(ctx.asset ? { asset: ctx.asset } : {}),
    };
    const take: Take = {
      schemaVersion: TAKE_SCHEMA_VERSION,
      id: newTakeId(createdAt),
      createdAt: createdAt.toISOString(),
      kind: request.kind,
      operation: request.operation,
      ...(ctx.parent ? { parent: ctx.parent } : {}),
      status: done.status,
      provider: done.provider,
      ...(done.model ? { model: done.model } : {}),
      prompt: request.prompt,
      params: dropUndefined(request.params),
      inputs,
      outputs,
      ...(done.session ? { session: done.session } : {}),
      cost: costOf(usage, done.fallbackCost),
      origin,
      ...(done.error ? { error: done.error } : {}),
    };
    await writeTake(take, store);
    return { ...result, takeId: take.id };
  } catch (error) {
    return { ...result, takeError: `Take not recorded: ${error instanceof Error ? error.message : String(error)}` };
  }
}
