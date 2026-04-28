/**
 * @module generate/video-cancel
 * @description `vibe generate video-cancel` (hidden) — cancel in-flight Grok
 * or Runway video generation. Split out of `generate.ts` in v0.69 (Plan G
 * Phase 2).
 */

import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { GrokProvider, RunwayProvider } from "@vibeframe/ai-providers";
import { requireApiKey } from "../../utils/api-key.js";
import {
  isJsonMode,
  outputSuccess,
  exitWithError,
  apiError,
  usageError,
} from "../output.js";

export function registerVideoCancelCommand(parent: Command): void {
  parent
    .command("video-cancel", { hidden: true })
    .description("Cancel video generation (Grok or Runway)")
    .argument("<task-id>", "Task ID to cancel")
    .option("-p, --provider <provider>", "Provider: grok, runway", "grok")
    .option("-k, --api-key <key>", "API key (or set XAI_API_KEY / RUNWAY_API_SECRET env)")
    .action(async (taskId: string, options) => {
      const startedAt = Date.now();
      try {
        const provider = (options.provider || "grok").toLowerCase();

        let success = false;

        if (provider === "grok") {
          const apiKey = await requireApiKey("XAI_API_KEY", "xAI", options.apiKey);

          const spinner = ora("Cancelling generation...").start();
          const grok = new GrokProvider();
          await grok.initialize({ apiKey });
          success = await grok.cancelGeneration(taskId);

          if (success) {
            spinner.succeed(chalk.green("Generation cancelled"));
            if (isJsonMode()) {
              outputSuccess({
                command: "generate video-cancel",
                startedAt,
                data: { taskId, provider: "grok", cancelled: true },
              });
              return;
            }
          } else {
            spinner.fail("Failed to cancel generation");
            exitWithError(apiError("Failed to cancel generation", true));
          }
        } else if (provider === "runway") {
          const apiKey = await requireApiKey(
            "RUNWAY_API_SECRET",
            "Runway",
            options.apiKey,
          );

          const spinner = ora("Cancelling generation...").start();
          const runway = new RunwayProvider();
          await runway.initialize({ apiKey });
          success = await runway.cancelGeneration(taskId);

          if (success) {
            spinner.succeed(chalk.green("Generation cancelled"));
            if (isJsonMode()) {
              outputSuccess({
                command: "generate video-cancel",
                startedAt,
                data: { taskId, provider: "runway", cancelled: true },
              });
              return;
            }
          } else {
            spinner.fail("Failed to cancel generation");
            exitWithError(apiError("Failed to cancel generation", true));
          }
        } else {
          exitWithError(usageError(`Invalid provider: ${provider}. Use grok or runway.`));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        exitWithError(apiError(`Failed to cancel: ${msg}`, true));
      }
    });
}
