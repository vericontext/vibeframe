/**
 * WhisperProvider unit tests (mock-based, no API calls).
 *
 * Covers the granularity option added in v0.54: segment | word | both.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhisperProvider } from "./WhisperProvider.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });

const audio = new Blob([new Uint8Array([1, 2, 3])]);

const segmentResponse = {
  text: "Hello world.",
  language: "en",
  segments: [
    { id: 0, start: 0, end: 1.5, text: "Hello world." },
  ],
};

const wordResponse = {
  text: "Hello world.",
  language: "en",
  words: [
    { word: "Hello", start: 0.0, end: 0.6 },
    { word: "world.", start: 0.7, end: 1.5 },
  ],
};

const bothResponse = {
  ...segmentResponse,
  words: wordResponse.words,
};

function okResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function captureFormData(): FormData {
  // Last call's `body` argument
  const calls = mockFetch.mock.calls;
  const last = calls[calls.length - 1];
  return last[1].body as FormData;
}

describe("WhisperProvider", () => {
  let provider: WhisperProvider;

  beforeEach(async () => {
    provider = new WhisperProvider();
    await provider.initialize({ apiKey: "test-key" });
    mockFetch.mockReset();
  });

  describe("initialization", () => {
    it("declares speech-to-text capability", () => {
      expect(provider.id).toBe("whisper");
      expect(provider.capabilities).toContain("speech-to-text");
    });

    it("returns failed result without API key", async () => {
      const fresh = new WhisperProvider();
      const result = await fresh.transcribe(audio);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("not configured");
    });
  });

  describe("granularity: default (segment)", () => {
    it("sends timestamp_granularities[]=segment when no options", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(segmentResponse));

      const result = await provider.transcribe(audio);

      const fd = captureFormData();
      const granularities = fd.getAll("timestamp_granularities[]");
      expect(granularities).toEqual(["segment"]);

      expect(result.status).toBe("completed");
      expect(result.segments).toHaveLength(1);
      expect(result.segments?.[0].text).toBe("Hello world.");
      expect(result.words).toBeUndefined();
    });

    it("attaches legacy language argument", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(segmentResponse));

      await provider.transcribe(audio, "ko");

      const fd = captureFormData();
      expect(fd.get("language")).toBe("ko");
    });
  });

  describe("granularity: word", () => {
    it("sends timestamp_granularities[]=word and parses words", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(wordResponse));

      const result = await provider.transcribe(audio, undefined, {
        granularity: "word",
      });

      const fd = captureFormData();
      const granularities = fd.getAll("timestamp_granularities[]");
      expect(granularities).toEqual(["word"]);

      expect(result.status).toBe("completed");
      expect(result.words).toEqual([
        { text: "Hello", start: 0.0, end: 0.6 },
        { text: "world.", start: 0.7, end: 1.5 },
      ]);
      expect(result.segments).toBeUndefined();
    });

    it("accepts language via options", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(wordResponse));

      await provider.transcribe(audio, undefined, {
        language: "en",
        granularity: "word",
      });

      const fd = captureFormData();
      expect(fd.get("language")).toBe("en");
    });
  });

  describe("granularity: both", () => {
    it("sends both granularity values and parses both fields", async () => {
      mockFetch.mockResolvedValueOnce(okResponse(bothResponse));

      const result = await provider.transcribe(audio, undefined, {
        granularity: "both",
      });

      const fd = captureFormData();
      const granularities = fd.getAll("timestamp_granularities[]");
      expect(granularities.sort()).toEqual(["segment", "word"]);

      expect(result.segments).toHaveLength(1);
      expect(result.words).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("returns failed result on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "rate limit exceeded",
      });

      const result = await provider.transcribe(audio);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("rate limit exceeded");
    });

    it("returns failed result on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network down"));

      const result = await provider.transcribe(audio);
      expect(result.status).toBe("failed");
      expect(result.error).toBe("network down");
    });
  });
});
