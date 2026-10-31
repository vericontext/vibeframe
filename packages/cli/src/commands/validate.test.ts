/**
 * Validators reject bad input with an InputError, which every command's
 * catch-all reports as a usage error. A path outside the working directory
 * used to surface as exit 5 API_ERROR with "Retry the command.".
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { failureFromError } from "./output.js";
import { detectCommand } from "./detect.js";
import { InputError, rejectControlChars, validateOutputPath, validateResourceId } from "./validate.js";

describe("validators", () => {
  it("throw InputError for bad input", () => {
    expect(() => validateOutputPath("../escape.mp4", "/work")).toThrow(InputError);
    expect(() => validateResourceId("clip/../x")).toThrow(InputError);
    expect(() => rejectControlChars("a\u0000b")).toThrow(InputError);
  });

  it("allow paths inside the working directory and absolute paths", () => {
    expect(validateOutputPath("out/clip.mp4", "/work")).toBe("/work/out/clip.mp4");
    expect(validateOutputPath("/elsewhere/clip.mp4", "/work")).toBe("/elsewhere/clip.mp4");
  });

  it("map to a usage error, not a retryable API error", () => {
    const failure = failureFromError(new InputError('Output path "../x" escapes the working directory.'), "Scene detection failed");
    expect(failure).toMatchObject({ code: "USAGE_ERROR", exitCode: 2, retryable: false });
  });
});

describe("a command given an output outside the working directory", () => {
  let dir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.VIBE_JSON_OUTPUT;
  });

  it("exits 2 with USAGE_ERROR", async () => {
    dir = mkdtempSync(join(tmpdir(), "vibe-validate-"));
    process.env.VIBE_JSON_OUTPUT = "1";
    let exitCode: number | undefined;
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exitCode ??= code;
      throw new Error("process.exit");
    }) as never);
    const stderr: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      stderr.push(parts.map(String).join(" "));
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await detectCommand
      .parseAsync(["scenes", join(dir, "missing.mp4"), "-o", "../escape.json"], { from: "user" })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.message === "process.exit")) throw error;
      });

    const envelope = JSON.parse(stderr.find((line) => line.trimStart().startsWith("{")) ?? "{}");
    expect(exitCode).toBe(2);
    expect(envelope).toMatchObject({ code: "USAGE_ERROR" });
  });
});
