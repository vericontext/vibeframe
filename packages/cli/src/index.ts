#!/usr/bin/env node

import { Command } from "commander";

// Re-export engine for library usage
export { Project, generateId, type ProjectFile } from "./engine/index.js";
import { projectCommand } from "./commands/project.js";
import { timelineCommand } from "./commands/timeline.js";
import { aiCommand } from "./commands/ai.js";
import { mediaCommand } from "./commands/media.js";
import { exportCommand } from "./commands/export.js";
import { batchCommand } from "./commands/batch.js";
import { detectCommand } from "./commands/detect.js";
import { setupCommand } from "./commands/setup.js";
import { startRepl } from "./repl/index.js";

// Re-export repl and config for library usage
export { startRepl, Session, executeReplCommand } from "./repl/index.js";
export { loadConfig, saveConfig, isConfigured, type VibeConfig } from "./config/index.js";

const program = new Command();

program
  .name("vibe")
  .description("VibeEdit CLI - AI-First Video Editor")
  .version("0.1.0");

program.addCommand(projectCommand);
program.addCommand(timelineCommand);
program.addCommand(aiCommand);
program.addCommand(mediaCommand);
program.addCommand(exportCommand);
program.addCommand(batchCommand);
program.addCommand(detectCommand);
program.addCommand(setupCommand);

// Check if any arguments provided
if (process.argv.length <= 2) {
  // No arguments - start interactive REPL
  startRepl().catch((err) => {
    console.error("Failed to start REPL:", err);
    process.exit(1);
  });
} else {
  // Arguments provided - parse normally
  program.parse();
}
