import { afterEach, describe, expect, it, vi } from "vitest";

import { RunwayProvider } from "./RunwayProvider.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function provider() {
  const runway = new RunwayProvider();
  await runway.initialize({ apiKey: "key" });
  return runway;
}

describe("RunwayProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps polling a THROTTLED task, which is queued rather than failed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "t1", status: "THROTTLED" })));
    const result = await (await provider()).getGenerationStatus("t1");
    expect(result.status).toBe("pending");
    expect(result.error).toBeUndefined();
  });

  it("reports the failure code so callers can tell retryable failures apart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json({ id: "t1", status: "FAILED", failure: "Input rejected", failureCode: "SAFETY.INPUT.TEXT" })
      )
    );
    const result = await (await provider()).getGenerationStatus("t1");
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Input rejected (SAFETY.INPUT.TEXT)");
  });

  it("cancels with the documented DELETE /v1/tasks/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect((await provider()).cancelGeneration("t1")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/tasks\/t1$/);
    expect(init.method).toBe("DELETE");
  });

  it("rejects square text-to-video before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await (await provider()).generateVideo("p", { prompt: "p", aspectRatio: "1:1" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/16:9 and 9:16 only/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
