import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const results = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5));
      return n * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let live = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("behaves like Promise.all when limit >= item count", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    let started = 0;
    const run = mapWithConcurrency([0, 1, 2], 10, async (i) => {
      started += 1;
      await gates[i].promise;
      return i;
    });
    // All three must have started despite none having finished.
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(3);
    gates.forEach((g) => g.resolve());
    expect(await run).toEqual([0, 1, 2]);
  });

  it("returns [] for an empty array", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("propagates the first rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 1, async (n) => {
        if (n === 2) throw new Error(`bad ${n}`);
        return n;
      })
    ).rejects.toThrow("bad 2");
  });

  it("throws RangeError for a non-positive limit", async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(RangeError);
  });
});
