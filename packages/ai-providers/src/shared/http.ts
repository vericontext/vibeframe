/**
 * The one way providers talk HTTP: retries on rate limits and transient
 * server errors, honours `Retry-After`, and turns every failure into a
 * classified `ProviderError` that never carries the API key.
 */

import { ProviderError, classifyProviderError, type ProviderErrorKind } from "./errors.js";

export interface ProviderRequestOptions {
  /** Attempts for 429/502/503/504 and network errors, including the first. Default 3. */
  attempts?: number;
  /** Base backoff before the second attempt, doubled each time. Default 1000 ms. */
  backoffMs?: number;
  /** Abort the request after this long. Default 60 s. */
  timeoutMs?: number;
  /** Pull a readable message (and code) out of an error body. Default: common JSON shapes. */
  parseError?: (body: string) => { message: string; code?: string };
  /**
   * Provider-specific classification, tried before the generic one (e.g.
   * Kling sends exhausted credits as 429 with code 1102). Return undefined
   * to fall back to `classifyProviderError`.
   */
  classify?: (input: { status: number; message: string; code?: string }) => ProviderErrorKind | undefined;
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** Read `message` / `error` / `detail` from the JSON error bodies providers return. */
export function parseErrorBody(body: string): { message: string; code?: string } {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    const pick = (value: unknown): string | undefined => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(pick).filter(Boolean).join("; ") || undefined;
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        return pick(v.message) ?? pick(v.msg) ?? pick(v.detail) ?? pick(v.error);
      }
      return undefined;
    };
    const message = pick(data.error) ?? pick(data.message) ?? pick(data.detail) ?? body;
    const rawCode = data.code ?? data.failureCode ?? (data.error as Record<string, unknown> | undefined)?.code;
    return { message, code: typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined };
  } catch {
    return { message: body.trim() || "empty response" };
  }
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.min(Math.max(date - Date.now(), 0), 60_000);
}

/**
 * `fetch` for provider APIs. Resolves with an OK response; throws a
 * `ProviderError` for every other outcome once retries are spent.
 */
export async function providerRequest(
  provider: string,
  url: string,
  init: RequestInit = {},
  options: ProviderRequestOptions = {}
): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 1000;
  const parse = options.parseError ?? parseErrorBody;
  const method = (init.method ?? "GET").toUpperCase();
  const where = `${method} ${new URL(url).pathname}`;

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(options.timeoutMs ?? 60_000) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      if (attempt < attempts && !timedOut) {
        await sleep(backoffMs * 2 ** (attempt - 1));
        continue;
      }
      throw new ProviderError({
        kind: timedOut ? "timeout" : "network",
        provider,
        message: `${where} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (response.ok) return response;

    const { message, code } = parse(await response.text());
    const full = `${where} -> ${response.status}: ${message}`;
    const kind = options.classify?.({ status: response.status, message, code });
    const error = kind
      ? new ProviderError({ kind, provider, status: response.status, code, message: full })
      : classifyProviderError({ provider, status: response.status, code, message: full });
    // A 429 can mean "out of credits" (quota), which waiting never fixes.
    if (RETRY_STATUS.has(response.status) && error.retryable && attempt < attempts) {
      await sleep(retryAfterMs(response) ?? backoffMs * 2 ** (attempt - 1));
      continue;
    }
    throw error;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Older helpers, used by the Gemini providers until they move to
// `providerRequest`. Do not use in new code.

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(label: string, status: number, body: string) {
    super(`${label} (${status}): ${body}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(
  label: string,
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ProviderHttpError(label, response.status, await response.text());
  }
  return (await response.json()) as T;
}
