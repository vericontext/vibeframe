/**
 * Claude and Gemini adapters replay the provider's own assistant content
 * (thinking blocks, thought signatures) and group tool results per turn.
 * Mock-based, no API calls.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage, ToolDefinition } from "../types.js";

const claudeCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: claudeCreate } })),
}));

const geminiGenerate = vi.fn();
interface ModelConfig {
  tools: Array<{ functionDeclarations: Array<{ parameters: { properties: Record<string, unknown> } }> }>;
}
const getGenerativeModel = vi.fn((_config: ModelConfig) => ({ generateContent: geminiGenerate }));
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({ getGenerativeModel })),
  SchemaType: { OBJECT: "object" },
}));

const { ClaudeAdapter } = await import("./claude.js");
const { GeminiAdapter, toGeminiSchema } = await import("./gemini.js");

const tools: ToolDefinition[] = [
  {
    name: "fs_read",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        meta: { type: "object", description: "Free-form", additionalProperties: true } as never,
      },
      required: ["path"],
    },
  },
];

const thinking = { type: "thinking", thinking: "", signature: "sig-1" };
const toolUse = { type: "tool_use", id: "t1", name: "fs_read", input: { path: "a" } };

function history(providerContent: unknown): AgentMessage[] {
  return [
    { role: "system", content: "sys" },
    { role: "user", content: "read a and b" },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "t1", name: "fs_read", arguments: { path: "a" } },
        { id: "t2", name: "fs_read", arguments: { path: "b" } },
      ],
      providerContent,
    },
    { role: "tool", content: "A", toolCallId: "t1" },
    { role: "tool", content: "B", toolCallId: "t2" },
  ];
}

describe("ClaudeAdapter", () => {
  beforeEach(() => claudeCreate.mockReset());

  it("returns the raw content blocks and replays them verbatim", async () => {
    claudeCreate.mockResolvedValueOnce({ content: [thinking, toolUse], stop_reason: "tool_use" });
    const adapter = new ClaudeAdapter();
    await adapter.initialize("key");

    const first = await adapter.chat(history(undefined).slice(0, 2), tools);
    expect(first.providerContent).toEqual([thinking, toolUse]);

    claudeCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "done" }], stop_reason: "end_turn" });
    await adapter.chat(history(first.providerContent), tools);
    const { messages } = claudeCreate.mock.calls[1][0];
    expect(messages[1]).toEqual({ role: "assistant", content: [thinking, toolUse] });
    expect(messages[2].content.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual(["t1", "t2"]);
    expect(messages).toHaveLength(3);
  });
});

describe("GeminiAdapter", () => {
  beforeEach(() => geminiGenerate.mockReset());

  it("strips schema keys Gemini rejects", () => {
    expect(
      toGeminiSchema({
        type: "object",
        additionalProperties: true,
        properties: { tags: { type: "array", items: { type: "string", default: "x" } } },
      })
    ).toEqual({ type: "object", properties: { tags: { type: "array", items: { type: "string" } } } });
  });

  it("replays parts with thought signatures and groups function responses", async () => {
    const parts = [{ functionCall: { name: "fs_read", args: { path: "a" } }, thoughtSignature: "sig" }];
    geminiGenerate.mockResolvedValue({
      response: { candidates: [{ content: { parts }, finishReason: "STOP" }] },
    });
    const adapter = new GeminiAdapter();
    await adapter.initialize("key");

    const first = await adapter.chat(history(undefined).slice(0, 2), tools);
    expect(first.providerContent).toEqual(parts);
    const [config] = getGenerativeModel.mock.calls[0];
    const declared = config.tools[0].functionDeclarations[0];
    expect(declared.parameters.properties.meta).toEqual({ type: "object", description: "Free-form" });

    const msgs = history(first.providerContent);
    msgs[3].toolCallId = "fs_read:::1";
    msgs[4].toolCallId = "fs_read:::2";
    await adapter.chat(msgs, tools);
    const { contents } = geminiGenerate.mock.calls[1][0];
    expect(contents[1]).toEqual({ role: "model", parts });
    expect(contents[2].parts).toHaveLength(2);
    expect(contents).toHaveLength(3);
  });
});
