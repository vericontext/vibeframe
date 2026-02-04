/**
 * Agent Command - Interactive AI agent REPL
 * Provides natural language interface with tool calling
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
import chalk from "chalk";
import ora from "ora";
import { AgentExecutor } from "../agent/index.js";
import { loadConfig, getApiKeyFromConfig, type LLMProvider } from "../config/index.js";
import { hasTTY } from "../utils/tty.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

export interface StartAgentOptions {
  provider?: string;
  model?: string;
  project?: string;
  verbose?: boolean;
  maxTurns?: string;
  input?: string;
  confirm?: boolean;
}

/**
 * Prompt user for confirmation before tool execution
 */
async function promptConfirm(
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY ?? false,
  });

  return new Promise((resolve) => {
    const argsStr = JSON.stringify(args, null, 2);
    console.log();
    console.log(chalk.yellow(`Execute ${chalk.bold(toolName)}?`));
    console.log(chalk.dim(argsStr));
    rl.question(chalk.cyan("(y/n): "), (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Start the AI agent
 * @param options - Agent options
 */
export async function startAgent(options: StartAgentOptions = {}): Promise<void> {
  const isNonInteractive = !!options.input;
  const confirmMode = options.confirm || false;

  // Check if TTY is available (skip for non-interactive mode)
  if (!isNonInteractive && !hasTTY()) {
    console.error(chalk.red("Error: Agent mode requires a terminal."));
    console.log(chalk.dim("Run 'vibe agent' directly from your terminal."));
    console.log(chalk.dim("Or use --input <query> for non-interactive mode."));
    process.exit(1);
  }

  const provider = (options.provider || "openai") as LLMProvider;
  const verbose = options.verbose || false;
  const maxTurns = parseInt(options.maxTurns || "10", 10) || 10;

  // Get API key
  const spinner = ora("Initializing agent...").start();

  let apiKey: string | undefined;
  const providerKeyMap: Record<string, string> = {
    openai: "openai",
    claude: "anthropic",
    gemini: "google",
    ollama: "ollama", // Ollama doesn't need API key
    xai: "xai",
  };

  if (provider !== "ollama") {
    apiKey = await getApiKeyFromConfig(providerKeyMap[provider]);
    if (!apiKey) {
      spinner.fail(chalk.red(`API key required for ${provider}`));
      console.log();
      console.log(chalk.yellow("Configure your API key:"));
      console.log(chalk.dim("  Run: vibe setup"));
      console.log(chalk.dim(`  Or set: ${getEnvVar(provider)}`));
      process.exit(1);
    }
  } else {
    apiKey = "http://localhost:11434"; // Default Ollama URL
  }

  // Create agent
  let agent: AgentExecutor;
  try {
    agent = new AgentExecutor({
      provider,
      apiKey,
      model: options.model,
      maxTurns,
      verbose,
      projectPath: options.project,
      confirmCallback: confirmMode ? promptConfirm : undefined,
    });

    await agent.initialize();
    spinner.succeed(chalk.green("Agent initialized"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to initialize agent"));
    console.error(error);
    process.exit(1);
  }

  // Non-interactive mode: run single query and exit
  if (isNonInteractive) {
    try {
      const result = await agent.execute(options.input!);

      if (verbose && result.toolsUsed.length > 0) {
        console.log(chalk.dim(`Used: ${result.toolsUsed.join(", ")}`));
      }

      console.log(result.response);

      if (verbose) {
        console.log(chalk.dim(`(${result.turns} turn${result.turns > 1 ? "s" : ""})`));
      }

      process.exit(0);
    } catch (error) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  }

  // Print welcome banner
  const version = pkg.version;
  const toolCount = agent.getTools().length;
  const cwd = process.cwd().replace(process.env.HOME || "", "~");

  console.log();
  console.log(chalk.cyan("  ██╗   ██╗██╗██████╗ ███████╗"));
  console.log(chalk.cyan("  ██║   ██║██║██╔══██╗██╔════╝"));
  console.log(chalk.cyan("  ██║   ██║██║██████╔╝█████╗  ") + chalk.dim(`  VibeFrame v${version}`));
  console.log(chalk.cyan("  ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ") + chalk.dim(`  ${provider}${options.model ? ` · ${options.model}` : ""}`));
  console.log(chalk.cyan("   ╚████╔╝ ██║██████╔╝███████╗") + chalk.dim(`  ${cwd}`));
  console.log(chalk.cyan("    ╚═══╝  ╚═╝╚═════╝ ╚══════╝"));
  console.log();

  // Show status line
  const statusParts = [
    chalk.green(`${toolCount} tools`),
    confirmMode ? chalk.yellow("confirm mode") : null,
    options.project ? chalk.blue(`project: ${options.project}`) : null,
  ].filter(Boolean);

  console.log(chalk.dim("  ") + statusParts.join(chalk.dim(" · ")));
  console.log();
  console.log(chalk.dim("  Commands: exit · reset · tools · context"));
  console.log();

  // Wrap readline in a Promise that resolves only when readline closes
  // This keeps the Node.js event loop alive until the user exits
  return new Promise<void>((resolve) => {
    // Ensure stdin keeps the event loop alive
    if (typeof process.stdin.ref === "function") {
      process.stdin.ref();
    }

    // Keepalive timer to prevent event loop from exiting
    // This is cleared when readline closes
    const keepalive = setInterval(() => {
      // Keep event loop alive
    }, 60000);

    // Create readline interface
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY ?? false,
      historySize: 100,
      prompt: chalk.green("you> "),
    });

    // Handle SIGINT (Ctrl+C)
    rl.on("SIGINT", () => {
      console.log();
      console.log(chalk.dim('Use "exit" to quit'));
      rl.prompt();
    });

    // Process user input
    const processInput = async (input: string) => {
      const trimmed = input.trim();

      if (!trimmed) {
        rl.prompt();
        return;
      }

      // Handle special commands
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log();
        console.log(chalk.dim("Goodbye!"));
        rl.close();
        return;
      }

      if (trimmed.toLowerCase() === "reset") {
        agent.reset();
        console.log(chalk.dim("Context cleared"));
        rl.prompt();
        return;
      }

      if (trimmed.toLowerCase() === "tools") {
        const tools = agent.getTools();
        console.log();
        console.log(chalk.bold.cyan("Available Tools"));
        console.log(chalk.dim("─".repeat(50)));
        for (const tool of tools.sort()) {
          console.log(`  ${chalk.yellow(tool)}`);
        }
        console.log();
        console.log(chalk.dim(`Total: ${tools.length} tools`));
        console.log();
        rl.prompt();
        return;
      }

      if (trimmed.toLowerCase() === "context") {
        const context = agent.getContext();
        console.log();
        console.log(chalk.bold.cyan("Current Context"));
        console.log(chalk.dim("─".repeat(50)));
        console.log(chalk.dim("Working Directory:"), context.workingDirectory);
        console.log(chalk.dim("Project:"), context.projectPath || "(none)");
        console.log();
        rl.prompt();
        return;
      }

      // Execute agent
      // discardStdin: false is critical - ora's default discards stdin which breaks readline
      const execSpinner = ora({
        text: "Thinking...",
        color: "cyan",
        discardStdin: false,
      }).start();

      try {
        const result = await agent.execute(trimmed);

        if (verbose && result.toolsUsed.length > 0) {
          execSpinner.info(chalk.dim(`Used: ${result.toolsUsed.join(", ")}`));
        } else {
          execSpinner.stop();
        }

        console.log();
        console.log(chalk.cyan("vibe>"), result.response);
        console.log();

        if (verbose) {
          console.log(chalk.dim(`(${result.turns} turn${result.turns > 1 ? "s" : ""})`));
          console.log();
        }
      } catch (error) {
        execSpinner.fail(chalk.red("Error"));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        console.log();
      }

      // Resume readline and show prompt (ora spinner may have paused it)
      rl.resume();
      rl.prompt();
      // Ensure stdin stays referenced after async operations
      if (typeof process.stdin.ref === "function") {
        process.stdin.ref();
      }
    };

    // Handle each line
    rl.on("line", (line) => {
      processInput(line).catch((err) => {
        console.error(chalk.red("Error:"), err.message);
        rl.resume();
        rl.prompt();
      });
    });

    // Handle close - resolve the Promise to allow natural exit
    rl.on("close", () => {
      clearInterval(keepalive);
      console.log();
      console.log(chalk.dim("Goodbye!"));
      resolve();
    });

    // Start REPL
    rl.prompt();
  });
}

export const agentCommand = new Command("agent")
  .description("Start the AI agent with natural language interface")
  .option("-p, --provider <provider>", "LLM provider (openai, claude, gemini, ollama, xai)", "openai")
  .option("-m, --model <model>", "Model to use (provider-specific)")
  .option("--project <path>", "Project file to load")
  .option("-v, --verbose", "Show verbose output including tool calls")
  .option("--max-turns <n>", "Maximum turns per request", "10")
  .option("-i, --input <query>", "Run a single query and exit (non-interactive)")
  .option("-c, --confirm", "Confirm before each tool execution")
  .action(async (options) => {
    await startAgent(options);
  });

function getEnvVar(provider: string): string {
  const envVars: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    claude: "ANTHROPIC_API_KEY",
    gemini: "GOOGLE_API_KEY",
    ollama: "(no API key needed)",
    xai: "XAI_API_KEY",
  };
  return envVars[provider] || "API_KEY";
}
