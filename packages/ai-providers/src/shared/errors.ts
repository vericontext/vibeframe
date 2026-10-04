/**
 * Provider error taxonomy.
 *
 * Callers used to tell a likeness rejection from a quota error by matching
 * provider wording, which breaks silently when a provider rewords a message.
 * Every provider failure is now a `ProviderError` with a `kind` that decides
 * what to do next: fall back to another provider, ask for a key, wait, or
 * change the request.
 */

export type ProviderErrorKind =
  /** Missing, invalid, or unauthorized API key. */
  | "auth"
  /** Out of credits or billing quota; waiting does not help. */
  | "quota"
  /** Too many requests; retry after a pause. */
  | "rate-limit"
  /** Input shows a real person's likeness (ByteDance i2v filter). Another provider may accept it. */
  | "likeness"
  /** Prompt or input blocked by the provider's content policy. */
  | "moderation"
  /** The request itself is wrong (bad parameter, unsupported ratio). */
  | "invalid-request"
  /** The provider or model cannot do this (e.g. extend on a provider without it). */
  | "unsupported"
  /** The model is past its shutdown date. */
  | "model-retired"
  /** The job or resource does not exist. */
  | "not-found"
  /** The job did not finish in time. */
  | "timeout"
  /** The provider failed on its side (5xx, internal task failure). */
  | "provider"
  /** The request never got a response (DNS, reset, offline). */
  | "network";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["rate-limit", "provider", "network", "timeout"]);

/** Plain-data form of a `ProviderError`, safe to put in JSON reports and job records. */
export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  provider: string;
  message: string;
  retryable: boolean;
  /** HTTP status, when the error came from a response. */
  status?: number;
  /** Provider error code (Runway `failureCode`, fal error `type`). */
  code?: string;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly code?: string;

  constructor(info: Omit<ProviderErrorInfo, "retryable"> & { retryable?: boolean }) {
    super(info.message);
    this.name = "ProviderError";
    this.kind = info.kind;
    this.provider = info.provider;
    this.retryable = info.retryable ?? RETRYABLE.has(info.kind);
    this.status = info.status;
    this.code = info.code;
  }

  toJSON(): ProviderErrorInfo {
    return {
      kind: this.kind,
      provider: this.provider,
      message: this.message,
      retryable: this.retryable,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.code !== undefined ? { code: this.code } : {}),
    };
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

const LIKENESS = /likeness(es)? of real (people|persons?)/i;
const MODERATION =
  /content[ _-]?(policy|filter|moderation|security)|safety|moderat|risk control|blocked (by|due)|restricted content|nsfw|^SAFETY\./i;
const QUOTA = /quota|insufficient (credit|balance|fund)|out of credits|credits? (exhausted|remaining)|billing|payment required|RESOURCE_EXHAUSTED/i;
const RATE_LIMIT = /rate.?limit|too many requests|concurrency limit/i;
const AUTH = /api.?key|unauthori[sz]ed|forbidden|authenticat|invalid token|permission denied/i;
const RETIRED = /no longer (available|supported)|has been (shut ?down|deprecated|retired)/i;

/**
 * Classify a provider failure from its HTTP status, message, and error code.
 * Content checks run before status checks: a 422 or 403 can carry a
 * likeness or moderation rejection, and a 429 can mean exhausted credits.
 */
export function classifyProviderError(input: {
  provider: string;
  message: string;
  status?: number;
  code?: string;
}): ProviderError {
  const { provider, message, status, code } = input;
  const text = `${code ?? ""} ${message}`;
  const kind: ProviderErrorKind = LIKENESS.test(text)
    ? "likeness"
    : MODERATION.test(text)
      ? "moderation"
      : QUOTA.test(text) || status === 402
        ? "quota"
        : status === 429 || RATE_LIMIT.test(text)
          ? "rate-limit"
          : status === 401 || status === 403 || (status === undefined && AUTH.test(text))
            ? "auth"
            : RETIRED.test(text)
              ? "model-retired"
              : status === 404
                ? "not-found"
                : status === 400 || status === 409 || status === 413 || status === 422
                  ? "invalid-request"
                  : "provider";
  return new ProviderError({ kind, provider, message, status, code });
}
