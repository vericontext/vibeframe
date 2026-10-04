import { describe, expect, it } from "vitest";

import { ModelRetiredError, defaultModel } from "../catalog/catalog.js";
import { ProviderError, classifyProviderError } from "./errors.js";

const kind = (message: string, status?: number, code?: string) =>
  classifyProviderError({ provider: "test", message, status, code }).kind;

describe("classifyProviderError", () => {
  it("recognises provider wording that HTTP status alone gets wrong", () => {
    // fal's 422 for a face in the keyframe: a likeness rejection, not a bad request.
    expect(kind("The images or videos provided may contain likenesses of real people", 422, "content_policy_violation")).toBe("likeness");
    expect(kind("Input rejected (SAFETY.INPUT.TEXT)", undefined, "SAFETY.INPUT.TEXT")).toBe("moderation");
    expect(kind("Prompt blocked by content policy", 400)).toBe("moderation");
    // A 429 that means the account is out of credits: waiting will not help.
    expect(kind("You have insufficient credits", 429)).toBe("quota");
    expect(kind("RESOURCE_EXHAUSTED", 429)).toBe("quota");
    expect(kind("Payment required", 402)).toBe("quota");
  });

  it("falls back to the HTTP status", () => {
    expect(kind("slow down", 429)).toBe("rate-limit");
    expect(kind("bad key", 401)).toBe("auth");
    expect(kind("nope", 403)).toBe("auth");
    expect(kind("missing", 404)).toBe("not-found");
    expect(kind("duration must be at most 10", 422)).toBe("invalid-request");
    expect(kind("upstream exploded", 500)).toBe("provider");
    expect(kind("An unexpected error occurred (INTERNAL)", undefined, "INTERNAL")).toBe("provider");
  });

  it("marks only transient kinds retryable and serialises to plain data", () => {
    const limited = classifyProviderError({ provider: "runway", message: "slow down", status: 429 });
    expect(limited.retryable).toBe(true);
    expect(classifyProviderError({ provider: "runway", message: "bad key", status: 401 }).retryable).toBe(false);
    expect(JSON.parse(JSON.stringify(limited))).toEqual({
      kind: "rate-limit",
      provider: "runway",
      message: "slow down",
      retryable: true,
      status: 429,
    });
  });

  it("treats a retired model as a provider error of its own kind", () => {
    const error = new ModelRetiredError("gone", defaultModel("veo", "video"));
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "model-retired", provider: "veo", retryable: false });
  });
});
