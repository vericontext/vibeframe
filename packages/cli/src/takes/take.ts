/**
 * Takes: the durable record of every paid generation.
 *
 * A take is one provider generation (or edit, or extension) as it happened:
 * who asked for it, the prompt and parameters, the inputs and outputs by
 * content hash, the provider's session handle for continuing it, its parent
 * take, and what it cost with the basis of that figure. A take is written
 * once and never rewritten; branching is a new take that names its parent.
 * The format is specified in docs/take-graph.md.
 *
 * Where takes live:
 * - project mode: inside a VibeFrame project (a directory with
 *   `vibe.config.json` or `STORYBOARD.md`), `<project>/.vibeframe/takes/`;
 * - global mode: anywhere else, `<user config dir>/takes/` (`~/.vibeframe`).
 *
 * Every take, in either mode, also appends one line to the global ledger
 * (`<user config dir>/ledger.jsonl`), so spend can be audited across every
 * project on the machine without walking the disk.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { UsageRecord, VideoJob } from "@vibeframe/ai-providers";
import { USER_CONFIG_DIR } from "../config/index.js";

export const TAKE_SCHEMA_VERSION = "1";

export type TakeKind = "video" | "image";
export type TakeOperation = "generate" | "edit" | "extend";
export type TakeStatus = "completed" | "failed" | "submitted";
export type TakeVia = "cli" | "mcp" | "pipeline" | "build";

/**
 * Where a cost figure comes from, most to least trustworthy:
 * - `reported`: the provider said what it charged;
 * - `metered`: billed units we measured, times the catalog price;
 * - `estimate`: a formula over the request (Seedance tokens, image list price);
 * - `upper-bound`: the command's cost tier ceiling, when nothing better exists.
 */
export type TakeCostBasis = "reported" | "metered" | "estimate" | "upper-bound";

export interface TakeCost {
  usd: number;
  basis: TakeCostBasis;
  /** The usage records behind a `reported` or `metered` figure. */
  usage?: UsageRecord[];
}

export interface TakeFile {
  /** Relative to the project for a project take, absolute otherwise. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface TakeInput {
  role: "image" | "end-image" | "reference-image" | "reference-video" | "reference-audio" | "source";
  /** A file path (as in `TakeFile`) or the URL the input was given as. */
  path: string;
  /** Absent for a URL input, which was not downloaded. */
  sha256?: string;
  bytes?: number;
}

export interface TakeOrigin {
  via: TakeVia;
  /** The command or tool that made it, e.g. `generate video` or `generate_video`. */
  command: string;
  /** The working directory of the call: relative to the project for a project take, absolute otherwise. */
  cwd: string;
  /** The storyboard beat, for takes a build made. */
  beatId?: string;
}

export interface Take {
  schemaVersion: typeof TAKE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  kind: TakeKind;
  operation: TakeOperation;
  /** The take this one continues or branches from. */
  parent?: string;
  status: TakeStatus;
  provider: string;
  model?: string;
  prompt: string;
  /** The request as asked: duration, ratio, resolution, seed, quality, ... (no file bytes). */
  params: Record<string, unknown>;
  inputs: TakeInput[];
  outputs: TakeFile[];
  /** The provider's handle for polling or continuing the job (an Omni job is also its session). */
  session?: VideoJob;
  cost: TakeCost;
  origin: TakeOrigin;
  error?: { message: string; kind?: string };
}

/** One line of the global ledger: enough to total spend without opening takes. */
export interface LedgerEntry {
  takeId: string;
  createdAt: string;
  /** The takes directory holding the full record. */
  store: string;
  projectDir?: string;
  kind: TakeKind;
  operation: TakeOperation;
  status: TakeStatus;
  provider: string;
  model?: string;
  usd: number;
  basis: TakeCostBasis;
}

export interface TakeStore {
  mode: "project" | "global";
  /** The directory holding `<takeId>.json` files. */
  dir: string;
  projectDir?: string;
}

/** The VibeFrame project containing `start`, or undefined outside one. */
export function findProject(start: string): string | undefined {
  let dir = resolve(start);
  try {
    if (existsSync(dir) && statSync(dir).isFile()) dir = dirname(dir);
  } catch {
    // Keep the resolved path and walk upward.
  }
  for (;;) {
    if (existsSync(join(dir, "vibe.config.json")) || existsSync(join(dir, "STORYBOARD.md"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function globalTakeStore(): TakeStore {
  return { mode: "global", dir: join(USER_CONFIG_DIR, "takes") };
}

export function projectTakeStore(projectDir: string): TakeStore {
  const root = resolve(projectDir);
  return { mode: "project", dir: join(root, ".vibeframe", "takes"), projectDir: root };
}

/** The store a take made from `cwd` goes to: its project's, else the global one. */
export function takeStoreFor(cwd: string): TakeStore {
  const projectDir = findProject(cwd);
  return projectDir ? projectTakeStore(projectDir) : globalTakeStore();
}

export function ledgerPath(): string {
  return join(USER_CONFIG_DIR, "ledger.jsonl");
}

/** `take_<base36 ms>_<8 hex>`: sortable by time, unique without coordination. */
export function newTakeId(now: Date = new Date()): string {
  return `take_${now.getTime().toString(36)}_${randomBytes(4).toString("hex")}`;
}

const TAKE_ID = /^take_[0-9a-z]+_[0-9a-f]{8}$/;

export function isTakeId(value: string): boolean {
  return TAKE_ID.test(value);
}

export async function hashFile(path: string): Promise<TakeFile> {
  const bytes = await readFile(path);
  return {
    path: resolve(path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}

/** Write a take to its store and append its ledger line. A take is written once. */
export async function writeTake(take: Take, store: TakeStore): Promise<string> {
  await mkdir(store.dir, { recursive: true });
  const path = join(store.dir, `${take.id}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(take, null, 2)}\n`, { flag: "wx" });
  await rename(temp, path);
  const entry: LedgerEntry = {
    takeId: take.id,
    createdAt: take.createdAt,
    store: store.dir,
    ...(store.projectDir ? { projectDir: store.projectDir } : {}),
    kind: take.kind,
    operation: take.operation,
    status: take.status,
    provider: take.provider,
    ...(take.model ? { model: take.model } : {}),
    usd: take.cost.usd,
    basis: take.cost.basis,
  };
  await mkdir(dirname(ledgerPath()), { recursive: true });
  await appendFile(ledgerPath(), `${JSON.stringify(entry)}\n`);
  return path;
}

function isTake(value: unknown): value is Take {
  const take = value as Partial<Take> | null;
  return Boolean(take && take.schemaVersion === TAKE_SCHEMA_VERSION && typeof take.id === "string" && take.cost);
}

/** Every take in a store, newest first. Unreadable files are skipped. */
export async function listTakes(store: TakeStore): Promise<Take[]> {
  let names: string[];
  try {
    names = await readdir(store.dir);
  } catch {
    return [];
  }
  const takes: Take[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(store.dir, name), "utf-8"));
      if (isTake(parsed)) takes.push(parsed);
    } catch {
      // A partial or foreign file is not a take.
    }
  }
  return takes.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** One take by id from the given stores, first match wins. */
export async function readTake(id: string, stores: TakeStore[]): Promise<{ take: Take; store: TakeStore } | undefined> {
  if (!isTakeId(id)) return undefined;
  for (const store of stores) {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(store.dir, `${id}.json`), "utf-8"));
      if (isTake(parsed)) return { take: parsed, store };
    } catch {
      // Not in this store.
    }
  }
  return undefined;
}

/** Every ledger line, oldest first. Malformed lines are skipped. */
export async function readLedger(): Promise<LedgerEntry[]> {
  let text: string;
  try {
    text = await readFile(ledgerPath(), "utf-8");
  } catch {
    return [];
  }
  const entries: LedgerEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      if (typeof entry.takeId === "string" && typeof entry.usd === "number") entries.push(entry);
    } catch {
      // A torn line from a crash mid-append.
    }
  }
  return entries;
}
