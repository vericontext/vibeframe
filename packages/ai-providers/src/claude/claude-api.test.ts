import { afterEach, describe, expect, it, vi } from "vitest";

import { CLAUDE_MIN_MAX_TOKENS, callClaude } from "./claude-api.js";

const api = { apiKey: "key", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" };

function mockReply(text: string) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: "thinking" }, { type: "text", text }] }))
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("callClaude", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves room for thinking and never sends sampling params", async () => {
    const fetchMock = mockReply("hi");
    await expect(
      callClaude(api, { system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 1024 })
    ).resolves.toBe("hi");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBe(CLAUDE_MIN_MAX_TOKENS);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("output_config");
  });

  it("requests structured output when a schema is given", async () => {
    const fetchMock = mockReply('{"name":"A"}');
    const schema = { type: "object", properties: { name: { type: "string" } } };
    await callClaude(api, {
      system: "s",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 32000,
      jsonSchema: schema,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.max_tokens).toBe(32000);
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema } });
  });
});
