/**
 * Soft-validation for API keys pasted into the setup wizard or imported from
 * .env. Returns whether the value matches the registered prefix and, if not,
 * the human-readable example so the wizard can show one ⚠ line and continue.
 *
 * "Soft" by design: providers occasionally rotate key formats, and a wrong
 * pattern in our registry should never block a working key. Callers always
 * persist the value regardless of `ok`.
 */

import { getKeyFormat } from "@vibeframe/ai-providers";

export interface KeyFormatResult {
  ok: boolean;
  /** Example string (e.g. "sk-ant-...") — present when `ok === false`. */
  expected?: string;
}

export function validateKeyFormat(
  configKey: string,
  value: string,
): KeyFormatResult {
  const fmt = getKeyFormat(configKey);
  if (!fmt) return { ok: true };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true };
  if (fmt.prefix.test(trimmed)) return { ok: true };
  return { ok: false, expected: fmt.example };
}
