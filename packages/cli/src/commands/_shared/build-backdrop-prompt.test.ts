import { describe, expect, it } from "vitest";

import { augmentBackdropPrompt } from "./build-backdrop-prompt.js";

describe("augmentBackdropPrompt", () => {
  it("treats normal storyboard backdrops as text-free background plates", () => {
    const prompt = augmentBackdropPrompt("AI benchmark dashboard with charts");

    expect(prompt).toContain("background plate");
    expect(prompt).toContain("HTML overlays will provide all final text");
    expect(prompt).toContain("No readable text");
    expect(prompt).toContain("shoes");
    expect(prompt).toContain("unrelated consumer product photography");
  });

  it("allows requested logos while still preventing invented extras", () => {
    const prompt = augmentBackdropPrompt("Minimal end card with OpenAI and Anthropic logos");

    expect(prompt).toContain("logos");
    expect(prompt).toContain("do not invent extras");
    expect(prompt).toContain("beyond what the scene cue explicitly requests");
    expect(prompt).not.toContain("HTML overlays will provide all final text");
    expect(prompt).not.toContain("No readable text");
  });

  it("does not treat negative text/logo constraints as permission", () => {
    const prompt = augmentBackdropPrompt("Editorial background plate, no readable text, no logos");

    expect(prompt).toContain("No readable text");
    expect(prompt).not.toContain("do not invent extras");
  });
});
