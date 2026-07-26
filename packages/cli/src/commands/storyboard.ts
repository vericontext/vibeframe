import { Command } from "commander";
import chalk from "chalk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseStoryboard } from "./_shared/storyboard-parse.js";
import {
  getStoryboardBeat,
  moveStoryboardBeat,
  setStoryboardCue,
  STORYBOARD_CUE_KEYS,
  validateStoryboardMarkdown,
} from "./_shared/storyboard-edit.js";
import { loadStoryboard, planMigration } from "./_shared/storyboard-source.js";
import {
  executeStoryboardRevision,
  type StoryboardRevisionResult,
} from "./_shared/storyboard-revise.js";
import { isComposerProvider, type ComposerProvider } from "./_shared/composer-resolve.js";
import { applyTiers } from "./_shared/cost-tier.js";
import { exitWithError, generalError, isJsonMode, outputSuccess, usageError } from "./output.js";

export const storyboardCommand = new Command("storyboard")
  .description("Read, validate, and safely mutate STORYBOARD.md cue blocks")
  .addHelpText("after", `
Examples:
  $ vibe storyboard validate my-video --json
  $ vibe storyboard list my-video --json
  $ vibe storyboard get my-video hook --json
  $ vibe storyboard set my-video hook narration "A sharper opening line." --json
  $ vibe storyboard set my-video hook duration 4.5 --json
  $ vibe storyboard move my-video close --after proof --json
`);

storyboardCommand
  .command("list")
  .description("List beats, ids, cues, and durations from STORYBOARD.md")
  .argument("[project-dir]", "Project directory", ".")
  .action(async (projectDirArg: string) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const md = await readStoryboard(projectDir);
    const parsed = parseStoryboard(md);
    const data = {
      projectDir,
      beats: parsed.beats.map((beat) => ({
        id: beat.id,
        heading: beat.heading,
        durationSec: beat.duration ?? null,
        cues: beat.cues ?? {},
      })),
    };
    if (isJsonMode()) {
      outputSuccess({ command: "storyboard list", startedAt, data });
      return;
    }
    for (const beat of data.beats) {
      console.log(`${chalk.bold(beat.id.padEnd(12))} ${beat.durationSec ?? "-"}s  ${beat.heading}`);
    }
  });

storyboardCommand
  .command("get")
  .description("Print one beat as structured JSON")
  .argument("<project-dir>", "Project directory")
  .argument("<beat>", "Beat id")
  .action(async (projectDirArg: string, beatId: string) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const md = await readStoryboard(projectDir);
    const beat = getStoryboardBeat(md, beatId);
    if (!beat) {
      exitWithError(usageError(`Beat not found: ${beatId}`, `Run 'vibe storyboard list ${projectDirArg} --json' to see available beat ids.`));
    }
    outputSuccess({
      command: "storyboard get",
      startedAt,
      data: {
        projectDir,
        beat: {
          id: beat.id,
          heading: beat.heading,
          durationSec: beat.duration ?? null,
          cues: beat.cues ?? {},
          body: beat.body,
        },
      },
    });
  });

storyboardCommand
  .command("set")
  .description("Update one cue in one beat without raw Markdown editing")
  .argument("<project-dir>", "Project directory")
  .argument("<beat>", "Beat id")
  .argument("<key>", `Cue key: ${STORYBOARD_CUE_KEYS.join(" | ")}`)
  .argument("[value...]", "Cue value. Use --json-value to pass a JSON scalar/object.")
  .option("--json-value", "Parse value as JSON instead of a string")
  .option("--unset", "Remove the cue key from the beat")
  .action(async (projectDirArg: string, beatId: string, key: string, valueParts: string[] | undefined, options: { jsonValue?: boolean; unset?: boolean }) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    if (!options.unset && (!valueParts || valueParts.length === 0)) {
      exitWithError(usageError("Cue value is required unless --unset is passed."));
    }
    const md = await readStoryboard(projectDir);
    let value: unknown = valueParts?.join(" ") ?? "";
    if (options.jsonValue && !options.unset) {
      try {
        value = JSON.parse(String(value));
      } catch (error) {
        exitWithError(usageError(`Invalid JSON cue value: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    await refuseWriteOnBundle(projectDir, "set");
    let next: string;
    try {
      next = setStoryboardCue(md, { beatId, key, value, unset: options.unset });
    } catch (error) {
      exitWithError(usageError(error instanceof Error ? error.message : String(error)));
    }
    await writeFile(storyboardPath(projectDir), next, "utf-8");
    const beat = getStoryboardBeat(next, beatId);
    outputSuccess({
      command: "storyboard set",
      startedAt,
      data: {
        projectDir,
        beatId,
        key,
        unset: options.unset ?? false,
        cues: beat?.cues ?? {},
      },
    });
  });

storyboardCommand
  .command("move")
  .description("Reorder beats safely")
  .argument("<project-dir>", "Project directory")
  .argument("<beat>", "Beat id to move")
  .requiredOption("--after <beat>", "Place the beat after this beat id")
  .action(async (projectDirArg: string, beatId: string, options: { after: string }) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const md = await readStoryboard(projectDir);
    await refuseWriteOnBundle(projectDir, "move");
    let next: string;
    try {
      next = moveStoryboardBeat(md, { beatId, afterBeatId: options.after });
    } catch (error) {
      exitWithError(usageError(error instanceof Error ? error.message : String(error)));
    }
    await writeFile(storyboardPath(projectDir), next, "utf-8");
    const parsed = parseStoryboard(next);
    outputSuccess({
      command: "storyboard move",
      startedAt,
      data: {
        projectDir,
        beatId,
        after: options.after,
        order: parsed.beats.map((beat) => beat.id),
      },
    });
  });

storyboardCommand
  .command("revise")
  .description("Revise STORYBOARD.md from a request or source file")
  .argument("<project-dir>", "Project directory")
  .requiredOption("--from <brief>", "Revision request or path to a text/markdown file")
  .option("-d, --duration <sec>", "Target total duration in seconds")
  .option("--composer <provider>", "Revision LLM provider: claude|openai|gemini")
  .option("--dry-run", "Preview the revised storyboard without writing")
  .action(async (projectDirArg: string, options: { from: string; duration?: string; composer?: string; dryRun?: boolean }) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const brief = await readBrief(options.from, process.cwd());
    const duration = options.duration ? Number.parseFloat(options.duration) : undefined;
    if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
      exitWithError(usageError(`Invalid --duration: ${options.duration}`, "Duration must be a positive number of seconds."));
    }
    const composer = parseComposer(options.composer);
    const result = await executeStoryboardRevision({
      projectDir,
      request: brief,
      durationSec: duration,
      composer,
      dryRun: options.dryRun ?? false,
    });
    if (!result.success && !isJsonMode()) {
      exitWithError(generalError(result.message ?? "Storyboard revision failed", result.suggestion));
    }

    outputSuccess({
      command: "storyboard revise",
      startedAt,
      dryRun: options.dryRun ?? false,
      warnings: result.warnings,
      data: result as unknown as Record<string, unknown>,
    });
    if (!result.success) {
      process.exitCode = 1;
      return;
    }
    if (!isJsonMode()) printRevisionResult(result);
  });

storyboardCommand
  .command("migrate")
  .description("Convert a single STORYBOARD.md into a scenes/ bundle (one file per scene)")
  .argument("[project-dir]", "Project directory", ".")
  .option("--dry-run", "Show the files that would be written without touching disk")
  .action(async (projectDirArg: string, options: { dryRun?: boolean }) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const loaded = await loadStoryboard(projectDir);

    if (loaded.layout === "missing") {
      exitWithError(
        generalError(
          `No storyboard found in ${projectDir}`,
          `Run 'vibe init ${projectDir} --from "<brief>"' first.`
        )
      );
    }
    if (loaded.layout === "bundle") {
      exitWithError(
        generalError(
          `${projectDir} is already a scenes/ bundle.`,
          `It has ${loaded.scenes.length} scene file(s); nothing to migrate.`
        )
      );
    }

    const plan = planMigration(loaded.markdown);
    if (plan.scenes.length === 0) {
      exitWithError(
        generalError(
          "STORYBOARD.md has no beats to migrate.",
          "Add at least one `## Beat <id> - <Title>` section first."
        )
      );
    }

    if (!options.dryRun) {
      await mkdir(join(projectDir, "scenes"), { recursive: true });
      for (const file of plan.scenes) {
        await writeFile(join(projectDir, file.path), file.contents, "utf-8");
      }
      // STORYBOARD.md is rewritten last: if a scene write fails, the original
      // single-file storyboard is still the source of truth on disk.
      await writeFile(join(projectDir, plan.storyboard.path), plan.storyboard.contents, "utf-8");
    }

    if (isJsonMode()) {
      outputSuccess({
        command: "storyboard migrate",
        startedAt,
        data: {
          projectDir,
          dryRun: !!options.dryRun,
          beats: plan.beatIds,
          written: [plan.storyboard.path, ...plan.scenes.map((f) => f.path)],
        },
      });
      return;
    }
    const verb = options.dryRun ? "Would write" : "Wrote";
    console.log(`${verb} ${plan.scenes.length} scene file(s):`);
    for (const file of plan.scenes) console.log(`  ${file.path}`);
    console.log(`${verb} ${plan.storyboard.path} (project frontmatter + direction only)`);
    if (options.dryRun) console.log("\nRe-run without --dry-run to apply.");
  });

storyboardCommand
  .command("validate")
  .description("Validate cue blocks and beat ids")
  .argument("[project-dir]", "Project directory", ".")
  .action(async (projectDirArg: string) => {
    const startedAt = Date.now();
    const projectDir = resolve(projectDirArg);
    const md = await readStoryboard(projectDir);
    const result = validateStoryboardMarkdown(md);
    if (isJsonMode()) {
      outputSuccess({
        command: "storyboard validate",
        startedAt,
        data: {
          projectDir,
          ok: result.ok,
          beats: result.beats.map((beat) => ({
            id: beat.id,
            heading: beat.heading,
            durationSec: beat.duration ?? null,
            cues: beat.cues ?? {},
          })),
          issues: result.issues,
        },
      });
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (result.ok) {
      console.log(chalk.green(`Storyboard valid — ${result.beats.length} beat(s)`));
    } else {
      console.log(chalk.red(`Storyboard invalid — ${result.issues.filter((issue) => issue.severity === "error").length} error(s)`));
    }
    for (const issue of result.issues) {
      const color = issue.severity === "error" ? chalk.red : chalk.yellow;
      console.log(color(`[${issue.severity}] ${issue.code}${issue.beatId ? ` ${issue.beatId}` : ""}: ${issue.message}`));
    }
    if (!result.ok) process.exitCode = 1;
  });

async function readStoryboard(projectDir: string): Promise<string> {
  const loaded = await loadStoryboard(projectDir);
  if (loaded.layout === "missing") {
    exitWithError(
      generalError(
        `No storyboard found in ${projectDir}`,
        `Run 'vibe init ${projectDir} --from "<brief>"' first.`
      )
    );
  }
  return loaded.markdown;
}

/**
 * Read-modify-write commands rewrite the whole document. In the bundle
 * layout that document is assembled from `scenes/*.md`, so writing it back
 * to STORYBOARD.md would silently collapse the split. Refuse instead of
 * destroying the project, and name the per-file edit as the way forward.
 */
async function refuseWriteOnBundle(projectDir: string, command: string): Promise<void> {
  const { layout, scenes } = await loadStoryboard(projectDir);
  if (layout !== "bundle") return;
  exitWithError(
    generalError(
      `\`vibe storyboard ${command}\` cannot write to a scenes/ bundle yet.`,
      `Edit the scene file directly - this project has ${scenes.length} under ${projectDir}/scenes/.`
    )
  );
}

function storyboardPath(projectDir: string): string {
  return resolve(projectDir, "STORYBOARD.md");
}

function parseComposer(value: string | undefined): ComposerProvider | undefined {
  if (value === undefined) return undefined;
  if (isComposerProvider(value)) return value;
  exitWithError(usageError(`Invalid --composer: ${value}`, "Must be one of: claude, openai, gemini"));
}

async function readBrief(value: string, cwd: string): Promise<string> {
  const candidate = resolve(cwd, value);
  if (existsSync(candidate)) {
    return readFile(candidate, "utf-8");
  }
  return value;
}

function printRevisionResult(result: StoryboardRevisionResult): void {
  console.log();
  console.log(chalk.bold.cyan("Storyboard Revision"));
  console.log(chalk.dim("-".repeat(60)));
  console.log(`  Project:       ${result.projectDir}`);
  console.log(`  Provider:      ${result.provider ?? "unknown"}`);
  console.log(`  Status:        ${result.success ? chalk.green("ok") : chalk.red("failed")}`);
  console.log(`  Wrote:         ${result.wrote ? "yes" : "no"}`);
  if (result.changedBeats.length > 0) console.log(`  Changed beats: ${result.changedBeats.join(", ")}`);
  if (result.summary) console.log(`  Summary:       ${result.summary}`);
  if (result.storyboard) {
    console.log();
    console.log(result.storyboard);
  }
}

applyTiers(storyboardCommand, {
  list: "free",
  get: "free",
  set: "free",
  move: "free",
  revise: "low",
  validate: "free",
  migrate: "free",
});
