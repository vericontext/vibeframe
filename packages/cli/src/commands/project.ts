import { Command } from "commander";
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { Project, type ProjectFile } from "../engine/index.js";

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
  .description("Project management commands");

projectCommand
  .command("create")
  .description("Create a new project")
  .argument("<name>", "Project name")
  .option("-o, --output <path>", "Output file path", "./project.vibe.json")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)", "16:9")
  .option("-f, --fps <fps>", "Frame rate", "30")
  .action(async (name: string, options) => {
    const spinner = ora("Creating project...").start();

    try {
      const project = new Project(name);
      project.setAspectRatio(options.ratio);
      project.setFrameRate(parseInt(options.fps, 10));

      const outputPath = resolve(process.cwd(), options.output);
      const data = JSON.stringify(project.toJSON(), null, 2);
      await writeFile(outputPath, data, "utf-8");

      spinner.succeed(chalk.green(`Project created: ${outputPath}`));
      console.log();
      console.log(chalk.dim("  Name:"), name);
      console.log(chalk.dim("  Aspect Ratio:"), options.ratio);
      console.log(chalk.dim("  Frame Rate:"), options.fps, "fps");
    } catch (error) {
      spinner.fail(chalk.red("Failed to create project"));
      console.error(error);
      process.exit(1);
    }
  });

projectCommand
  .command("info")
  .description("Show project information")
  .argument("<file>", "Project file path")
  .action(async (file: string) => {
    const spinner = ora("Loading project...").start();

    try {
      const filePath = await resolveProjectPath(file);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      spinner.stop();

      const summary = project.getSummary();
      const meta = project.getMeta();

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
      spinner.fail(chalk.red("Failed to load project"));
      console.error(error);
      process.exit(1);
    }
  });

projectCommand
  .command("set")
  .description("Update project settings")
  .argument("<file>", "Project file path")
  .option("-n, --name <name>", "Project name")
  .option("-r, --ratio <ratio>", "Aspect ratio (16:9, 9:16, 1:1, 4:5)")
  .option("-f, --fps <fps>", "Frame rate")
  .action(async (file: string, options) => {
    const spinner = ora("Updating project...").start();

    try {
      const filePath = await resolveProjectPath(file);
      const content = await readFile(filePath, "utf-8");
      const data: ProjectFile = JSON.parse(content);
      const project = Project.fromJSON(data);

      if (options.name) project.setName(options.name);
      if (options.ratio) project.setAspectRatio(options.ratio);
      if (options.fps) project.setFrameRate(parseInt(options.fps, 10));

      await writeFile(filePath, JSON.stringify(project.toJSON(), null, 2), "utf-8");

      spinner.succeed(chalk.green("Project updated"));
    } catch (error) {
      spinner.fail(chalk.red("Failed to update project"));
      console.error(error);
      process.exit(1);
    }
  });

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${secs.padStart(4, "0")}`;
}
