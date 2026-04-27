/**
 * @module manifest/scene
 * @description Scene authoring tools (scene_init/add/lint/render/build/styles).
 * v0.65 migration is incremental: only the entries listed in `MIGRATED`
 * (define-tool.ts) are sourced from the manifest; the rest still come from
 * `packages/cli/src/agent/tools/scene.ts` and
 * `packages/mcp-server/src/tools/scene.ts`.
 */

import { z } from "zod";
import { defineTool } from "../define-tool.js";
import {
  listVisualStyles,
  getVisualStyle,
} from "../../commands/_shared/visual-styles.js";

const sceneStylesSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      "Style name or slug (e.g. 'Swiss Pulse', 'swiss-pulse'). Omit to list all 8.",
    ),
});

export const sceneStylesTool = defineTool({
  name: "scene_styles",
  category: "scene",
  cost: "free",
  description:
    "List the 8 vendored visual identities available for `scene_init --visual-style` (Swiss Pulse, Data Drift, …) or, when `name` is provided, return the full DESIGN.md hard-gate body for one style. The DESIGN.md content is what the LLM uses as a non-negotiable visual rulebook during compose-scenes-with-skills.",
  schema: sceneStylesSchema,
  async execute(args) {
    if (args.name) {
      const style = getVisualStyle(args.name);
      if (!style) {
        return {
          success: false,
          error: `Unknown visual style "${args.name}". Run scene_styles with no name to list all 8.`,
        };
      }
      return {
        success: true,
        data: { style },
        humanLines: [
          `🎨 ${style.name} (${style.slug})`,
          `   designer: ${style.designer}`,
          `   mood:     ${style.mood}`,
          `   bestFor:  ${style.bestFor}`,
          `   palette:  ${style.palette.join(", ")} — ${style.paletteNotes}`,
          `   typography: ${style.typography}`,
          `   composition: ${style.composition}`,
          `   motion:      ${style.motion}`,
          `   transition:  ${style.transition}`,
          `   gsap:        ${style.gsapSignature}`,
          `   avoid:       ${style.avoid.join(" · ")}`,
        ],
      };
    }

    const styles = listVisualStyles();
    return {
      success: true,
      data: {
        count: styles.length,
        styles: styles.map((s) => ({
          slug: s.slug,
          name: s.name,
          designer: s.designer,
          mood: s.mood,
          bestFor: s.bestFor,
        })),
      },
      humanLines: [
        `📚 ${styles.length} vendored visual identities:`,
        ...styles.map(
          (s) => `   • ${s.name} (${s.slug}) — ${s.mood}; best for ${s.bestFor}`,
        ),
        ``,
        `Run scene_styles { name: "<slug>" } to fetch the full DESIGN.md hard-gate body for one style.`,
      ],
    };
  },
});

import type { AnyTool } from "../define-tool.js";

/** All scene-category manifest entries (type-erased for heterogeneous aggregation). */
export const sceneTools: readonly AnyTool[] = [sceneStylesTool as unknown as AnyTool];
