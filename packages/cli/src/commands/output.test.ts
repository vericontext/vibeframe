import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, beforeEach, afterEach, vi, type MockInstance } from "vitest";

import {
  apiError,
  emitDeprecationWarning,
  outputSuccess,
  _resetDeprecationMemoryForTesting,
} from "./output.js";

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

describe("emitDeprecationWarning", () => {
  // Save and restore env + tty so we don't leak between cases.
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stderr.isTTY;
  let stderrChunks: string[] = [];
  // process.stderr.write has overloads vitest's MockInstance can't unify, so
  // we type the spy as the loosest unknown-args form and cast the
  // implementation accordingly. This is the documented escape hatch when
  // mocking native node Writable streams.
  let stderrSpy: MockInstance<unknown[], unknown>;

  beforeEach(() => {
    stderrChunks = [];
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array): boolean => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as never) as unknown as MockInstance<unknown[], unknown>;
    _resetDeprecationMemoryForTesting();
    delete process.env.VIBE_JSON_OUTPUT;
    delete process.env.VIBE_QUIET_OUTPUT;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env = { ...originalEnv };
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
  });

  it("writes a single-line warning to stderr in human mode", () => {
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    const output = stderrChunks.join("");
    expect(output).toContain("[deprecated]");
    expect(output).toContain("'pipeline'");
    expect(output).toContain("'remix'");
    expect(output).toContain("v1.0");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("is suppressed in JSON mode", () => {
    process.env.VIBE_JSON_OUTPUT = "1";
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    expect(stderrChunks.join("")).toBe("");
  });

  it("is suppressed in quiet mode", () => {
    process.env.VIBE_QUIET_OUTPUT = "1";
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    expect(stderrChunks.join("")).toBe("");
  });

  it("is suppressed when stderr is not a TTY (CI / piped logs)", () => {
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    expect(stderrChunks.join("")).toBe("");
  });

  it("dedupes repeat calls for the same (old, new) pair", () => {
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    const lines = stderrChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("emits separately for distinct (old, new) pairs", () => {
    emitDeprecationWarning("pipeline", "remix", "v1.0");
    emitDeprecationWarning("analyze", "inspect", "v1.0");
    const lines = stderrChunks.join("").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("outputSuccess dry runs in human mode", () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    vi.stubEnv("VIBE_JSON_OUTPUT", "");
    vi.stubEnv("VIBE_QUIET_OUTPUT", "");
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(stripVTControlCharacters(args.join(" ")));
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(stripVTControlCharacters(String(chunk)));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prints the command, estimated cost, set params, and warnings", () => {
    outputSuccess({
      command: "generate image",
      startedAt: Date.now(),
      dryRun: true,
      costUsd: 0.21,
      warnings: ["costUsd is an estimate"],
      data: { params: { prompt: "a cat", provider: "openai", image: undefined, refs: [] } },
    });

    expect(stdout).toContain("Dry run: vibe generate image (nothing was sent)");
    expect(stdout).toContain("  cost      up to $0.21 (estimate)");
    expect(stdout).toContain("  prompt    a cat");
    expect(stdout.some((line) => /^ {2}(image|refs) /.test(line))).toBe(false);
    expect(stderr).toEqual(["Warning: costUsd is an estimate\n"]);
  });

  it("calls a zero-cost dry run free", () => {
    outputSuccess({ command: "detect scenes", startedAt: Date.now(), dryRun: true, costUsd: 0, data: { params: {} } });
    expect(stdout).toContain("  cost  free");
  });

  it("stays silent when the caller rendered its own output, and for real runs", () => {
    outputSuccess({ command: "build", startedAt: Date.now(), dryRun: true, humanRendered: true, data: {} });
    outputSuccess({ command: "generate image", startedAt: Date.now(), data: { outputPath: "c.png" } });
    expect(stdout).toEqual([]);
  });
});
