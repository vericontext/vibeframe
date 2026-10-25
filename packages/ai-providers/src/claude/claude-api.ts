/**
 * Shared Claude API request helpers and types for split helper modules.
 *
 * Every failure here is a `ProviderError`: HTTP failures are classified by
 * `providerRequest` (auth, quota, rate-limit, network, ...), and a reply
 * with no usable text or JSON is kind `provider`. Helpers never turn one
 * into a default result, so no caller can report success after a failed
 * call.
 */

import { ProviderError } from "../shared/errors.js";
import { providerRequest } from "../shared/http.js";

const PROVIDER = "claude";

/** Floor for max_tokens; see callClaude. It is a cap, so unused room costs nothing. */
export const CLAUDE_MIN_MAX_TOKENS = 16000;

/**
 * How long one Messages call may run. A reply with thinking under a 16k+
 * token cap can take minutes, well past `providerRequest`'s 60 s default.
 */
const CLAUDE_TIMEOUT_MS = 300_000;

/** Parameters needed to make a Claude Messages API call */
export interface ClaudeApiParams {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Standard Claude Messages API response shape */
export interface ClaudeApiResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
}

/**
 * Send a request to the Claude Messages API and return the reply text.
 * Throws a `ProviderError` on HTTP errors, refusals, and empty replies.
 */
export async function callClaude(
  params: ClaudeApiParams,
  opts: {
    system: string;
    messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
    maxTokens: number;
    /**
     * JSON Schema the reply must match (structured outputs). Use it whenever
     * the reply carries code or other text that is hard to escape by hand.
     */
    jsonSchema?: Record<string, unknown>;
  }
): Promise<string> {
  const response = await providerRequest(
    PROVIDER,
    `${params.baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model,
        // Claude 5.x thinks by default and thinking tokens count against
        // max_tokens, so a small cap can end before any text is written.
        max_tokens: Math.max(opts.maxTokens, CLAUDE_MIN_MAX_TOKENS),
        messages: opts.messages,
        system: opts.system,
        ...(opts.jsonSchema
          ? { output_config: { format: { type: "json_schema", schema: opts.jsonSchema } } }
          : {}),
      }),
    },
    { timeoutMs: CLAUDE_TIMEOUT_MS }
  );

  const data = (await response.json()) as ClaudeApiResponse;
  if (data.stop_reason === "refusal") {
    throw new ProviderError({ kind: "moderation", provider: PROVIDER, message: `${params.model} declined the request.` });
  }
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text?.trim()) {
    throw new ProviderError({ kind: "provider", provider: PROVIDER, message: `${params.model} returned no text.` });
  }
  return text;
}

/**
 * Parse the JSON object or array in a Claude reply, tolerating prose or a
 * code fence around it. A reply with no parseable JSON of that shape, or
 * JSON that fails `isValid`, is a `ProviderError` (kind `provider`) naming
 * the task, so a bad reply is never mistaken for a real result.
 */
export function parseClaudeJson<T>(
  text: string,
  opts: { task: string; shape: "object" | "array"; isValid?: (value: T) => boolean }
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
      provider: PROVIDER,
      message: `Claude returned a ${opts.task} reply that could not be parsed: ${excerpt}`,
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
