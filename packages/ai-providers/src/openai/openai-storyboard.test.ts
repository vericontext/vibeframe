import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../shared/errors.js";
import { analyzeContent } from "./openai-storyboard.js";

const API = { apiKey: "key", baseUrl: "https://api.openai.com/v1" };

function mockResponsesReply(text: string, status = 200) {
  const body = status === 200
    ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] }
    : { error: { message: text } };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenAI storyboard analyzeContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the Responses API for the segments wrapped in an object", async () => {
    const fetchMock = mockResponsesReply('{"segments": []}');

    await analyzeContent(API, "A coffee mug teaser", 10, { creativity: "high" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_output_tokens).toBeGreaterThan(4096);
    expect(body.instructions).toContain('{"segments": [');
  });

  it("unwraps the segments array", async () => {
    const segment = { index: 0, description: "Steam rises", startTime: 0, duration: 5 };
    mockResponsesReply(JSON.stringify({ segments: [segment] }));

    await expect(analyzeContent(API, "A coffee mug teaser", 10)).resolves.toEqual([segment]);
  });

  it("throws a provider error for a reply with no segments", async () => {
    mockResponsesReply("Sorry, I cannot help with that.");

    await expect(analyzeContent(API, "A coffee mug teaser", 10)).rejects.toMatchObject({ kind: "provider" });
  });

  it("throws an auth error for a rejected key instead of returning no segments", async () => {
    mockResponsesReply("Incorrect API key provided", 401);

    const error = await analyzeContent(API, "A coffee mug teaser", 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "auth", provider: "openai" });
  });
});
