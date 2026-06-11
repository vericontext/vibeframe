/**
 * @module manifest/walkthrough
 * @description Universal guide primitive — host-agnostic equivalent of
 * Claude Code's `/vibe-scene` and `/vibe-pipeline` slash commands.
 *
 * Any agent host (Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode)
 * can invoke `guide` to load the same step-by-step authoring guide
 * the slash commands deliver. Source content is vendored as TS template
 * literals (see `commands/_shared/walkthroughs/`) so the bundle has zero
 * filesystem dependencies.
 */

import { z } from "zod";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  WALKTHROUGH_TOPICS,
  listWalkthroughs,
  loadWalkthrough,
  type WalkthroughTopic,
} from "../../commands/_shared/walkthroughs/walkthroughs.js";

const guideSchema = z.object({
  topic: z
    .enum(WALKTHROUGH_TOPICS as unknown as [WalkthroughTopic, ...WalkthroughTopic[]])
    .optional()
    .describe(
      "Guide topic to load. Omit to list every available guide — useful for discovery on first contact.",
    ),
});

export const guideTool = defineTool({
  name: "guide",
  category: "agent",
  cost: "free",
  title: "Load Workflow Guide",
  annotations: { readOnly: true, openWorld: false },
  description:
    "Load the step-by-step guide for a vibe workflow (motion overlays, BUILD scene authoring, YAML pipeline authoring, architecture choices). Universal CLI-equivalent of `vibe guide <topic>` and Claude Code's /vibe-* slash commands. Without a topic, returns the guide catalog for discovery.",
  schema: guideSchema,
  async execute(args) {
    if (!args.topic) {
      const topics = listWalkthroughs();
      return {
        success: true,
        data: { action: "list", topics },
        humanLines: [
          `Available guides: ${topics.map((t) => t.topic).join(", ")}.`,
          `Call again with topic to load full content.`,
        ],
      };
    }

    const result = loadWalkthrough(args.topic);
    return {
      success: true,
      data: { action: "show", ...result },
      humanLines: [
        `Loaded guide: ${result.title}.`,
        `${result.steps.length} steps, ${result.relatedCommands.length} related commands, ${result.content.length} chars of guide content.`,
      ],
    };
  },
});

export const guideTools: readonly AnyTool[] = [guideTool as unknown as AnyTool];
