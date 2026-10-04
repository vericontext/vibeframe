import { describe, expect, it, vi } from "vitest";

import { KlingProvider, klingDuration, resolveKlingModel } from "./KlingProvider.js";

describe("resolveKlingModel", () => {
  it("defaults to kling-v3 and maps aliases", () => {
    expect(resolveKlingModel(undefined)).toBe("kling-v3");
    expect(resolveKlingModel("v2.6")).toBe("kling-v2-6");
    expect(resolveKlingModel("v2.5-turbo")).toBe("kling-v2-5-turbo");
    expect(resolveKlingModel("kling-v3")).toBe("kling-v3");
  });

  it("rejects models the text2video/image2video endpoints do not accept", () => {
    expect(() => resolveKlingModel("v3-omni")).toThrow(/Unknown Kling model/);
  });
});

describe("klingDuration", () => {
  it("lets kling-v3 use 3-15 seconds", () => {
    expect(klingDuration("kling-v3", 8)).toBe("8");
    expect(klingDuration("kling-v3", 1)).toBe("3");
    expect(klingDuration("kling-v3", 40)).toBe("15");
    expect(klingDuration("kling-v3")).toBe("5");
  });

  it("keeps the v2.x models on 5 or 10 seconds", () => {
    expect(klingDuration("kling-v2-6", 8)).toBe("5");
    expect(klingDuration("kling-v2-5-turbo", 12)).toBe("10");
  });
});

describe("KlingProvider auth", () => {
  async function authHeaderFor(apiKey: string) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, data: { task_id: "t1" } }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const kling = new KlingProvider();
    await kling.initialize({ apiKey });
    expect(kling.isConfigured()).toBe(true);
    await kling.generateVideo("p", { prompt: "p" });
    vi.unstubAllGlobals();
    return fetchMock.mock.calls[0][1].headers.Authorization as string;
  }

  it("sends a single console API key as the Bearer token", async () => {
    expect(await authHeaderFor("single-api-key")).toBe("Bearer single-api-key");
  });

  it("signs a JWT from the legacy access/secret pair", async () => {
    const header = await authHeaderFor("access:secret");
    expect(header).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("is not configured without a key", async () => {
    const kling = new KlingProvider();
    await kling.initialize({});
    expect(kling.isConfigured()).toBe(false);
  });
});
