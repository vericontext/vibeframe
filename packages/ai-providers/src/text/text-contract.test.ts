import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultModel } from "../catalog/catalog.js";
import { FakeProviderNetwork, jsonResponse, type RecordedRequest } from "../testing/fake-provider-network.js";
import type { TextRequest } from "./contract.js";
import { createTextGenerator } from "./registry.js";
import { meterUsage, meterUsageSettled } from "../usage/meter.js";

const SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

const REQUEST: TextRequest = {
  system: "Answer in JSON.",
  messages: [{ role: "user", content: "Say hi." }],
  jsonSchema: SCHEMA,
};

interface ProviderCase {
  provider: "claude" | "openai" | "gemini";
  host: string;
  path: RegExp;
  reply: (text: string) => unknown;
  refusal: unknown;
  truncated: unknown;
  /** The request body fields that carry system, conversation, schema, and cap. */
  expectBody: (body: Record<string, unknown>, model: string) => void;
  /** Usage fields for 1,200 input tokens and 300 output tokens (thinking included). */
  usage: Record<string, unknown>;
}

const CASES: ProviderCase[] = [
  {
    provider: "claude",
    host: "api.anthropic.com",
    path: /^\/v1\/messages$/,
    reply: (text) => ({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text }], stop_reason: "end_turn" }),
    refusal: { content: [], stop_reason: "refusal" },
    truncated: { content: [{ type: "text", text: "{\"ans" }], stop_reason: "max_tokens" },
    expectBody: (body, model) => {
      expect(body).toMatchObject({
        model,
        max_tokens: 32_000,
        system: "Answer in JSON.",
        messages: [{ role: "user", content: "Say hi." }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      });
      expect(body).not.toHaveProperty("temperature");
    },
    usage: { usage: { input_tokens: 1_200, output_tokens: 300 } },
  },
  {
    provider: "openai",
    host: "api.openai.com",
    path: /^\/v1\/responses$/,
    reply: (text) => ({
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text }] },
      ],
    }),
    refusal: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No." }] }] },
    truncated: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] },
    expectBody: (body, model) => {
      expect(body).toMatchObject({
        model,
        instructions: "Answer in JSON.",
        input: [{ role: "user", content: "Say hi." }],
        max_output_tokens: 32_000,
        text: { format: { type: "json_schema", name: "reply", schema: SCHEMA, strict: true } },
      });
      expect(body).not.toHaveProperty("temperature");
    },
    usage: { usage: { input_tokens: 1_200, output_tokens: 300 } },
  },
  {
    provider: "gemini",
    host: "generativelanguage.googleapis.com",
    path: /^\/v1beta\/models\/[^/]+:generateContent$/,
    reply: (text) => ({
      candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text }] }, finishReason: "STOP" }],
    }),
    refusal: { promptFeedback: { blockReason: "SAFETY" } },
    truncated: { candidates: [{ content: { parts: [{ text: "{\"ans" }] }, finishReason: "MAX_TOKENS" }] },
    expectBody: (body) => {
      expect(body).toMatchObject({
        systemInstruction: { parts: [{ text: "Answer in JSON." }] },
        contents: [{ role: "user", parts: [{ text: "Say hi." }] }],
        generationConfig: { maxOutputTokens: 32_000, responseMimeType: "application/json", responseJsonSchema: SCHEMA },
      });
      expect(JSON.stringify(body)).not.toContain("temperature");
    },
    // Thinking tokens are billed as output but reported apart from the candidates.
    usage: { usageMetadata: { promptTokenCount: 1_200, candidatesTokenCount: 200, thoughtsTokenCount: 100, totalTokenCount: 1_500 } },
  },
];

describe.each(CASES)("$provider text contract", (c) => {
  let net: FakeProviderNetwork;
  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
  });
  afterEach(() => net.uninstall());

  const lastBody = () => (net.requests.at(-1) as RecordedRequest).body as Record<string, unknown>;

  it("sends the system prompt, conversation, and schema to the catalog default model", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse(c.reply("{\"answer\":\"hi\"}")));
    const generator = await createTextGenerator(c.provider, "secret-test-key");
    expect(generator.textProvider).toBe(c.provider);

    const result = await generator.generateText(REQUEST);

    const model = defaultModel(c.provider, "llm").id;
    expect(result).toEqual({ text: "{\"answer\":\"hi\"}", model });
    c.expectBody(lastBody(), model);
    if (c.provider === "gemini") expect(net.requests.at(-1)?.path).toContain(`/models/${model}:generateContent`);
    // The key travels in a header, never the URL.
    expect(net.requests.at(-1)?.url).not.toContain("secret-test-key");
    expect(Object.values(net.requests.at(-1)?.headers ?? {}).join(" ")).toContain("secret-test-key");
  });

  it("records the billed tokens for cost reporting", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse({ ...(c.reply("ok") as object), ...c.usage }));
    const generator = await createTextGenerator(c.provider, "k");
    const { usage } = await meterUsage(() => generator.generateText(REQUEST));
    expect(usage).toEqual([
      expect.objectContaining({
        provider: c.provider,
        kind: "llm",
        model: defaultModel(c.provider, "llm").id,
        amount: { unit: "tokens", input: 1_200, output: 300 },
      }),
    ]);
  });

  it("records the tokens of a reply cut off by the output cap, which is still billed", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse({ ...(c.truncated as object), ...c.usage }));
    const generator = await createTextGenerator(c.provider, "k");
    const settled = await meterUsageSettled(() => generator.generateText(REQUEST));
    expect("error" in settled).toBe(true);
    expect(settled.usage.map((r) => r.amount)).toEqual([{ unit: "tokens", input: 1_200, output: 300 }]);
  });

  it("keeps thinking out of the reply text", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse(c.reply("plain")));
    const generator = await createTextGenerator(c.provider, "k");
    expect((await generator.generateText({ messages: [{ role: "user", content: "x" }] })).text).toBe("plain");
  });

  it("reports a refusal as moderation", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse(c.refusal));
    const generator = await createTextGenerator(c.provider, "k");
    await expect(generator.generateText(REQUEST)).rejects.toMatchObject({ kind: "moderation", provider: c.provider });
  });

  it("reports a reply cut off by the output cap instead of returning half of it", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse(c.truncated));
    const generator = await createTextGenerator(c.provider, "k");
    await expect(generator.generateText({ ...REQUEST, maxOutputTokens: 100 })).rejects.toMatchObject({
      kind: "invalid-request",
      message: expect.stringContaining("100-token output cap"),
    });
  });

  it("classifies a bad key", async () => {
    net.on("POST", c.host, c.path, () => jsonResponse({ error: { message: "invalid x-api-key" } }, 401));
    const generator = await createTextGenerator(c.provider, "k");
    await expect(generator.generateText(REQUEST)).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects an unknown model before sending", async () => {
    const generator = await createTextGenerator(c.provider, "k");
    await expect(generator.generateText({ ...REQUEST, model: "no-such-model" })).rejects.toMatchObject({
      kind: "invalid-request",
    });
    expect(net.requests).toHaveLength(0);
  });
});

describe("createTextGenerator", () => {
  it("names the providers it knows", async () => {
    await expect(createTextGenerator("grok", "k")).rejects.toMatchObject({
      kind: "invalid-request",
      message: expect.stringContaining("claude, openai, gemini"),
    });
  });
});
