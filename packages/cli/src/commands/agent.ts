/**
 * Agent Command - Interactive AI agent REPL
 * Provides natural language interface with tool calling
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { AgentExecutor } from "../agent/index.js";
import { getApiKeyFromConfig, type LLMProvider } from "../config/index.js";
import { hasTTY, promptConfirm as promptYesNo } from "../utils/tty.js";
import { loadEnv } from "../utils/api-key.js";
import { exitWithError, authError, generalError } from "./output.js";
// Bundled inline by esbuild (see packages/cli/build.js). The previous
// `require("../../package.json")` broke once the cli was bundled into a
// flat dist/index.js — relative paths shifted.
import pkg from "../../package.json" with { type: "json" };

export interface StartAgentOptions {
  provider?: string;
  model?: string;
  project?: string;
  verbose?: boolean;
  maxTurns?: string;
  input?: string;
  confirm?: boolean;
  /** When true, suppress *all* confirm prompts including the cost gate. */
  noConfirm?: boolean;
  /** Cumulative USD ceiling — agent rejects further tool calls past this. */
  budgetUsd?: string;
}

/**
 * Prompt user for confirmation before tool execution.
 *
 * Shows the tool's cost tier inline so the user can decide whether to
 * approve a high-spend call. Tier color matches the rest of the CLI
 * (free=green, low=cyan, medium=yellow, high=yellow, very-high=red).
 *
 * Uses the shared `promptConfirm` (arrow ↑↓ Yes/No on TTY, `(Y/n)`
 * fallback in pipes) so the agent matches `vibe setup`'s dialog style.
 * Default selection is **No** for very-high tools — make the user
 * deliberately pick Yes for the spendiest calls.
 */
async function promptConfirm(
  toolName: string,
  args: Record<string, unknown>,
  cost: "free" | "low" | "medium" | "high" | "very-high" | undefined,
): Promise<boolean> {
  const argsStr = JSON.stringify(args, null, 2);
  const tierColor: Record<string, (s: string) => string> = {
    "free": chalk.green,
    "low": chalk.cyan,
    "medium": chalk.yellow,
    "high": chalk.yellow,
    "very-high": chalk.red,
  };
  // Show estimated USD alongside the tier label so the badge is more
  // than a vague "this is expensive" — the user sees `[VERY-HIGH ~$25]`
  // and can decide. Midpoints match the agent executor's
  // `estimateToolCost`; adjust both together if estimates change.
  const tierUsd: Record<string, string> = {
    "free": "$0",
    "low": "~$0.05",
    "medium": "~$0.50",
    "high": "~$3",
    "very-high": "~$25",
  };
  const costBadge = cost
    ? ` ${tierColor[cost](`[${cost.toUpperCase()} ${tierUsd[cost]}]`)}`
    : "";
  // Print the question + args block above the picker. promptYesNo
  // renders the arrow selector below.
  console.log();
  console.log(chalk.yellow(`Execute ${chalk.bold(toolName)}?${costBadge}`));
  console.log(chalk.dim(argsStr));
  const defaultYes = cost !== "very-high";
  return promptYesNo("", defaultYes);
}

/**
 * Start the AI agent
 * @param options - Agent options
 */
export async function startAgent(options: StartAgentOptions = {}): Promise<void> {
  const isNonInteractive = !!options.input;
  const confirmAlways = options.confirm || false;
  const noConfirm = options.noConfirm || false;
  const budgetUsd = options.budgetUsd ? parseFloat(options.budgetUsd) : undefined;
  if (budgetUsd !== undefined && (Number.isNaN(budgetUsd) || budgetUsd < 0)) {
    exitWithError(generalError(`Invalid --budget-usd: ${options.budgetUsd}`, "Must be a non-negative number (e.g., --budget-usd 5)"));
  }

  // Check if TTY is available (skip for non-interactive mode)
  if (!isNonInteractive && !hasTTY()) {
    exitWithError(generalError("Agent mode requires a terminal.", "Run 'vibe agent' directly from your terminal, or use --input <query> for non-interactive mode."));
  }

  const provider = (options.provider || "openai") as LLMProvider;
  const verbose = options.verbose || false;
  const maxTurns = parseInt(options.maxTurns || "10", 10) || 10;

  // Load environment variables from .env
  loadEnv();

  // Get API key
  const spinner = ora("Initializing agent...").start();

  let apiKey: string | undefined;
  const providerKeyMap: Record<string, string> = {
    openai: "openai",
    claude: "anthropic",
    gemini: "google",
    ollama: "ollama", // Ollama doesn't need API key
    xai: "xai",
    openrouter: "openrouter",
  };

  if (provider !== "ollama") {
    apiKey = await getApiKeyFromConfig(providerKeyMap[provider]);
    if (!apiKey) {
      spinner.fail(`API key required for ${provider}`);
      exitWithError(authError(getEnvVar(provider), provider));
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
      // Always supply the callback so the cost gate (high/very-high
      // tools) can prompt even without `--confirm`. The executor
      // decides whether to invoke based on `confirmAlways` / `noConfirm`.
      confirmCallback: noConfirm ? undefined : promptConfirm,
      confirmAlways,
      noConfirm,
      budgetUsd,
    });

    await agent.initialize();
    spinner.succeed(chalk.green("Agent initialized"));
  } catch (error) {
    spinner.fail("Failed to initialize agent");
    const msg = error instanceof Error ? error.message : String(error);
    exitWithError(generalError(`Failed to initialize agent: ${msg}`));
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
      exitWithError(generalError(error instanceof Error ? error.message : String(error)));
    }
  }

  // Print welcome banner
  const version = pkg.version;
  const toolCount = agent.getTools().length;
  const cwd = process.cwd().replace(process.env.HOME || "", "~");

  console.log();
  console.log(chalk.cyan("██╗   ██╗██╗██████╗ ███████╗███████╗██████╗  █████╗ ███╗   ███╗███████╗"));
  console.log(chalk.cyan("██║   ██║██║██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝"));
  console.log(chalk.cyan("██║   ██║██║██████╔╝█████╗  █████╗  ██████╔╝███████║██╔████╔██║█████╗"));
  console.log(chalk.cyan("╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝"));
  console.log(chalk.cyan(" ╚████╔╝ ██║██████╔╝███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗"));
  console.log(chalk.cyan("  ╚═══╝  ╚═╝╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝"));
  console.log();
  console.log(chalk.dim(`  v${version} · ${provider}${options.model ? ` · ${options.model}` : ""} · ${cwd}`));
  console.log();

  // Show status line
  const confirmStatus = noConfirm
    ? chalk.dim("no-confirm")
    : confirmAlways
      ? chalk.yellow("confirm mode")
      : chalk.dim("cost gate (high/very-high)");
  const statusParts = [
    chalk.green(`${toolCount} tools`),
    confirmStatus,
    budgetUsd !== undefined ? chalk.magenta(`budget: $${budgetUsd.toFixed(2)}`) : null,
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
        // Cumulative USD: only show when something has actually been
        // spent OR a budget cap is active. Otherwise the line is noise
        // for free-tier-only sessions.
        const spent = agent.getCumulativeUsd();
        if (spent > 0 || budgetUsd !== undefined) {
          const budgetStr = budgetUsd !== undefined ? ` / $${budgetUsd.toFixed(2)} cap` : "";
          console.log(chalk.dim(`Spent (tier-estimated): $${spent.toFixed(2)}${budgetStr}`));
        }
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
  .option("-p, --provider <provider>", "LLM provider (openai, claude, gemini, ollama, xai, openrouter)", "openai")
  .option("-m, --model <model>", "Model to use (provider-specific)")
  .option("--project <path>", "Timeline file or directory to load")
  .option("-v, --verbose", "Show verbose output including tool calls")
  .option("--max-turns <n>", "Maximum turns per request", "10")
  .option("-i, --input <query>", "Run a single query and exit (non-interactive)")
  .option("-c, --confirm", "Confirm before every tool — broadens the default cost gate (paid only) to all calls")
  .option("--no-confirm", "Disable all confirm prompts including the high/very-high cost gate (CI / automation)")
  .option("--budget-usd <usd>", "Reject tool calls past this cumulative USD ceiling (tier-estimated, conservative)")
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
    openrouter: "OPENROUTER_API_KEY",
  };
  return envVars[provider] || "API_KEY";
}
