/**
 * Motion `--model` choices come from one list, and every advertised choice
 * resolves to a model the provider still serves to new projects. An alias
 * nobody knows used to fall back to Claude Sonnet silently, so a typo such
 * as `-m gemini-2.5` ran a paid request on a model nobody chose.
 */

import { describe, expect, it } from "vitest";

import { findModel } from "@vibeframe/ai-providers";
import { MOTION_MODEL_CHOICES, resolveMotionModel } from "./ai-motion.js";
import { InputError } from "./validate.js";
import { generateMotionTool } from "../tools/manifest/generate.js";
import { editMotionOverlayTool } from "../tools/manifest/edit.js";

describe("motion model choices", () => {
  it.each(MOTION_MODEL_CHOICES)("%s resolves to a GA or preview model", (choice) => {
    const { provider, modelId } = resolveMotionModel(choice);
    const spec = findModel(provider, "llm", modelId);
    expect(spec?.status === "ga" || spec?.status === "preview").toBe(true);
  });

  it("an unknown alias is a usage error, not a silent Claude fallback", () => {
    expect(() => resolveMotionModel("gemini-2.5")).toThrow(InputError);
  });

  it("other catalog aliases still resolve", () => {
    expect(resolveMotionModel("argon")).toEqual({ provider: "gemini", modelId: "gemini-4-argon" });
    expect(resolveMotionModel("haiku").provider).toBe("claude");
  });

  it("the MCP tools offer exactly the advertised choices", () => {
    for (const tool of [generateMotionTool, editMotionOverlayTool]) {
      const model = tool.schema.shape.model;
      expect(model.safeParse("gemini").success).toBe(true);
      expect(model.safeParse("gemini-2.5-pro").success).toBe(false);
    }
  });
});
