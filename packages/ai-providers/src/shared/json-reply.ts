/**
 * Parse the JSON object or array in a model reply, tolerating prose or a code
 * fence around it. A reply with no parseable JSON of that shape, or JSON that
 * fails `isValid`, is a `ProviderError` (kind `provider`) naming the task, so a
 * bad reply is never mistaken for a real result.
 */

import { ProviderError } from "./errors.js";

export function parseJsonReply<T>(
  text: string,
  opts: { provider: string; label: string; task: string; shape: "object" | "array"; isValid?: (value: T) => boolean }
): T {
  const match = opts.shape === "object" ? text.match(/\{[\s\S]*\}/) : text.match(/\[[\s\S]*\]/);
  let value: unknown;
  try {
    value = match ? JSON.parse(match[0]) : undefined;
  } catch {
    value = undefined;
  }
  const shapeOk =
    opts.shape === "array"
      ? Array.isArray(value)
      : typeof value === "object" && value !== null && !Array.isArray(value);
  if (!shapeOk || (opts.isValid && !opts.isValid(value as T))) {
    const excerpt = text.trim().replace(/\s+/g, " ").slice(0, 200);
    throw new ProviderError({
      kind: "provider",
      provider: opts.provider,
      message: `${opts.label} returned a ${opts.task} reply that could not be parsed: ${excerpt}`,
    });
  }
  return value as T;
}

/** True when `value` is a non-empty string. */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** True when `value` is a finite number. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
