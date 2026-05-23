import { describe, expect, it } from "vitest";

import {
  GEMINI_AGENT_DEFAULT_TEXT_MODEL,
  GEMINI_DEFAULT_TEXT_MODEL,
  resolveGeminiTextModel,
} from "./gemini-models.js";

describe("Gemini text model aliases", () => {
  it("defaults one-shot calls to Gemini 3.5 Flash", () => {
    expect(GEMINI_DEFAULT_TEXT_MODEL).toBe("gemini-3.5-flash");
    expect(resolveGeminiTextModel()).toBe("gemini-3.5-flash");
    expect(resolveGeminiTextModel("flash")).toBe("gemini-3.5-flash");
    expect(resolveGeminiTextModel("latest")).toBe("gemini-3.5-flash");
    expect(resolveGeminiTextModel("flash-3.5")).toBe("gemini-3.5-flash");
    expect(resolveGeminiTextModel("flash-3")).toBe("gemini-3-flash-preview");
  });

  it("keeps the agent loop default separate", () => {
    expect(GEMINI_AGENT_DEFAULT_TEXT_MODEL).toBe("gemini-2.5-flash");
  });

  it("resolves legacy and pro aliases", () => {
    expect(resolveGeminiTextModel("flash-2.5")).toBe("gemini-2.5-flash");
    expect(resolveGeminiTextModel("pro")).toBe("gemini-2.5-pro");
    expect(resolveGeminiTextModel("pro-3.1")).toBe("gemini-3.1-pro-preview");
  });

  it("passes through explicit gemini model IDs", () => {
    expect(resolveGeminiTextModel("gemini-2.5-flash-lite")).toBe("gemini-2.5-flash-lite");
  });

  it("falls back to the safe default for unknown aliases", () => {
    expect(resolveGeminiTextModel("unknown")).toBe("gemini-3.5-flash");
  });
});
