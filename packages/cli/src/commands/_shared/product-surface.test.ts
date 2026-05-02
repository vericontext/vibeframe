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
    expect(productSurfaceForCommandPath("generate.speech")).toMatchObject({
      surface: "legacy",
      replacement: "vibe generate narration",
    });
    expect(productSurfaceForCommandPath("inspect.video")).toMatchObject({
      surface: "legacy",
      replacement: "vibe inspect media",
    });
    expect(productSurfaceForCommandPath("remix.regenerate-scene")).toMatchObject({
      surface: "legacy",
      replacement: "vibe build <project> --beat <id> --force --json",
    });
  });

  it("maps manifest tool names to command taxonomy", () => {
    expect(commandPathFromToolName("generate_sound_effect")).toBe("generate.sound-effect");
    expect(commandPathFromToolName("scene_compose_prompts")).toBe("scene.compose-prompts");
    expect(productSurfaceForToolName("scene_compose_prompts").surface).toBe("internal");
    expect(productSurfaceForToolName("storyboard_set").surface).toBe("agent");
  });
});
