import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderError } from "../shared/errors.js";
import { CLAUDE_MIN_MAX_TOKENS, callClaude, parseClaudeJson } from "./claude-api.js";
import { analyzeContent, generateMotion } from "./claude-motion.js";
import { analyzeForHighlights } from "./claude-analysis.js";
import { analyzeViralPotential } from "./claude-viral.js";
import { analyzeColorGrade, analyzeForSpeedRamp, analyzeFrameForReframe } from "./claude-visual-fx.js";
import { ClaudeProvider } from "./ClaudeProvider.js";

const api = { apiKey: "key", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5-5" };

function mockReply(text: string) {
  const fetchMock = vi.fn().mockImplementation(
    async () => new Response(JSON.stringify({ content: [{ type: "thinking" }, { type: "text", text }] }))
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockStatus(status: number, body: unknown) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const AUTH_401 = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };

const call = () => callClaude(api, { system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 1024 });

/** The ProviderError a promise rejects with. */
async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callClaude", () => {
  it("leaves room for thinking and never sends sampling params", async () => {
    const fetchMock = mockReply("hi");
    await expect(call()).resolves.toBe("hi");

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

  it("turns a 401 into a ProviderError of kind auth without retrying", async () => {
    const fetchMock = mockStatus(401, AUTH_401);
    const error = await rejection(call());
    expect(error).toMatchObject({ kind: "auth", provider: "claude", status: 401, retryable: false });
    expect(error.message).toContain("invalid x-api-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns a reply with no text block into a ProviderError of kind provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "thinking" }] }))));
    expect(await rejection(call())).toMatchObject({ kind: "provider", provider: "claude" });
  });

  it("turns a refusal into a ProviderError of kind moderation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ stop_reason: "refusal", content: [] })))
    );
    expect(await rejection(call())).toMatchObject({ kind: "moderation" });
  });
});

describe("parseClaudeJson", () => {
  it("reads JSON wrapped in prose or a code fence", () => {
    expect(parseClaudeJson("Here:\n```json\n{\"a\":1}\n```", { task: "t", shape: "object" })).toEqual({ a: 1 });
    expect(parseClaudeJson("[1,2]", { task: "t", shape: "array" })).toEqual([1, 2]);
  });

  it("rejects prose, the wrong shape, and JSON that fails validation, naming the task", () => {
    for (const [text, shape] of [["no json here", "object"], ["{\"a\":1}", "array"], ["{oops}", "object"]] as const) {
      expect(() => parseClaudeJson(text, { task: "color grade", shape })).toThrow(/color grade reply that could not be parsed/);
    }
    expect(() =>
      parseClaudeJson<{ a?: string }>("{\"b\":1}", { task: "t", shape: "object", isValid: (v) => typeof v.a === "string" })
    ).toThrow(ProviderError);
  });
});

describe("Claude helpers propagate failures instead of returning defaults", () => {
  const segments = [{ id: "0", startTime: 0, endTime: 4, text: "hello there", confidence: 1 }];
  const frame = { focusMode: "auto" as const, sourceWidth: 320, sourceHeight: 240 };

  it("a 401 surfaces as kind auth from every helper", async () => {
    mockStatus(401, AUTH_401);
    const calls: Array<Promise<unknown>> = [
      analyzeColorGrade(api, "moody teal"),
      analyzeFrameForReframe(api, "AAAA", "9:16", frame),
      analyzeForSpeedRamp(api, segments),
      analyzeForHighlights(api, segments),
      analyzeViralPotential(api, segments, { duration: 4, clipCount: 1 }, ["tiktok"]),
      generateMotion(api, "a title card"),
      analyzeContent(api, "a script"),
    ];
    for (const pending of calls) {
      expect(await rejection(pending)).toMatchObject({ kind: "auth", provider: "claude" });
    }
  });

  it("an unparseable reply is a ProviderError naming the task, not a default", async () => {
    mockReply("Sorry, I cannot help with that.");
    expect((await rejection(analyzeColorGrade(api, "moody teal"))).message).toContain("color grade");
    expect((await rejection(analyzeFrameForReframe(api, "AAAA", "9:16", frame))).message).toContain("reframe");
    expect((await rejection(analyzeContent(api, "a script"))).message).toContain("storyboard");
    expect((await rejection(generateMotion(api, "a title card"))).message).toContain("motion graphic");
  });

  it("a reply missing the fields the caller needs is rejected", async () => {
    mockReply('{"description":"no filter here"}');
    expect(await rejection(analyzeColorGrade(api, "moody teal"))).toMatchObject({ kind: "provider" });
    mockReply('{"cropX":"left","cropY":0}');
    expect(await rejection(analyzeFrameForReframe(api, "AAAA", "9:16", frame))).toMatchObject({ kind: "provider" });
  });

  it("returns parsed results and clamps the reframe crop", async () => {
    mockReply('{"ffmpegFilter":"eq=contrast=1.2","description":"Moody"}');
    await expect(analyzeColorGrade(api, "moody teal")).resolves.toEqual({ ffmpegFilter: "eq=contrast=1.2", description: "Moody" });
    mockReply('{"cropX":9999,"cropY":0,"confidence":0.9,"subjectDescription":"Person"}');
    await expect(analyzeFrameForReframe(api, "AAAA", "9:16", frame)).resolves.toMatchObject({
      cropX: 320 - 135,
      cropWidth: 135,
      subjectDescription: "Person",
    });
  });

  it("presets and center crops need no call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzeColorGrade(api, "", "vintage")).resolves.toMatchObject({ ffmpegFilter: expect.any(String) });
    await expect(analyzeFrameForReframe(api, "AAAA", "9:16", { ...frame, focusMode: "center" })).resolves.toMatchObject({
      confidence: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ClaudeProvider without a key", () => {
  it("throws kind auth for methods that need Claude instead of returning an empty result", async () => {
    const claude = new ClaudeProvider();
    await expect(claude.analyzeForHighlights([])).rejects.toMatchObject({ kind: "auth", provider: "claude" });
    await expect(claude.analyzeContent("script")).rejects.toMatchObject({ kind: "auth" });
    await expect(claude.generateMotion("title")).rejects.toMatchObject({ kind: "auth" });
    await expect(claude.analyzeForSpeedRamp([])).rejects.toMatchObject({ kind: "auth" });
  });
});
