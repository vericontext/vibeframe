import { Command } from "commander";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";
import { exitWithError, generalError, isJsonMode, outputSuccess } from "./output.js";
import { validateOutputPath } from "./validate.js";

/**
 * Resolve project file path - handles both file paths and directory paths
 * If path is a directory, looks for project.vibe.json inside
 */
async function resolveProjectPath(inputPath: string): Promise<string> {
  const filePath = resolve(process.cwd(), inputPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      return resolve(filePath, "project.vibe.json");
    }
  } catch {
    // Path doesn't exist or other error - let readFile handle it
  }

  return filePath;
}

export const projectCommand = new Command("project")
  .description("Project management commands")
  .addHelpText("after", `
Examples:
  $ vibe project create "my-video" -o project.vibe.json
  $ vibe project create "shorts" -r 9:16 -o vertical.vibe.json
  $ vibe project info project.vibe.json
  $ vibe project set project.vibe.json --fps 60

Cost: Free (no API keys needed). Projects are saved as .vibe.json files.
Run 'vibe schema project.<command>' for structured parameter info.`);

projectCommand
  .command("create")
  .description("Create a new project")
  .argument("<name>", "Project name or path (e.g., 'my-project' or 'output/my-project')")
  .option("-o, --output <path>", "Output file path (overrides name-based path)")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)", "16:9")
  .option("-f, --fps <fps>", "Frame rate", "30")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (name: string, options) => {
    const startedAt = Date.now();
    const spinner = ora("Creating project...").start();

    try {
      if (options.output) {
        validateOutputPath(options.output);
      }

      if (options.dryRun) {
        outputSuccess({
          command: "project create",
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

      // If name contains a path separator, treat it as a directory path
      const projectName = name.includes("/") ? name.split("/").pop()! : name;
      const project = new Project(projectName);
      project.setAspectRatio(options.ratio);
      project.setFrameRate(parseInt(options.fps, 10));

      let outputPath: string;
      if (options.output) {
        outputPath = resolve(process.cwd(), options.output);
      } else if (name.includes("/")) {
        // Name contains path — create directory and put project.vibe.json inside
        const dirPath = resolve(process.cwd(), name);
        const { mkdir } = await import("node:fs/promises");
        await mkdir(dirPath, { recursive: true });
        outputPath = resolve(dirPath, "project.vibe.json");
      } else {
        outputPath = resolve(process.cwd(), "project.vibe.json");
      }

      const data = JSON.stringify(project.toJSON(), null, 2);
      await writeFile(outputPath, data, "utf-8");

      spinner.succeed(chalk.green(`Project created: ${outputPath}`));

      if (isJsonMode()) {
        outputSuccess({
          command: "project create",
          startedAt,
          data: {
            outputPath,
            name: projectName,
            aspectRatio: options.ratio,
            frameRate: parseInt(options.fps, 10),
          },
        });
        return;
      }

      console.log();
      console.log(chalk.dim("  Name:"), projectName);
      console.log(chalk.dim("  Aspect Ratio:"), options.ratio);
      console.log(chalk.dim("  Frame Rate:"), options.fps, "fps");
    } catch (error) {
      spinner.fail("Failed to create project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to create project: ${msg}`));
    }
  });

projectCommand
  .command("info")
  .description("Show project information")
  .argument("<file>", "Project file path")
  .action(async (file: string) => {
    const startedAt = Date.now();
    const spinner = ora("Loading project...").start();

    try {
      const filePath = await resolveProjectPath(file);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      spinner.stop();

      const summary = project.getSummary();
      const meta = project.getMeta();

      if (isJsonMode()) {
        outputSuccess({
          command: "project info",
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
      console.log(chalk.bold.cyan("Project Info"));
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
      spinner.fail("Failed to load project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to load project: ${msg}`));
    }
  });

projectCommand
  .command("set")
  .description("Update project settings")
  .argument("<file>", "Project file path")
  .option("-n, --name <name>", "Project name")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)")
  .option("-f, --fps <fps>", "Frame rate")
  .option("--dry-run", "Preview parameters without executing")
  .action(async (file: string, options) => {
    const startedAt = Date.now();
    const spinner = ora("Updating project...").start();

    try {
      if (options.dryRun) {
        outputSuccess({
          command: "project set",
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

      const filePath = await resolveProjectPath(file);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      if (options.name) project.setName(options.name);
      if (options.ratio) project.setAspectRatio(options.ratio);
      if (options.fps) project.setFrameRate(parseInt(options.fps, 10));

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green("Project updated"));

      if (isJsonMode()) {
        outputSuccess({
          command: "project set",
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
      spinner.fail("Failed to update project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to update project: ${msg}`));
    }
  });

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}
