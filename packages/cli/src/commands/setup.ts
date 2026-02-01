/**
 * Setup command - Interactive configuration wizard
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  CONFIG_PATH,
  type VibeConfig,
  type LLMProvider,
  PROVIDER_NAMES,
} from "../config/index.js";

// TTY input stream - use /dev/tty when stdin is not a TTY (e.g., piped from curl)
let ttyInput: NodeJS.ReadableStream | null = null;

/**
 * Get TTY input stream, opening /dev/tty if needed
 */
function getTTYInput(): NodeJS.ReadableStream {
  if (process.stdin.isTTY) {
    return process.stdin;
  }

  // stdin is not a TTY (piped), open /dev/tty directly
  if (!ttyInput) {
    try {
      ttyInput = createReadStream("/dev/tty");
    } catch {
      // Fallback to stdin if /dev/tty is not available (e.g., on Windows)
      return process.stdin;
    }
  }
  return ttyInput;
}

/**
 * Close TTY input if we opened it
 */
function closeTTYInput(): void {
  if (ttyInput && ttyInput !== process.stdin) {
    (ttyInput as NodeJS.ReadStream).destroy?.();
    ttyInput = null;
  }
}

export const setupCommand = new Command("setup")
  .description("Configure VibeFrame (LLM provider, API keys)")
  .option("--reset", "Reset configuration to defaults")
  .action(async (options) => {
    if (options.reset) {
      const config = createDefaultConfig();
      await saveConfig(config);
      console.log(chalk.green("Configuration reset to defaults"));
      console.log(chalk.dim(`Saved to: ${CONFIG_PATH}`));
      return;
    }

    try {
      await runSetupWizard();
    } finally {
      closeTTYInput();
    }
  });

/**
 * Prompt for input with optional hidden mode
 */
async function prompt(question: string, hidden = false): Promise<string> {
  const input = getTTYInput();

  const rl = createInterface({
    input,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // For hidden input, we need raw mode on the TTY
    if (hidden && (input as NodeJS.ReadStream).isTTY) {
      process.stdout.write(question);

      let value = "";
      const stdin = input as NodeJS.ReadStream;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");

      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(value);
        } else if (char === "\u0003") {
          // Ctrl+C
          closeTTYInput();
          process.exit(1);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
        } else {
          value += char;
        }
      };

      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Run the interactive setup wizard
 */
async function runSetupWizard(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("VibeFrame Setup Wizard"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();

  // Load existing config or create default
  let config = await loadConfig();
  if (!config) {
    config = createDefaultConfig();
  }

  // Step 1: Select LLM Provider
  console.log(chalk.bold("1. LLM Provider"));
  console.log(chalk.dim("   Select your primary AI provider for editing commands"));
  console.log();

  const providers: LLMProvider[] = ["claude", "openai", "gemini", "ollama"];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    const selected = config.llm.provider === p ? chalk.green("*") : " ";
    const recommended = p === "claude" ? chalk.dim(" (Recommended)") : "";
    console.log(`   ${selected} ${i + 1}. ${PROVIDER_NAMES[p]}${recommended}`);
  }
  console.log();

  const providerChoice = await prompt(chalk.cyan("   Select [1-4]: "));
  const providerIndex = parseInt(providerChoice, 10) - 1;
  if (providerIndex >= 0 && providerIndex < providers.length) {
    config.llm.provider = providers[providerIndex];
  }
  console.log();

  // Step 2: API Key for selected provider
  const selectedProvider = config.llm.provider;
  const providerKey = selectedProvider === "gemini" ? "google" : selectedProvider === "claude" ? "anthropic" : selectedProvider;

  if (selectedProvider !== "ollama") {
    console.log(chalk.bold(`2. ${PROVIDER_NAMES[selectedProvider]} API Key`));

    const existingKey = config.providers[providerKey as keyof typeof config.providers];
    if (existingKey) {
      console.log(chalk.dim(`   Current: ${maskApiKey(existingKey)}`));
      const change = await prompt(chalk.cyan("   Change API key? (y/N): "));
      if (change.toLowerCase() === "y" || change.toLowerCase() === "yes") {
        const newKey = await prompt(chalk.cyan("   Enter API key: "), true);
        if (newKey.trim()) {
          config.providers[providerKey as keyof typeof config.providers] = newKey.trim();
        }
      }
    } else {
      const newKey = await prompt(chalk.cyan("   Enter API key: "), true);
      if (newKey.trim()) {
        config.providers[providerKey as keyof typeof config.providers] = newKey.trim();
      }
    }
    console.log();
  }

  // Step 3: Optional additional providers
  console.log(chalk.bold("3. Additional Providers (optional)"));
  console.log(chalk.dim("   Configure AI providers for video generation, TTS, etc."));
  console.log();

  const optionalProviders = [
    { key: "elevenlabs", name: "ElevenLabs (TTS, Voice)" },
    { key: "runway", name: "Runway Gen-3 (Video)" },
    { key: "kling", name: "Kling AI (Video)" },
    { key: "stability", name: "Stability AI (Images)" },
    { key: "replicate", name: "Replicate (Various)" },
  ];

  for (const provider of optionalProviders) {
    const existing = config.providers[provider.key as keyof typeof config.providers];
    const status = existing ? chalk.green(" (configured)") : "";

    const configure = await prompt(chalk.cyan(`   Configure ${provider.name}${status}? (y/N): `));
    if (configure.toLowerCase() === "y" || configure.toLowerCase() === "yes") {
      const key = await prompt(chalk.cyan(`   Enter ${provider.name} API key: `), true);
      if (key.trim()) {
        config.providers[provider.key as keyof typeof config.providers] = key.trim();
      }
    }
  }
  console.log();

  // Step 4: Default settings
  console.log(chalk.bold("4. Default Settings"));
  console.log();

  console.log(chalk.dim("   Aspect Ratio:"));
  const ratios = ["16:9", "9:16", "1:1", "4:5"] as const;
  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i];
    const selected = config.defaults.aspectRatio === r ? chalk.green("*") : " ";
    console.log(`   ${selected} ${i + 1}. ${r}`);
  }
  const ratioChoice = await prompt(chalk.cyan("   Select [1-4]: "));
  const ratioIndex = parseInt(ratioChoice, 10) - 1;
  if (ratioIndex >= 0 && ratioIndex < ratios.length) {
    config.defaults.aspectRatio = ratios[ratioIndex];
  }
  console.log();

  // Step 5: REPL settings
  const autoSave = await prompt(chalk.cyan("   Auto-save after each command? (Y/n): "));
  config.repl.autoSave = autoSave.toLowerCase() !== "n";
  console.log();

  // Save configuration
  await saveConfig(config);

  console.log(chalk.dim("─".repeat(40)));
  console.log(chalk.green.bold("Setup complete!"));
  console.log();
  console.log(chalk.dim(`Config saved to: ${CONFIG_PATH}`));
  console.log();
  console.log(chalk.cyan("Run `vibe` to start the interactive editor"));
  console.log(chalk.cyan("Run `vibe --help` to see all commands"));
  console.log();
}

/**
 * Mask API key for display
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
