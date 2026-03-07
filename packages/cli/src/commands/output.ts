/**
 * @module output
 * @description Shared output helper for --json structured output support.
 */

import ora from "ora";

/** Check if --json flag is active */
export function isJsonMode(): boolean {
  return process.env.VIBE_JSON_OUTPUT === "1";
}

/** Output result - JSON mode outputs JSON, otherwise no-op (callers use chalk/ora) */
export function outputResult(result: Record<string, unknown>): void {
  if (isJsonMode()) {
    console.log(JSON.stringify(result, null, 2));
  }
}

/** Wrap console output - suppressed in JSON mode */
export function log(...args: unknown[]): void {
  if (!isJsonMode()) {
    console.log(...args);
  }
}

/** Create a spinner that is silent in JSON mode */
export function spinner(text: string): ReturnType<typeof ora> {
  if (isJsonMode()) {
    // Return a no-op spinner in JSON mode
    const s = ora({ text, isSilent: true });
    return s;
  }
  return ora(text);
}

/** Output an error - always outputs (JSON mode writes to stdout as JSON) */
export function outputError(error: string, details?: Record<string, unknown>): void {
  if (isJsonMode()) {
    console.log(JSON.stringify({ success: false, error, ...details }, null, 2));
  } else {
    console.error(error);
  }
}
