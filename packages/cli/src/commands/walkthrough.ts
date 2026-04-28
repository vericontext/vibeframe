/**
 * @module commands/walkthrough
 *
 * `vibe walkthrough [topic]` — universal CLI equivalent of Claude Code's
 * `/vibe-scene` and `/vibe-pipeline` slash commands. Any host agent
 * (Claude Code, Codex, Cursor, Aider, Gemini CLI, OpenCode) can invoke
 * this to load the same step-by-step authoring guide the slash commands
 * deliver in Claude Code — closes the last Claude-Code-only gap on top
 * of Plan H's universal skill / compose primitives.
 *
 * Without arguments, lists available topics. With a topic, emits the
 * full markdown body + structured metadata. `--json` returns the
 * structured shape from `loadWalkthrough()` directly.
 */

import { Command } from "commander";
import chalk from "chalk";

import {
  WALKTHROUGH_TOPICS,
  isWalkthroughTopic,
  listWalkthroughs,
  loadWalkthrough,
  type WalkthroughTopic,
} from "./_shared/walkthroughs/walkthroughs.js";
import { exitWithError, isJsonMode, outputResult, usageError } from "./output.js";

export const walkthroughCommand = new Command("walkthrough")
  .description("Step-by-step authoring guide for a vibe workflow (universal /vibe-* slash-command equivalent)")
  .argument("[topic]", `Walkthrough topic: ${WALKTHROUGH_TOPICS.join(" | ")}. Omit to list all.`)
  .option("--list", "List available walkthroughs and exit")
  .action(async (topicArg: string | undefined, options) => {
    if (!topicArg || options.list) {
      const topics = listWalkthroughs();

      if (isJsonMode()) {
        outputResult({
          command: "walkthrough",
          action: "list",
          topics,
        });
        return;
      }

      console.log();
      console.log(chalk.bold.cyan("Available walkthroughs"));
      console.log(chalk.dim("─".repeat(60)));
      for (const t of topics) {
        console.log(`  ${chalk.bold(t.topic.padEnd(10))} ${chalk.dim(t.summary)}`);
      }
      console.log();
      console.log(chalk.dim("Run `vibe walkthrough <topic>` for the full guide."));
      console.log(chalk.dim("Add `--json` to get structured output for an agent host."));
      console.log();
      return;
    }

    if (!isWalkthroughTopic(topicArg)) {
      exitWithError(usageError(
        `Unknown walkthrough topic: ${topicArg}`,
        `Valid topics: ${WALKTHROUGH_TOPICS.join(", ")}`,
      ));
    }

    const topic = topicArg as WalkthroughTopic;
    const result = loadWalkthrough(topic);

    if (isJsonMode()) {
      outputResult({
        command: "walkthrough",
        action: "show",
        ...result,
      });
      return;
    }

    // Human render: title + steps + content.
    console.log();
    console.log(chalk.bold.cyan(result.title));
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.dim(result.summary));
    console.log();

    console.log(chalk.bold("Quick steps"));
    console.log(chalk.dim("─".repeat(60)));
    for (let i = 0; i < result.steps.length; i++) {
      console.log(`  ${chalk.cyan(`${i + 1}.`)} ${result.steps[i]}`);
    }
    console.log();

    console.log(chalk.bold("Related commands"));
    console.log(chalk.dim("─".repeat(60)));
    for (const cmd of result.relatedCommands) {
      console.log(`  ${chalk.cyan(cmd)}`);
    }
    console.log();

    console.log(chalk.bold("Full guide"));
    console.log(chalk.dim("─".repeat(60)));
    console.log();
    console.log(result.content);
    console.log();
  });
