/**
 * Reading takes: the executors behind `vibe take list|show|log` and the
 * `take_*` MCP tools.
 *
 * Scope: by default a call reads the store it would write to (the project
 * around `cwd`, else the global store). `global: true` reads the global
 * ledger instead, which covers every take made on this machine, in any
 * project.
 */

import { resolve } from "node:path";

import { InputError } from "../commands/validate.js";
import {
  globalTakeStore,
  listTakes,
  projectTakeStore,
  readLedger,
  readTake,
  takeStoreFor,
  type LedgerEntry,
  type Take,
  type TakeCostBasis,
  type TakeKind,
  type TakeStore,
} from "./take.js";

export interface TakeScope {
  cwd: string;
  /** A project directory to read instead of the one around `cwd`. */
  projectDir?: string;
  global?: boolean;
}

function storeOf(scope: TakeScope): TakeStore {
  if (scope.projectDir) return projectTakeStore(resolve(scope.cwd, scope.projectDir));
  return takeStoreFor(scope.cwd);
}

/** A take as a list row: what an agent scans before opening one. */
export interface TakeSummary {
  id: string;
  createdAt: string;
  kind: TakeKind;
  operation: Take["operation"];
  status: Take["status"];
  provider: string;
  model?: string;
  usd: number;
  basis: TakeCostBasis;
  parent?: string;
  beatId?: string;
  prompt?: string;
  output?: string;
  projectDir?: string;
}

function summarizeTake(take: Take): TakeSummary {
  return {
    id: take.id,
    createdAt: take.createdAt,
    kind: take.kind,
    operation: take.operation,
    status: take.status,
    provider: take.provider,
    ...(take.model ? { model: take.model } : {}),
    usd: take.cost.usd,
    basis: take.cost.basis,
    ...(take.parent ? { parent: take.parent } : {}),
    ...(take.origin.beatId ? { beatId: take.origin.beatId } : {}),
    prompt: take.prompt.length > 120 ? `${take.prompt.slice(0, 117)}...` : take.prompt,
    ...(take.outputs[0] ? { output: take.outputs[0].path } : {}),
  };
}

function summarizeEntry(entry: LedgerEntry): TakeSummary {
  return {
    id: entry.takeId,
    createdAt: entry.createdAt,
    kind: entry.kind,
    operation: entry.operation,
    status: entry.status,
    provider: entry.provider,
    ...(entry.model ? { model: entry.model } : {}),
    usd: entry.usd,
    basis: entry.basis,
    ...(entry.projectDir ? { projectDir: entry.projectDir } : {}),
  };
}

export interface TakeFilter {
  kind?: TakeKind;
  beatId?: string;
  /** ISO date or timestamp; takes created before it are left out. */
  since?: string;
}

function sinceMs(since: string | undefined): number | undefined {
  if (!since) return undefined;
  const ms = Date.parse(since);
  if (Number.isNaN(ms)) throw new InputError(`Invalid --since "${since}". Use a date such as 2026-11-01.`);
  return ms;
}

function matches(row: TakeSummary, filter: TakeFilter, since: number | undefined): boolean {
  if (filter.kind && row.kind !== filter.kind) return false;
  if (filter.beatId && row.beatId !== filter.beatId) return false;
  if (since !== undefined && Date.parse(row.createdAt) < since) return false;
  return true;
}

async function rows(scope: TakeScope, filter: TakeFilter): Promise<{ rows: TakeSummary[]; store: string; mode: "project" | "global" | "ledger" }> {
  const since = sinceMs(filter.since);
  if (scope.global) {
    const entries = (await readLedger()).map(summarizeEntry).reverse();
    return { rows: entries.filter((row) => matches(row, filter, since)), store: "ledger", mode: "ledger" };
  }
  const store = storeOf(scope);
  const takes = (await listTakes(store)).map(summarizeTake);
  return { rows: takes.filter((row) => matches(row, filter, since)), store: store.dir, mode: store.mode };
}

export interface TakeListResult {
  mode: "project" | "global" | "ledger";
  store: string;
  total: number;
  takes: TakeSummary[];
}

export async function executeTakeList(scope: TakeScope, filter: TakeFilter & { limit?: number } = {}): Promise<TakeListResult> {
  const found = await rows(scope, filter);
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 50;
  return { mode: found.mode, store: found.store, total: found.rows.length, takes: found.rows.slice(0, limit) };
}

/** One take by id: the current project's store, then the global store, then wherever the ledger says it is. */
export async function executeTakeShow(id: string, scope: TakeScope): Promise<{ take: Take; store: string } | undefined> {
  const stores = [storeOf(scope), globalTakeStore()];
  const direct = await readTake(id, stores);
  if (direct) return { take: direct.take, store: direct.store.dir };
  const entry = (await readLedger()).find((e) => e.takeId === id);
  if (!entry) return undefined;
  const elsewhere = await readTake(id, [{ mode: entry.projectDir ? "project" : "global", dir: entry.store, projectDir: entry.projectDir }]);
  return elsewhere ? { take: elsewhere.take, store: elsewhere.store.dir } : undefined;
}

export interface SpendGroup {
  key: string;
  takes: number;
  usd: number;
}

export interface TakeLogResult {
  mode: "project" | "global" | "ledger";
  store: string;
  since?: string;
  takes: number;
  totalUsd: number;
  /**
   * How much of the total rests on each kind of figure. `reported` and
   * `metered` are billing; `estimate` and `upper-bound` are not.
   */
  byBasis: Record<TakeCostBasis, number>;
  byProvider: SpendGroup[];
  byModel: SpendGroup[];
  byKind: SpendGroup[];
  failed: { takes: number; usd: number };
}

function group(rowsIn: TakeSummary[], key: (row: TakeSummary) => string): SpendGroup[] {
  const groups = new Map<string, SpendGroup>();
  for (const row of rowsIn) {
    const k = key(row);
    const g = groups.get(k) ?? { key: k, takes: 0, usd: 0 };
    g.takes += 1;
    g.usd += row.usd;
    groups.set(k, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, usd: round(g.usd) }))
    .sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
}

function round(usd: number): number {
  return Number(usd.toFixed(6));
}

/** Spend over a scope: totals, and how much of it is billing rather than estimate. */
export async function executeTakeLog(scope: TakeScope, filter: TakeFilter = {}): Promise<TakeLogResult> {
  const found = await rows(scope, filter);
  const byBasis: Record<TakeCostBasis, number> = { reported: 0, metered: 0, estimate: 0, "upper-bound": 0 };
  let total = 0;
  const failed = { takes: 0, usd: 0 };
  for (const row of found.rows) {
    total += row.usd;
    byBasis[row.basis] += row.usd;
    if (row.status === "failed") {
      failed.takes += 1;
      failed.usd += row.usd;
    }
  }
  for (const basis of Object.keys(byBasis) as TakeCostBasis[]) byBasis[basis] = round(byBasis[basis]);
  return {
    mode: found.mode,
    store: found.store,
    ...(filter.since ? { since: filter.since } : {}),
    takes: found.rows.length,
    totalUsd: round(total),
    byBasis,
    byProvider: group(found.rows, (row) => row.provider),
    byModel: group(found.rows, (row) => `${row.provider}/${row.model ?? "default"}`),
    byKind: group(found.rows, (row) => row.kind),
    failed: { takes: failed.takes, usd: round(failed.usd) },
  };
}
