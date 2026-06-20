/**
 * Unit tests for the per-provider live key test util. Mocks `fetch` so
 * we can verify each tester's URL + headers without making real
 * network calls.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { testKey, isTestableProvider } from "./key-live-test.js";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { calls: FetchCall[] } {
  // We don't return the mock itself — tests only inspect `calls`. Returning
  // the typed mock would force a `Mock<any[], unknown>` widening that
  // strict TypeScript rejects (variance on mockImplementation).
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    calls.push({ url: u, init });
    return responder(u, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

describe("testKey — per-provider URL + auth", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anthropic uses /v1/models with x-api-key + anthropic-version", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    const r = await testKey("anthropic", "sk-ant-test");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("openai uses Bearer authorization", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("openai", "sk-proj-test");
    expect(calls[0].url).toBe("https://api.openai.com/v1/models");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-proj-test");
  });

  it("google passes the key as a query param (no header)", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("google", "AIzaSy-test");
    expect(calls[0].url).toContain(
      "generativelanguage.googleapis.com/v1beta/models?key=AIzaSy-test",
    );
  });

  it("xai uses Bearer authorization to api.x.ai/v1/models", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("xai", "xai-test");
    expect(calls[0].url).toBe("https://api.x.ai/v1/models");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer xai-test");
  });

  it("elevenlabs uses xi-api-key header on /v1/user", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("elevenlabs", "sk_eleven-test");
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/user");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("sk_eleven-test");
  });

  it("replicate uses Bearer authorization on /v1/account", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("replicate", "r8_test");
    expect(calls[0].url).toBe("https://api.replicate.com/v1/account");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer r8_test");
  });

  it("openrouter uses Bearer authorization on /api/v1/models", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("openrouter", "sk-or-test");
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/models");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
  });

  it("evolink uses Bearer authorization on /v1/models", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("evolink", "el-test");
    expect(calls[0].url).toBe("https://direct.evolink.ai/v1/models");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer el-test");
  });

  it("runway uses Bearer + X-Runway-Version on /v1/organization", async () => {
    const { calls } = mockFetch(() => new Response("{}", { status: 200 }));
    await testKey("runway", "key_runway-test");
    expect(calls[0].url).toBe("https://api.dev.runwayml.com/v1/organization");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key_runway-test");
    // Without the version header Runway returns 401 — must always be sent.
    expect(headers["X-Runway-Version"]).toBe("2024-11-06");
  });
});

describe("testKey — response handling", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true on 2xx", async () => {
    mockFetch(() => new Response("{}", { status: 200 }));
    const r = await testKey("openai", "sk-test");
    expect(r).toEqual({ ok: true, status: 200 });
  });

  it("returns ok:false with status + message on 401", async () => {
    mockFetch(() => new Response("{}", { status: 401, statusText: "Unauthorized" }));
    const r = await testKey("openai", "sk-bogus");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.message).toBe("401 Unauthorized");
  });

  it("returns ok:false on network error", async () => {
    mockFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const r = await testKey("openai", "sk-test");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("ECONNREFUSED");
  });
});

describe("testKey — providers without a cheap test", () => {
  it("fal returns skipped (no auth-only endpoint, dated)", async () => {
    const r = await testKey("fal", "abc:xyz");
    expect(r.skipped).toBe(true);
    expect(r.message).toContain("no auth-only");
    expect(r.message).toMatch(/checked \d{4}-\d{2}-\d{2}/);
    expect(r.ok).toBe(false);
  });

  it("kling returns skipped (HMAC-signed, dated)", async () => {
    const r = await testKey("kling", "ACCESS:SECRET");
    expect(r.skipped).toBe(true);
    expect(r.message).toContain("HMAC");
    expect(r.message).toMatch(/checked \d{4}-\d{2}-\d{2}/);
  });

  it("imgbb returns skipped (upload-only, dated)", async () => {
    const r = await testKey("imgbb", "0123456789abcdef0123456789abcdef");
    expect(r.skipped).toBe(true);
    expect(r.message).toContain("upload");
    expect(r.message).toMatch(/checked \d{4}-\d{2}-\d{2}/);
  });

  it("unknown provider returns skipped: 'no tester registered'", async () => {
    const r = await testKey("not-a-real-provider", "x");
    expect(r.skipped).toBe(true);
    expect(r.message).toBe("no tester registered");
  });
});

describe("isTestableProvider", () => {
  it("returns true for every registered provider", () => {
    for (const k of [
      "anthropic", "openai", "google", "xai", "elevenlabs", "replicate",
      "openrouter", "evolink", "fal", "kling", "runway", "imgbb",
    ]) {
      expect(isTestableProvider(k)).toBe(true);
    }
  });

  it("returns false for unknown provider", () => {
    expect(isTestableProvider("not-a-real-provider")).toBe(false);
  });
});
