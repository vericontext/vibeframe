/**
 * @module output
 * @description Shared output helper for --json structured output support.
 */

import chalk from "chalk";
import ora from "ora";

// ── Exit Codes ───────────────────────────────────────────────────────────

export enum ExitCode {
  SUCCESS = 0,
  GENERAL = 1,
  USAGE = 2,
  NOT_FOUND = 3,
  AUTH = 4,
  API_ERROR = 5,
  NETWORK = 6,
}

// ── Structured Errors ────────────────────────────────────────────────────

export interface StructuredError {
  success: false;
  error: string;
  code: string;
  exitCode: ExitCode;
  suggestion?: string;
  retryable: boolean;
}

export function usageError(msg: string, suggestion?: string): StructuredError {
  return { success: false, error: msg, code: "USAGE_ERROR", exitCode: ExitCode.USAGE, suggestion, retryable: false };
}

export function authError(envVar: string, provider: string): StructuredError {
  return {
    success: false,
    error: `${provider} API key required.`,
    code: "API_KEY_MISSING",
    exitCode: ExitCode.AUTH,
    suggestion: `Set ${envVar} in .env, or run: vibe setup`,
    retryable: false,
  };
}

/** Provider-specific error hints based on error message patterns.
 *
 * Ordering matters — the first match wins. Billing checks precede rate-limit
 * checks because providers (notably Kling) return HTTP 429 for "Account
 * balance not enough" — a non-retryable billing issue that would otherwise
 * be misclassified as a transient rate limit and mislead the user.
 */
const PROVIDER_ERROR_HINTS: Array<{ pattern: RegExp; suggestion: string; retryable: boolean }> = [
  // Billing (must precede the 429 rate-limit pattern)
  { pattern: /402|payment.*required|billing|INSUFFICIENT_BALANCE|insufficient.*(credit|funds|balance)|balance.*(not.*enough|insufficient)|credits?.*exhausted|account.*balance/i, suggestion: "Account balance or credits exhausted. Top up at the provider dashboard, or try -p <other-provider>.", retryable: false },
  // Rate limits / quota
  { pattern: /429|rate.?limit|too many requests/i, suggestion: "Rate limited. Wait 30-60 seconds and retry, or check your plan's rate limits.", retryable: true },
  { pattern: /RESOURCE_EXHAUSTED|quota.*exceeded|requests.*per.*(minute|day)/i, suggestion: "Quota exceeded. Wait for the quota window to reset, or upgrade your plan. Consider -p <other-provider> to use a different provider.", retryable: true },
  // Auth
  { pattern: /401|unauthorized|(invalid|incorrect).*api.?key|invalid_api_key|authentication.*(failed|error)|missing.*api.?key|did not start with 'key_'/i, suggestion: "API key is invalid or expired. Run 'vibe setup' to update, or check the key at the provider's dashboard.", retryable: false },
  { pattern: /403|forbidden|permission.*denied/i, suggestion: "Access denied. Your API key may lack required permissions, or the feature requires a paid plan.", retryable: false },
  // Server
  { pattern: /500|internal.*error|server.*error/i, suggestion: "Provider server error. Retry in a few minutes.", retryable: true },
  { pattern: /503|service.*unavailable|overloaded|overloaded_error/i, suggestion: "Provider is temporarily overloaded. Retry in 1-2 minutes, or switch provider with -p.", retryable: true },
  { pattern: /timeout|timed?\s*out|ETIMEDOUT|ECONNRESET|socket.*hang.?up/i, suggestion: "Request timed out. The provider may be slow. Retry, or try a different provider with -p flag.", retryable: true },
  // Content policy
  { pattern: /content.*(policy|filter)|safety|moderation|blocked.*(by|due)|content_policy_violation|restricted.*content/i, suggestion: "Content was blocked by the provider's safety filter. Rephrase your prompt to avoid sensitive terms.", retryable: false },
  // Model / context
  { pattern: /context_length_exceeded|maximum.*context.*length|token.*limit.*exceeded|prompt.*too.*long/i, suggestion: "Input exceeds the model's context window. Shorten the prompt, or use a model with larger context (run 'vibe schema <command>' for options).", retryable: false },
  { pattern: /model.*not.*found|invalid.*model|unknown.*model|model_not_found/i, suggestion: "The specified model is unavailable. Check 'vibe schema <command>' for valid model options.", retryable: false },
  // Provider-specific
  { pattern: /voice.*not.*found|voice_not_found|invalid.*voice.?id/i, suggestion: "Voice ID not found. Run 'vibe audio voices' to list available voices, then pass --voice <id>.", retryable: false },
  { pattern: /character.*(count|limit).*exceeded|invalid_character_count/i, suggestion: "Text exceeds the TTS provider's character limit. Shorten the text or split into chunks.", retryable: false },
  { pattern: /invalid.*aspect.*ratio|unsupported.*aspect.*ratio|unsupported.*resolution/i, suggestion: "This aspect ratio or resolution isn't supported by the chosen model. Check 'vibe schema <command>' for supported values.", retryable: false },
  { pattern: /invalid.*file.*format|unsupported.*(format|codec)|unsupported.*media.?type/i, suggestion: "Input file format not supported. Convert to MP4/MP3/PNG first with 'vibe export' or 'ffmpeg'.", retryable: false },
  { pattern: /region.*(restriction|not.*supported|unavailable)|geo.?blocked/i, suggestion: "Provider unavailable in your region. Try -p <other-provider>, or use a supported region.", retryable: false },
  { pattern: /task.*(not.*found|expired)|job.*(not.*found|expired)/i, suggestion: "The async task expired or was never created. Re-run the command to start a new task.", retryable: true },
];

export function apiError(msg: string, retryable = false): StructuredError {
  // Check for provider-specific hints
  for (const hint of PROVIDER_ERROR_HINTS) {
    if (hint.pattern.test(msg)) {
      return { success: false, error: msg, code: "API_ERROR", exitCode: ExitCode.API_ERROR, suggestion: hint.suggestion, retryable: hint.retryable };
    }
  }
  return { success: false, error: msg, code: "API_ERROR", exitCode: ExitCode.API_ERROR, suggestion: retryable ? "Retry the command." : undefined, retryable };
}

export function notFoundError(path: string): StructuredError {
  return { success: false, error: `File not found: ${path}`, code: "NOT_FOUND", exitCode: ExitCode.NOT_FOUND, retryable: false };
}

export function networkError(msg: string): StructuredError {
  return { success: false, error: msg, code: "NETWORK_ERROR", exitCode: ExitCode.NETWORK, suggestion: "Check your internet connection and retry.", retryable: true };
}

export function generalError(msg: string, suggestion?: string): StructuredError {
  return { success: false, error: msg, code: "ERROR", exitCode: ExitCode.GENERAL, suggestion, retryable: false };
}

/** Output structured error then exit */
export function exitWithError(err: StructuredError): never {
  if (isJsonMode()) {
    console.error(JSON.stringify(err, null, 2));
  } else {
    console.error(chalk.red(`\n  ${err.error}`));
    if (err.suggestion) {
      console.error(chalk.dim(`  ${err.suggestion}`));
    }
    console.error();
  }
  process.exit(err.exitCode);
}

// ── Output Modes ─────────────────────────────────────────────────────────

/** Check if --json flag is active */
export function isJsonMode(): boolean {
  return process.env.VIBE_JSON_OUTPUT === "1";
}

/** Check if --quiet flag is active */
export function isQuietMode(): boolean {
  return process.env.VIBE_QUIET_OUTPUT === "1";
}

// ── Cost Estimation ──────────────────────────────────────────────────────

/** Estimated cost ranges by command */
export const COST_ESTIMATES: Record<string, { min: number; max: number; unit: string }> = {
  // Free
  "detect scenes": { min: 0, max: 0, unit: "free" },
  "detect silence": { min: 0, max: 0, unit: "free" },
  "detect beats": { min: 0, max: 0, unit: "free" },
  "edit silence-cut": { min: 0, max: 0, unit: "free" },
  "edit fade": { min: 0, max: 0, unit: "free" },
  "edit noise-reduce": { min: 0, max: 0, unit: "free" },
  "edit reframe": { min: 0, max: 0, unit: "free" },
  "edit interpolate": { min: 0, max: 0, unit: "free" },
  "edit upscale-video": { min: 0, max: 0, unit: "free" },
  // Low
  "analyze media": { min: 0.01, max: 0.05, unit: "per call" },
  "analyze video": { min: 0.01, max: 0.10, unit: "per video" },
  "analyze review": { min: 0.01, max: 0.10, unit: "per video" },
  "generate image": { min: 0.01, max: 0.07, unit: "per image" },
  "generate thumbnail": { min: 0.01, max: 0.05, unit: "per image" },
  "generate storyboard": { min: 0.01, max: 0.05, unit: "per call" },
  "ai transcribe": { min: 0.01, max: 0.10, unit: "per minute" },
  "audio transcribe": { min: 0.01, max: 0.10, unit: "per minute" },
  "edit caption": { min: 0.01, max: 0.10, unit: "per video" },
  "edit jump-cut": { min: 0.01, max: 0.10, unit: "per video" },
  "edit translate-srt": { min: 0.01, max: 0.05, unit: "per file" },
  "edit animated-caption": { min: 0.01, max: 0.10, unit: "per video" },
  // Medium
  "generate speech": { min: 0.05, max: 0.30, unit: "per request" },
  "generate sound-effect": { min: 0.05, max: 0.20, unit: "per request" },
  "generate music": { min: 0.05, max: 0.50, unit: "per request" },
  "generate motion": { min: 0.01, max: 0.10, unit: "per generation" },
  "edit grade": { min: 0.01, max: 0.05, unit: "per video" },
  "edit speed-ramp": { min: 0.05, max: 0.15, unit: "per video" },
  "edit text-overlay": { min: 0, max: 0.05, unit: "per video" },
  // High
  "generate video": { min: 0.50, max: 5.00, unit: "per video" },
  "edit image": { min: 0.05, max: 0.50, unit: "per edit" },
  // Very High
  "pipeline script-to-video": { min: 5, max: 50, unit: "per project" },
  "pipeline highlights": { min: 0.05, max: 1.00, unit: "per analysis" },
  "pipeline auto-shorts": { min: 0.10, max: 2.00, unit: "per batch" },
  "pipeline animated-caption": { min: 0.01, max: 0.10, unit: "per video" },
  "pipeline regenerate-scene": { min: 0.50, max: 5.00, unit: "per scene" },
};

function formatCost(min: number, max: number, unit: string): string {
  if (min === 0 && max === 0) return "Free";
  if (min === max) return `~$${min.toFixed(2)} ${unit}`;
  return `~$${min.toFixed(2)}-$${max.toFixed(2)} ${unit}`;
}

/** Output result - JSON mode outputs JSON, quiet mode outputs primary value only */
export function outputResult(result: Record<string, unknown>): void {
  // Inject cost estimate for dry-run results
  if (result.dryRun && result.command && typeof result.command === "string") {
    const cost = COST_ESTIMATES[result.command as string];
    if (cost) {
      result.estimatedCost = formatCost(cost.min, cost.max, cost.unit);
    }
  }
  if (isJsonMode()) {
    // Apply --fields filtering if specified
    const fields = process.env.VIBE_OUTPUT_FIELDS;
    if (fields) {
      const keys = fields.split(",").map((k) => k.trim());
      const filtered: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in result) filtered[key] = result[key];
      }
      // Always include success
      if ("success" in result) filtered.success = result.success;
      console.log(JSON.stringify(filtered, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else if (isQuietMode()) {
    // In quiet mode, output the primary value only (path, url, or id)
    const primary = result.output ?? result.path ?? result.url ?? result.id ?? result.result;
    if (primary !== undefined) console.log(String(primary));
  }
}

/** Wrap console output - suppressed in JSON/quiet mode */
export function log(...args: unknown[]): void {
  if (!isJsonMode() && !isQuietMode()) {
    console.log(...args);
  }
}

/** Create a spinner that is silent in JSON/quiet mode */
export function spinner(text: string): ReturnType<typeof ora> {
  if (isJsonMode() || isQuietMode()) {
    return ora({ text, isSilent: true });
  }
  return ora(text);
}

/** Suggest next steps - only in human interactive mode */
export function suggestNext(tip: string): void {
  if (!isJsonMode() && !isQuietMode() && process.stdout.isTTY) {
    console.log(chalk.dim(`\n  Tip: ${tip}`));
  }
}

/** Output an error - always outputs (JSON mode writes to stdout as JSON) */
export function outputError(error: string, details?: Record<string, unknown>): void {
  if (isJsonMode()) {
    console.error(JSON.stringify({ success: false, error, ...details }, null, 2));
  } else {
    console.error(error);
  }
}
