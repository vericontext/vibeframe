import { describe, expect, it } from "vitest";

import { withStdoutOnStderr } from "./stdout-guard.js";

/** Capture what each stream received while `fn` runs. */
async function capture(fn: () => Promise<void>): Promise<{ out: string; err: string }> {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return { out, err };
}

describe("withStdoutOnStderr", () => {
  it("routes library chatter to stderr so stdout stays parseable", async () => {
    const { out, err } = await capture(async () => {
      await withStdoutOnStderr(async () => {
        // Stands in for the render engine's `[BrowserManager] ...` lines.
        // Written straight to the stream because vitest intercepts `console`
        // before it ever reaches `process.stdout.write`, which is the layer
        // this guard swaps out.
        process.stdout.write("[BrowserManager] Browser launched\n");
      });
      process.stdout.write(JSON.stringify({ ok: true }));
    });

    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toContain("BrowserManager");
    expect(err).toContain("BrowserManager");
  });

  it("restores the original writer after the callback throws", async () => {
    const { out, err } = await capture(async () => {
      await expect(
        withStdoutOnStderr(async () => {
          process.stdout.write("during\n");
          throw new Error("render failed");
        })
      ).rejects.toThrow("render failed");
      process.stdout.write("after\n");
    });

    expect(err).toContain("during");
    expect(out).toContain("after");
  });

  it("returns the callback's value", async () => {
    await expect(withStdoutOnStderr(async () => 42)).resolves.toBe(42);
  });
});
