import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keys come only from process.env here, never this machine's config or .env.
vi.mock("../../utils/api-key.js", () => ({
  getConfiguredApiKey: async (envVar: string, optionValue?: string) => optionValue ?? process.env[envVar],
}));

import { FakeProviderNetwork, jsonResponse } from "../../testing/fake-provider-network.js";
import { languageName, translateTexts } from "./translate-texts.js";

let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
});

describe("translateTexts", () => {
  it("matches lines by their [N] index, keeping the source text for any line left out", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    // Out of order, line 1 missing, and a chatty preamble.
    net.on("POST", "api.anthropic.com", /\/v1\/messages$/, () =>
      jsonResponse({ content: [{ type: "text", text: "Here you go:\n[2] 셋\n[0] 하나" }] })
    );

    const result = await translateTexts(["one", "two", "three"], { targetLanguage: "ko" });

    expect(result).toEqual({ success: true, provider: "claude", texts: ["하나", "two", "셋"] });
    expect(String((net.requests[0].body as { messages: Array<{ content: string }> }).messages[0].content)).toContain("to Korean");
  });

  it("uses OpenAI when there is no Anthropic key", async () => {
    process.env.OPENAI_API_KEY = "k";
    net.on("POST", "api.openai.com", /\/v1\/chat\/completions$/, () =>
      jsonResponse({ choices: [{ message: { content: "[0] Hola" } }] })
    );

    await expect(translateTexts(["Hello"], { targetLanguage: "es" })).resolves.toMatchObject({ success: true, provider: "openai", texts: ["Hola"] });
  });

  it("batches long lists and reports a missing key as auth", async () => {
    await expect(translateTexts(["x"], { targetLanguage: "ko" })).resolves.toMatchObject({ success: false, errorKind: "auth" });

    process.env.ANTHROPIC_API_KEY = "k";
    net.on("POST", "api.anthropic.com", /\/v1\/messages$/, () => jsonResponse({ content: [{ type: "text", text: "[0] a\n[1] b" }] }));
    const result = await translateTexts(["1", "2", "3", "4"], { targetLanguage: "ko", batchSize: 2 });

    expect(net.requests).toHaveLength(2);
    expect(result).toMatchObject({ texts: ["a", "b", "a", "b"] });
  });

  it("names language codes for the prompt", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("Swahili")).toBe("Swahili");
  });
});
