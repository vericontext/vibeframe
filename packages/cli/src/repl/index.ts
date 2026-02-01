/**
 * REPL Main Entry Point
 * Interactive shell for VibeFrame
 */

import { createInterface, Interface } from "node:readline";
import chalk from "chalk";
import { Session } from "./session.js";
import { executeReplCommand } from "./executor.js";
import { getWelcomeMessage, getPrompt } from "./prompts.js";
import { isConfigured } from "../config/index.js";

// Re-export for external use
export { Session } from "./session.js";
export { executeReplCommand, type CommandResult } from "./executor.js";

/**
 * Start the interactive REPL
 */
export async function startRepl(): Promise<void> {
  // Create session and initialize
  const session = new Session();
  await session.initialize();

  // Check configuration status
  const configured = await isConfigured();

  // Print welcome message
  console.log(getWelcomeMessage(configured));

  // Create readline interface
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
    prompt: getPrompt(),
  });

  // Handle SIGINT (Ctrl+C)
  rl.on("SIGINT", () => {
    console.log();
    console.log(chalk.dim("Use 'exit' to quit"));
    rl.prompt();
  });

  // Update prompt based on project state
  const updatePrompt = () => {
    const projectName = session.getProjectName();
    rl.setPrompt(getPrompt(projectName));
  };

  // Main REPL loop
  const processLine = async (line: string) => {
    const result = await executeReplCommand(line, session);

    // Handle special cases
    if (result.showSetup) {
      // Import and run setup wizard
      const { setupCommand } = await import("../commands/setup.js");
      console.log();
      await setupCommand.parseAsync(["setup"], { from: "user" });
      // Reload config
      await session.initialize();
      updatePrompt();
      rl.prompt();
      return;
    }

    if (result.shouldExit) {
      if (result.message) {
        console.log(result.message);
      }
      rl.close();
      process.exit(0);
      return;
    }

    // Print result if any
    if (result.message) {
      console.log(result.message);
    }

    // Update prompt and continue
    updatePrompt();
    rl.prompt();
  };

  // Handle each line
  rl.on("line", (line) => {
    processLine(line).catch((err) => {
      console.error(chalk.red("Error:"), err.message);
      rl.prompt();
    });
  });

  // Handle close
  rl.on("close", () => {
    console.log();
    console.log(chalk.dim("Goodbye!"));
    process.exit(0);
  });

  // Start the REPL
  rl.prompt();
}
