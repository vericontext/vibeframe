/**
 * The usage meter: what each paid provider call actually consumed.
 *
 * Providers record one `UsageRecord` per billed call, in the unit the
 * provider bills (tokens, characters, seconds of audio, requests), as soon
 * as the response arrives - before any refusal or empty-reply error is
 * thrown, since those calls are billed too. Callers read the records back
 * and price them with `priceUsage()` against the model catalog, so cost is
 * computed in one place instead of per command.
 *
 * Records go to every meter opened with `meterUsage()` around the call (an
 * MCP tool call, a pipeline step) and to a process-wide ledger that a
 * one-shot CLI command reads with `usageSince()`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelKind } from "../catalog/catalog.js";

export type UsageAmount =
  /** LLM tokens as the provider reported them; thinking counts as output. */
  | { unit: "tokens"; input: number; output: number }
  /** Characters of text sent to a per-character TTS model. */
  | { unit: "characters"; count: number }
  /** Seconds of audio produced (TTS, music, sound effects) or transcribed. */
  | { unit: "seconds"; count: number }
  /** Billed requests, for services priced per call or not priced at all. */
  | { unit: "requests"; count: number };

export interface UsageRecord {
  /** Catalog provider id ("claude", "gemini", "elevenlabs", ...). */
  provider: string;
  kind: ModelKind | "audio-isolation";
  /** The model ID the provider served. */
  model: string;
  amount: UsageAmount;
  /**
   * True when the amount was inferred rather than reported or measured, e.g.
   * a transcription length taken from the last word because the provider
   * sent no duration.
   */
  estimated?: boolean;
  /** Epoch ms when it was recorded. */
  at: number;
}

interface Meter {
  records: UsageRecord[];
  parent?: Meter;
}

interface MeterState {
  storage: AsyncLocalStorage<Meter>;
  ledger: UsageRecord[];
}

/** Process-wide, so a second copy of this module (a bundle) shares the same meters. */
const STATE_KEY = Symbol.for("@vibeframe/ai-providers.usage-meter");
const LEDGER_LIMIT = 10_000;

function state(): MeterState {
  const holder = globalThis as unknown as Record<symbol, MeterState | undefined>;
  return (holder[STATE_KEY] ??= { storage: new AsyncLocalStorage<Meter>(), ledger: [] });
}

/** Record what one billed provider call consumed. */
export function recordUsage(record: Omit<UsageRecord, "at">): void {
  const entry: UsageRecord = { ...record, at: Date.now() };
  const { storage, ledger } = state();
  for (let meter = storage.getStore(); meter; meter = meter.parent) meter.records.push(entry);
  ledger.push(entry);
  if (ledger.length > LEDGER_LIMIT) ledger.splice(0, ledger.length - LEDGER_LIMIT);
}

/** `recordUsage` for an LLM reply's token counts; skipped when the provider sent none. */
export function recordTokenUsage(
  provider: string,
  model: string,
  input: number | undefined,
  output: number | undefined,
): void {
  if (input === undefined && output === undefined) return;
  recordUsage({ provider, kind: "llm", model, amount: { unit: "tokens", input: input ?? 0, output: output ?? 0 } });
}

/**
 * Run `fn` and collect the usage recorded inside it, including calls that
 * failed after the provider billed them. Meters nest: an inner meter's
 * records also reach the outer one.
 */
export async function meterUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: UsageRecord[] }> {
  const { storage } = state();
  const meter: Meter = { records: [], parent: storage.getStore() };
  const result = await storage.run(meter, fn);
  return { result, usage: meter.records };
}

/** Like `meterUsage`, but hands back the usage even when `fn` throws. */
export async function meterUsageSettled<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; usage: UsageRecord[] } | { error: unknown; usage: UsageRecord[] }> {
  const { storage } = state();
  const meter: Meter = { records: [], parent: storage.getStore() };
  try {
    const result = await storage.run(meter, fn);
    return { result, usage: meter.records };
  } catch (error) {
    return { error, usage: meter.records };
  }
}

/**
 * Take the usage recorded since `startedAt` (epoch ms): from the current
 * meter when one is open, otherwise from the process-wide ledger. A CLI
 * command passes the time its action started. Ledger records are removed,
 * so a second command in the same process (tests, an in-process host) never
 * counts them again, even when it starts in the same millisecond. An open
 * meter is only read: its owner reports from it afterwards.
 */
export function takeUsageSince(startedAt: number): UsageRecord[] {
  const { storage, ledger } = state();
  const meter = storage.getStore();
  if (meter) return meter.records.filter((record) => record.at >= startedAt);
  const taken = ledger.filter((record) => record.at >= startedAt);
  const kept = ledger.filter((record) => record.at < startedAt);
  ledger.splice(0, ledger.length, ...kept);
  return taken;
}
