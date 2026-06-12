/**
 * Evolink adapter unit tests (mock-based, no API calls)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvolinkAdapter } from "./evolink.js";

// Mock the OpenAI module
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation((config: { apiKey: string; baseURL: string; defaultHeaders: Record<string, string> }) => {
      return {
        _config: config,
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "Hello from Evolink",
                    tool_calls: undefined,
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }),
          },
        },
      };
    }),
  };
});

describe("EvolinkAdapter", () => {
  let adapter: EvolinkAdapter;

  beforeEach(() => {
    adapter = new EvolinkAdapter();
  });

  describe("initialization", () => {
    it("should have correct provider name", () => {
      expect(adapter.provider).toBe("evolink");
    });

    it("should not be initialized before calling initialize", () => {
      expect(adapter.isInitialized()).toBe(false);
    });

    it("should be initialized after calling initialize", async () => {
      await adapter.initialize("test-key");
      expect(adapter.isInitialized()).toBe(true);
    });
  });

  describe("setModel", () => {
    it("should accept model names", () => {
      adapter.setModel("gpt-5.2");
      // No error thrown
      expect(true).toBe(true);
    });
  });

  describe("chat", () => {
    beforeEach(async () => {
      await adapter.initialize("test-key");
    });

    it("should return LLM response", async () => {
      const result = await adapter.chat(
        [{ role: "user", content: "hello" }],
        [],
      );

      expect(result).toBeDefined();
      expect(result.content).toBe("Hello from Evolink");
      expect(result.toolCalls).toBeUndefined();
    });

    it("should throw if not initialized", async () => {
      const uninitAdapter = new EvolinkAdapter();
      await expect(
        uninitAdapter.chat([{ role: "user", content: "hello" }], [])
      ).rejects.toThrow();
    });
  });
});
