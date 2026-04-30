/**
 * @module _shared/timeline-project
 *
 * Shared action logic for `vibe timeline create/info/set` (and the
 * deprecated `vibe project create/info/set` alias). Extracted so both
 * surfaces call the same code path — the only difference is which
 * default filename `create` writes to:
 *
 * - `vibe timeline create` → `timeline.json` (canonical)
 * - `vibe project create`  → `project.vibe.json` (legacy, deprecated)
 *
 * Read-side commands (`info`, `set`) use `resolveTimelineFile` which
 * accepts both filenames. Existing `*.vibe.json` files keep working
 * forever; only the on-disk filename for *new* creates differs.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import type { AspectRatio } from "@vibeframe/core/timeline";

import { Project, type ProjectFile } from "../../engine/index.js";
import {
  resolveTimelineFile,
  detectSceneProject,
  TIMELINE_FILENAME,
  LEGACY_TIMELINE_FILENAME,
} from "../../utils/project-resolver.js";
import {
  exitWithError,
  generalError,
  isJsonMode,
  outputSuccess,
  usageError,
} from "../output.js";
import { validateOutputPath } from "../validate.js";

// Re-export filename constants so callers can pin to legacy default if
// they need to (deprecated `vibe project create` does this).
export { TIMELINE_FILENAME, LEGACY_TIMELINE_FILENAME };

export interface TimelineCreateOptions {
  output?: string;
  ratio?: string;
  fps?: string;
  dryRun?: boolean;
}

export interface TimelineSetOptions {
  name?: string;
  ratio?: string;
  fps?: string;
  dryRun?: boolean;
}

/** Format duration as `M:SS.s` */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}

/**
 * Load a timeline project, with a useful error when the user passed a
 * scene-project directory by mistake. Caller still handles `readFile`
 * errors for non-scene cases (corrupt JSON, file missing without yaml).
 */
async function loadProject(inputPath: string): Promise<{ filePath: string; project: Project }> {
  const filePath = await resolveTimelineFile(inputPath);
  try {
    const content = await readFile(filePath, "utf-8");
    const data: ProjectFile = JSON.parse(content);
    return { filePath, project: Project.fromJSON(data) };
  } catch (err) {
    // File not found — was the input a directory that's actually a
    // scene project? Give a useful hint instead of "ENOENT".
    const inputAbs = resolve(process.cwd(), inputPath);
    try {
      const stats = await stat(inputAbs);
      if (stats.isDirectory() && (await detectSceneProject(inputAbs))) {
        exitWithError(
          usageError(
            `Found vibe.project.yaml — '${inputPath}' is a scene project, not a timeline.`,
            "Use 'vibe build <dir>' / 'vibe render <dir>', or 'vibe doctor' for status. 'vibe timeline' operates on timeline.json (or legacy *.vibe.json) only.",
          ),
        );
      }
    } catch {
      // stat failed too — just propagate the original error
    }
    throw err;
  }
}

export async function executeTimelineCreate(
  name: string,
  options: TimelineCreateOptions,
  commandName: string,
  startedAt: number,
  defaultFilename: string = TIMELINE_FILENAME,
  createDirectoryByDefault: boolean = true,
): Promise<void> {
  const spinner = ora("Creating timeline...").start();

  try {
    if (options.output) {
      validateOutputPath(options.output);
    }

    if (options.dryRun) {
      spinner.stop();
      outputSuccess({
        command: commandName,
        startedAt,
        dryRun: true,
        data: {
          params: {
            name,
            output: options.output || null,
            aspectRatio: options.ratio,
            frameRate: options.fps,
          },
        },
      });
      return;
    }

    const resolvedNamePath = resolve(process.cwd(), name);
    const projectName = name === "." ? basename(process.cwd()) : basename(resolvedNamePath);
    const project = new Project(projectName);
    project.setAspectRatio((options.ratio ?? "16:9") as AspectRatio);
    project.setFrameRate(parseInt(options.fps ?? "30", 10));

    let outputPath: string;
    if (options.output) {
      outputPath = resolve(process.cwd(), options.output);
    } else if (createDirectoryByDefault || name.includes("/") || name === ".") {
      // Name contains path — create directory and put default file inside
      const dirPath = resolvedNamePath;
      await mkdir(dirPath, { recursive: true });
      outputPath = resolve(dirPath, defaultFilename);
    } else {
      outputPath = resolve(process.cwd(), defaultFilename);
    }

    const data = JSON.stringify(project.toJSON(), null, 2);
    await writeFile(outputPath, data, "utf-8");

    spinner.succeed(chalk.green(`Timeline created: ${outputPath}`));

    if (isJsonMode()) {
      outputSuccess({
        command: commandName,
        startedAt,
        data: {
          outputPath,
          name: projectName,
          aspectRatio: options.ratio ?? "16:9",
          frameRate: parseInt(options.fps ?? "30", 10),
        },
      });
      return;
    }

    console.log();
    console.log(chalk.dim("  Name:"), projectName);
    console.log(chalk.dim("  Aspect Ratio:"), options.ratio ?? "16:9");
    console.log(chalk.dim("  Frame Rate:"), options.fps ?? "30", "fps");
  } catch (error) {
    spinner.fail("Failed to create timeline");
    const msg = error instanceof Error ? error.message : String(error);
    exitWithError(generalError(`Failed to create timeline: ${msg}`));
  }
}

export async function executeTimelineInfo(
  file: string,
  commandName: string,
  startedAt: number,
): Promise<void> {
  const spinner = ora("Loading timeline...").start();

  try {
    const { project } = await loadProject(file);
    spinner.stop();

    const summary = project.getSummary();
    const meta = project.getMeta();

    if (isJsonMode()) {
      outputSuccess({
        command: commandName,
        startedAt,
        data: {
          name: summary.name,
          duration: summary.duration,
          aspectRatio: summary.aspectRatio,
          frameRate: summary.frameRate,
          trackCount: summary.trackCount,
          clipCount: summary.clipCount,
          sourceCount: summary.sourceCount,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        },
      });
      return;
    }

    console.log();
    console.log(chalk.bold.cyan("Timeline Info"));
    console.log(chalk.dim("─".repeat(40)));
    console.log(chalk.dim("  Name:"), summary.name);
    console.log(chalk.dim("  Duration:"), formatDuration(summary.duration));
    console.log(chalk.dim("  Aspect Ratio:"), summary.aspectRatio);
    console.log(chalk.dim("  Frame Rate:"), summary.frameRate, "fps");
    console.log();
    console.log(chalk.dim("  Tracks:"), summary.trackCount);
    console.log(chalk.dim("  Clips:"), summary.clipCount);
    console.log(chalk.dim("  Sources:"), summary.sourceCount);
    console.log();
    console.log(chalk.dim("  Created:"), meta.createdAt.toLocaleString());
    console.log(chalk.dim("  Updated:"), meta.updatedAt.toLocaleString());
    console.log();
  } catch (error) {
    spinner.fail("Failed to load timeline");
    const msg = error instanceof Error ? error.message : String(error);
    exitWithError(generalError(`Failed to load timeline: ${msg}`));
  }
}

export async function executeTimelineSet(
  file: string,
  options: TimelineSetOptions,
  commandName: string,
  startedAt: number,
): Promise<void> {
  const spinner = ora("Updating timeline...").start();

  try {
    if (options.dryRun) {
      spinner.stop();
      outputSuccess({
        command: commandName,
        startedAt,
        dryRun: true,
        data: {
          params: {
            file,
            name: options.name || null,
            ratio: options.ratio || null,
            fps: options.fps || null,
          },
        },
      });
      return;
    }

    const { filePath, project } = await loadProject(file);

    if (options.name) project.setName(options.name);
    if (options.ratio) project.setAspectRatio(options.ratio as AspectRatio);
    if (options.fps) project.setFrameRate(parseInt(options.fps, 10));

    await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

    spinner.succeed(chalk.green("Timeline updated"));

    if (isJsonMode()) {
      outputSuccess({
        command: commandName,
        startedAt,
        data: {
          file: filePath,
          updates: {
            name: options.name ?? null,
            ratio: options.ratio ?? null,
            fps: options.fps ? parseInt(options.fps, 10) : null,
          },
        },
      });
      return;
    }
  } catch (error) {
    spinner.fail("Failed to update timeline");
    const msg = error instanceof Error ? error.message : String(error);
    exitWithError(generalError(`Failed to update timeline: ${msg}`));
  }
}
