import { describe, expect, it } from "vitest";

import {
  commandPathFromToolName,
  productSurfaceForCommandPath,
  productSurfaceForToolName,
} from "./product-surface.js";

describe("product surface taxonomy", () => {
  it("marks public project-loop commands", () => {
    expect(productSurfaceForCommandPath("init").surface).toBe("public");
    expect(productSurfaceForCommandPath("build").surface).toBe("public");
    expect(productSurfaceForCommandPath("inspect.render").surface).toBe("public");
    expect(productSurfaceForCommandPath("status.project").surface).toBe("public");
  });

  it("marks legacy aliases with replacements", () => {
    expect(productSurfaceForCommandPath("edit.animated-caption")).toMatchObject({
      surface: "legacy",
      replacement: "vibe remix animated-caption",
    });
    expect(productSurfaceForCommandPath("project.create")).toMatchObject({
      surface: "legacy",
      replacement: "vibe timeline create",
    });
  });

  it("no longer carries the eight commands removed in 0.114", () => {
    // Each had a documented replacement and was already hidden from help.
    // The map must not keep describing them, or `schema --list` would
    // advertise a surface the CLI no longer implements.
    for (const path of [
      "generate.speech",
      "generate.background",
      "generate.storyboard",
      "generate.music-status",
      "generate.video-status",
      "inspect.video",
      "inspect.review",
      "remix.regenerate-scene",
    ]) {
      expect(productSurfaceForCommandPath(path).surface).not.toBe("legacy");
    }
  });

  it("maps manifest tool names to command taxonomy", () => {
    expect(commandPathFromToolName("generate_sound_effect")).toBe("generate.sound-effect");
    expect(commandPathFromToolName("scene_compose_prompts")).toBe("scene.compose-prompts");
    expect(productSurfaceForToolName("scene_compose_prompts").surface).toBe("internal");
    expect(productSurfaceForToolName("storyboard_set").surface).toBe("agent");
  });
});
