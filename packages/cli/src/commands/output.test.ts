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
});
