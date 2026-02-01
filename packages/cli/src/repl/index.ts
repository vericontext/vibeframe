/**
 * REPL Main Entry Point
 * Interactive shell for VibeFrame
 */

import chalk from "chalk";
import { Session } from "./session.js";
import { executeReplCommand } from "./executor.js";
import { getWelcomeMessage, getPrompt } from "./prompts.js";
import { isConfigured } from "../config/index.js";
import { createTTYInterface, hasTTY, closeTTYStream } from "../utils/tty.js";

// Re-export for external use
export { Session } from "./session.js";
export { executeReplCommand, type CommandResult } from "./executor.js";

/**
 * Start the interactive REPL
 */
export async function startRepl(): Promise<void> {
  console.error("[DEBUG] 1. startRepl called");

  // Check if TTY is available
  if (!hasTTY()) {
    console.error(chalk.red("Error: Interactive mode requires a terminal."));
    console.log(chalk.dim("Run 'vibe' directly from your terminal, not from a pipe."));
    console.log();
    console.log("For non-interactive use, try:");
    console.log(chalk.cyan("  vibe --help"));
    console.log(chalk.cyan("  vibe project create myproject"));
    process.exit(1);
  }

  console.error("[DEBUG] 2. hasTTY passed");

  // Create session and initialize
  const session = new Session();
  await session.initialize();

  console.error("[DEBUG] 3. session initialized");

  // Check configuration status
  const configured = await isConfigured();

  console.error("[DEBUG] 4. isConfigured:", configured);

  // Print welcome message
  console.log(getWelcomeMessage(configured));

  console.error("[DEBUG] 5. welcome message printed");

  // Create readline interface with TTY support
  const rl = createTTYInterface({
    prompt: getPrompt(),
    historySize: 100,
  });

  console.error("[DEBUG] 6. readline interface created");

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
      closeTTYStream();
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
    closeTTYStream();
    process.exit(0);
  });

  // Start the REPL
  console.error("[DEBUG] 7. calling rl.prompt()");
  rl.prompt();
  console.error("[DEBUG] 8. rl.prompt() called");
}
