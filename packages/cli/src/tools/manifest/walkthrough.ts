/**
 * @module manifest/walkthrough
 * @description Universal walkthrough primitive — host-agnostic equivalent of
 * Claude Code's `/vibe-scene` and `/vibe-pipeline` slash commands.
 *
 * Any agent host (Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode)
 * can invoke `walkthrough` to load the same step-by-step authoring guide
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

const walkthroughSchema = z.object({
  topic: z
    .enum(WALKTHROUGH_TOPICS as unknown as [WalkthroughTopic, ...WalkthroughTopic[]])
    .optional()
    .describe(
      "Walkthrough topic to load. Omit to list every available walkthrough — useful for discovery on first contact.",
    ),
});

export const walkthroughTool = defineTool({
  name: "walkthrough",
  category: "agent",
  cost: "free",
  description:
    "Load the step-by-step authoring guide for a vibe workflow (BUILD scene authoring, YAML pipeline authoring). Universal CLI-equivalent of Claude Code's /vibe-* slash commands — any host agent that calls this tool gets the same content the slash menu delivers in Claude Code, with no Claude Code dependency. Without a topic, returns the catalog of walkthroughs for discovery.",
  schema: walkthroughSchema,
  async execute(args) {
    if (!args.topic) {
      const topics = listWalkthroughs();
      return {
        success: true,
        data: { action: "list", topics },
        humanLines: [
          `Available walkthroughs: ${topics.map((t) => t.topic).join(", ")}.`,
          `Call again with topic to load full content.`,
        ],
      };
    }

    const result = loadWalkthrough(args.topic);
    return {
      success: true,
      data: { action: "show", ...result },
      humanLines: [
        `Loaded walkthrough: ${result.title}.`,
        `${result.steps.length} steps, ${result.relatedCommands.length} related commands, ${result.content.length} chars of guide content.`,
      ],
    };
  },
});

export const walkthroughTools: readonly AnyTool[] = [walkthroughTool as unknown as AnyTool];
