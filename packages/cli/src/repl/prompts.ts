/**
 * REPL prompts, ASCII logo, and help text
 */

import chalk from "chalk";

/**
 * ASCII Logo for VibeFrame
 */
export const ASCII_LOGO = `
${chalk.magenta(" ██╗   ██╗██╗██████╗ ███████╗")}
${chalk.magenta(" ██║   ██║██║██╔══██╗██╔════╝")}
${chalk.magenta(" ╚██╗ ██╗██║██████╔╝█████╗  ")}
${chalk.magenta("  ╚████╔╝██║██████╔╝███████╗")}  ${chalk.dim("edit")}
${chalk.magenta("   ╚═══╝ ╚═╝╚═════╝ ╚══════╝")}
`;

/**
 * Welcome message shown when REPL starts
 */
export function getWelcomeMessage(configured: boolean): string {
  const lines = [
    ASCII_LOGO,
    chalk.dim("─".repeat(40)),
    chalk.cyan("AI-First Video Editor"),
    chalk.dim("Type commands in natural language"),
    "",
    chalk.dim(`Type ${chalk.white("help")} for commands, ${chalk.white("exit")} to quit`),
    "",
  ];

  if (!configured) {
    lines.push(chalk.yellow("No configuration found."));
    lines.push(chalk.yellow(`Run ${chalk.white("setup")} to configure API keys.`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Help text for built-in commands
 */
export function getHelpText(): string {
  const commands = [
    { cmd: "new <name>", desc: "Create a new project" },
    { cmd: "open <path>", desc: "Open a project file" },
    { cmd: "save [path]", desc: "Save current project" },
    { cmd: "info", desc: "Show project information" },
    { cmd: "list", desc: "List timeline contents" },
    { cmd: "add <media>", desc: "Add media source to project" },
    { cmd: "export [path]", desc: "Export project to video" },
    { cmd: "undo", desc: "Undo last action" },
    { cmd: "setup", desc: "Configure API keys" },
    { cmd: "help", desc: "Show this help" },
    { cmd: "exit", desc: "Exit the REPL" },
  ];

  const lines = [
    "",
    chalk.bold.cyan("Built-in Commands"),
    chalk.dim("─".repeat(40)),
    "",
  ];

  for (const { cmd, desc } of commands) {
    lines.push(`  ${chalk.yellow(cmd.padEnd(16))} ${desc}`);
  }

  lines.push("");
  lines.push(chalk.bold.cyan("Natural Language Commands"));
  lines.push(chalk.dim("─".repeat(40)));
  lines.push("");
  lines.push("  You can also type commands in natural language:");
  lines.push("");
  lines.push(chalk.dim("  Examples:"));
  lines.push(`  ${chalk.white('"Add intro.mp4 to the timeline"')}`);
  lines.push(`  ${chalk.white('"Trim the first clip to 5 seconds"')}`);
  lines.push(`  ${chalk.white('"Add fade in effect to all clips"')}`);
  lines.push(`  ${chalk.white('"Split the clip at 3 seconds"')}`);
  lines.push(`  ${chalk.white('"Delete the last clip"')}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Get project info summary
 */
export function formatProjectInfo(summary: {
  name: string;
  duration: number;
  aspectRatio: string;
  frameRate: number;
  trackCount: number;
  clipCount: number;
  sourceCount: number;
  filePath?: string;
}): string {
  const lines = [
    "",
    chalk.bold.cyan("Project Info"),
    chalk.dim("─".repeat(40)),
    "",
    `  ${chalk.dim("Name:")}       ${summary.name}`,
    `  ${chalk.dim("Duration:")}   ${formatDuration(summary.duration)}`,
    `  ${chalk.dim("Aspect:")}     ${summary.aspectRatio}`,
    `  ${chalk.dim("Frame Rate:")} ${summary.frameRate} fps`,
    `  ${chalk.dim("Tracks:")}     ${summary.trackCount}`,
    `  ${chalk.dim("Clips:")}      ${summary.clipCount}`,
    `  ${chalk.dim("Sources:")}    ${summary.sourceCount}`,
  ];

  if (summary.filePath) {
    lines.push(`  ${chalk.dim("File:")}       ${summary.filePath}`);
  } else {
    lines.push(`  ${chalk.dim("File:")}       ${chalk.yellow("(unsaved)")}`);
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Format duration in HH:MM:SS format
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  if (m > 0) {
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  }
  return `${s}.${ms.toString().padStart(2, "0")}s`;
}

/**
 * REPL prompt string
 */
export function getPrompt(projectName?: string): string {
  if (projectName) {
    return `${chalk.magenta("vibe")} ${chalk.dim(`[${projectName}]`)}${chalk.green(">")} `;
  }
  return `${chalk.magenta("vibe")}${chalk.green(">")} `;
}

/**
 * Success message
 */
export function success(message: string): string {
  return `${chalk.green("✓")} ${message}`;
}

/**
 * Error message
 */
export function error(message: string): string {
  return `${chalk.red("✗")} ${message}`;
}

/**
 * Warning message
 */
export function warn(message: string): string {
  return `${chalk.yellow("!")} ${message}`;
}

/**
 * Info message
 */
export function info(message: string): string {
  return `${chalk.blue("i")} ${message}`;
}
