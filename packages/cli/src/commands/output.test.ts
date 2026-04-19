import { describe, expect, it } from "vitest";

import { apiError } from "./output.js";

describe("apiError provider hints", () => {
  it("matches the documented provider-specific patterns", () => {
    expect(apiError("Incorrect API key provided")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("API key is invalid or expired"),
    });

    expect(apiError("invalid_api_key")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("API key is invalid or expired"),
    });

    expect(apiError("context_length_exceeded")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("context window"),
    });

    expect(apiError("overloaded_error")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("temporarily overloaded"),
    });

    expect(apiError("RESOURCE_EXHAUSTED")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Quota exceeded"),
    });

    expect(apiError("API key test did not start with 'key_'")) .toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("API key is invalid or expired"),
    });

    expect(apiError("voice_not_found")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("Voice ID not found"),
    });

    expect(apiError("invalid_character_count")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("character limit"),
    });

    expect(apiError("INSUFFICIENT_BALANCE")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("credits exhausted"),
    });
  });

  it("falls back to the default retry guidance when nothing matches", () => {
    expect(apiError("plain failure", true)).toMatchObject({
      retryable: true,
      suggestion: "Retry the command.",
    });

    expect(apiError("plain failure", false)).toMatchObject({
      retryable: false,
      suggestion: undefined,
    });
  });

  it("does not over-match unrelated messages", () => {
    expect(apiError("model not found")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("model is unavailable"),
    });

    expect(apiError("authentication succeeded but model not found")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("model is unavailable"),
    });
  });

  it("prefers the billing hint over rate-limit when 429 carries a balance message", () => {
    // Kling returns HTTP 429 for "Account balance not enough" — a billing
    // issue, not a transient rate limit. Billing patterns must win.
    expect(apiError("API error (429): Account balance not enough")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("balance or credits exhausted"),
    });

    expect(apiError("balance is not enough to proceed")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("balance or credits exhausted"),
    });
  });

  it("matches rate-limit patterns", () => {
    expect(apiError("HTTP 429 Too Many Requests")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Rate limited"),
    });

    expect(apiError("rate-limit reached")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Rate limited"),
    });

    expect(apiError("rate limit exceeded")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Rate limited"),
    });

    expect(apiError("too many requests, slow down")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Rate limited"),
    });
  });

  it("matches forbidden / permission denied patterns", () => {
    expect(apiError("HTTP 403 returned")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("Access denied"),
    });

    expect(apiError("forbidden for this resource")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("Access denied"),
    });

    expect(apiError("permission denied on endpoint")).toMatchObject({
      retryable: false,
      suggestion: expect.stringContaining("Access denied"),
    });
  });

  it("matches 5xx server error patterns", () => {
    expect(apiError("HTTP 500 error from upstream")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Provider server error"),
    });

    expect(apiError("internal error occurred")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Provider server error"),
    });

    expect(apiError("server error: try again")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("Provider server error"),
    });

    expect(apiError("HTTP 503 service unavailable")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("temporarily overloaded"),
    });

    expect(apiError("service unavailable, retry later")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("temporarily overloaded"),
    });
  });

  it("matches timeout / connection-drop patterns", () => {
    expect(apiError("request timeout after 60s")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("timed out"),
    });

    expect(apiError("operation timed out")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("timed out"),
    });

    expect(apiError("ETIMEDOUT connecting to host")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("timed out"),
    });

    expect(apiError("ECONNRESET by peer")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("timed out"),
    });

    expect(apiError("socket hang up")).toMatchObject({
      retryable: true,
      suggestion: expect.stringContaining("timed out"),
    });
  });
});
