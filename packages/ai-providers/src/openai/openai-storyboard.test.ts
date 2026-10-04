import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzeContent } from "./openai-storyboard.js";

function mockChatResponse(content: string) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OpenAI storyboard analyzeContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only parameters GPT-5.x reasoning models accept", async () => {
    const fetchMock = mockChatResponse('{"segments": []}');

    await analyzeContent("key", "A coffee mug teaser", 10, { creativity: "high" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body.max_completion_tokens).toBeGreaterThan(4096);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain('{"segments": [');
  });

  it("unwraps the segments array from the json_object response", async () => {
    const segment = { index: 0, description: "Steam rises", startTime: 0, duration: 5 };
    mockChatResponse(JSON.stringify({ segments: [segment] }));

    await expect(analyzeContent("key", "A coffee mug teaser", 10)).resolves.toEqual([segment]);
  });
});
