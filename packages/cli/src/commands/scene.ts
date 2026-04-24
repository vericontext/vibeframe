/**
 * @module scene
 *
 * `vibe scene <sub>` — author, lint, and render per-scene HTML projects that
 * target the Hyperframes render backend. A scene project is bilingual: it's
 * also a valid Hyperframes project (hyperframes.json + meta.json +
 * index.html + compositions/). Users and AI agents can hand-author rich per-
 * scene animation instead of relying on flat YAML steps or opaque MP4s.
 *
 * Subcommands land incrementally across MVP 1:
 *   - init      [C1, this commit] — scaffold project directory
 *   - add       [C2]
 *   - lint      [C3]
 *   - render    [C4]
 */

import { Command } from "commander";
import { basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  scaffoldSceneProject,
  type SceneAspect,
} from "./_shared/scene-project.js";
import { exitWithError, generalError, usageError, outputResult, isJsonMode } from "./output.js";

const VALID_ASPECTS: SceneAspect[] = ["16:9", "9:16", "1:1", "4:5"];

function validateAspect(value: string): SceneAspect {
  if (!VALID_ASPECTS.includes(value as SceneAspect)) {
    exitWithError(usageError(`Invalid aspect ratio: ${value}`, `Valid: ${VALID_ASPECTS.join(", ")}`));
  }
  return value as SceneAspect;
}

function validateDuration(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0 || n > 3600) {
    exitWithError(usageError(`Invalid duration: ${value}`, "Duration must be a positive number of seconds (≤3600)"));
  }
  return n;
}

export const sceneCommand = new Command("scene")
  .description("Author and render per-scene HTML compositions (Hyperframes backend)")
  .addHelpText("after", `
Examples:
  $ vibe scene init my-video                       # Scaffold a new scene project
  $ vibe scene init my-video -r 9:16 -d 30         # Vertical 30s project
  $ vibe scene init existing-hf-project            # Safe — merges with existing hyperframes.json

A scene project is bilingual: it works with both \`vibe\` and \`npx hyperframes\`.
Run 'vibe schema scene.<command>' for structured parameter info.`);

sceneCommand
  .command("init")
  .description("Scaffold a new scene project (or safely augment an existing Hyperframes project)")
  .argument("<dir>", "Project directory (created if it doesn't exist)")
  .option("-n, --name <name>", "Project name (defaults to directory basename)")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, 1:1, 4:5", "16:9")
  .option("-d, --duration <sec>", "Default root composition duration (seconds)", "10")
  .option("--dry-run", "Preview parameters without writing files")
  .action(async (dir: string, options) => {
    const aspect = validateAspect(options.ratio);
    const duration = validateDuration(options.duration);
    const name = (options.name as string | undefined) ?? basename(dir.replace(/\/+$/, ""));

    if (options.dryRun) {
      outputResult({
        dryRun: true,
        command: "scene init",
        params: { dir, name, aspect, duration },
      });
      return;
    }

    const spinner = isJsonMode() ? null : ora(`Scaffolding scene project at ${dir}...`).start();
    try {
      const result = await scaffoldSceneProject({ dir, name, aspect, duration });

      if (isJsonMode()) {
        outputResult({
          success: true,
          command: "scene init",
          dir,
          name,
          aspect,
          duration,
          created: result.created,
          merged: result.merged,
          skipped: result.skipped,
        });
        return;
      }

      spinner?.succeed(chalk.green(`Scene project ready: ${dir}`));
      console.log();
      console.log(chalk.bold.cyan("Files"));
      console.log(chalk.dim("─".repeat(60)));
      for (const f of result.created) console.log(chalk.green("  +"), f);
      for (const f of result.merged)  console.log(chalk.yellow("  ~"), f, chalk.dim("(merged)"));
      for (const f of result.skipped) console.log(chalk.dim("  ·"), f, chalk.dim("(kept existing)"));
      console.log();
      console.log(chalk.bold.cyan("Next steps"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  ${chalk.cyan("vibe scene add")} <name>    ${chalk.dim("# author a scene via AI")}`);
      console.log(`  ${chalk.cyan("vibe scene lint")}          ${chalk.dim("# validate HTML")}`);
      console.log(`  ${chalk.cyan("vibe scene render")}        ${chalk.dim("# render to MP4")}`);
    } catch (error) {
      spinner?.fail("Failed to scaffold scene project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to scaffold: ${msg}`));
    }
  });
