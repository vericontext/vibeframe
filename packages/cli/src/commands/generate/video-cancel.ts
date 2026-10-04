/**
 * @module generate/video-cancel
 * @description `vibe generate video-cancel` (hidden) — cancel an in-flight
 * video job on a provider with a cancel API (Runway, Seedance, Gemini Omni).
 */

import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { executeVideoCancel } from "../ai-video.js";
import { isJsonMode, outputSuccess, exitWithError, providerFailure, usageError } from "../output.js";

const CANCEL_PROVIDERS = ["runway", "seedance", "omni"];

export function registerVideoCancelCommand(parent: Command): void {
  parent
    .command("video-cancel", { hidden: true })
    .description("Cancel video generation (Runway, Seedance, Gemini Omni)")
    .argument("<task-id>", "Task ID to cancel")
    .option("-p, --provider <provider>", `Provider: ${CANCEL_PROVIDERS.join(", ")}`, "runway")
    .option("-k, --api-key <key>", "API key for the provider")
    .action(async (taskId: string, options) => {
      const startedAt = Date.now();
      const provider = String(options.provider || "runway").toLowerCase();
      if (!CANCEL_PROVIDERS.includes(provider)) {
        exitWithError(
          usageError(
            `${provider} has no cancel API. Video cancel supports: ${CANCEL_PROVIDERS.join(", ")}.`,
            "Kling and Grok jobs run to completion once accepted."
          )
        );
      }
      const spinner = isJsonMode() ? null : ora("Cancelling generation...").start();
      const result = await executeVideoCancel({ taskId, provider, apiKey: options.apiKey });
      if (!result.success) {
        spinner?.fail("Failed to cancel generation");
        exitWithError(providerFailure(result.error ?? "Cancel failed", result.errorKind));
      }
      spinner?.succeed(chalk.green("Generation cancelled"));
      if (isJsonMode()) {
        outputSuccess({ command: "generate video-cancel", startedAt, data: { taskId, provider, cancelled: true } });
      }
    });
}
