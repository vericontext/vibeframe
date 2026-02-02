/**
 * Setup command - Interactive configuration wizard
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  CONFIG_PATH,
  type LLMProvider,
  PROVIDER_NAMES,
} from "../config/index.js";
import {
  promptHidden,
  promptSelect,
  promptConfirm,
  closeTTYStream,
  hasTTY,
} from "../utils/tty.js";

export const setupCommand = new Command("setup")
  .description("Configure VibeFrame (LLM provider, API keys)")
  .option("--reset", "Reset configuration to defaults")
  .option("--full", "Run full setup with all optional providers")
  .action(async (options) => {
    if (options.reset) {
      const config = createDefaultConfig();
      await saveConfig(config);
      console.log(chalk.green("✓ Configuration reset to defaults"));
      console.log(chalk.dim(`  Saved to: ${CONFIG_PATH}`));
      return;
    }

    // Check if TTY is available
    if (!hasTTY()) {
      console.error(chalk.red("Error: Interactive setup requires a terminal."));
      console.log(chalk.dim("Run 'vibe setup' directly from your terminal."));
      process.exit(1);
    }

    try {
      await runSetupWizard(options.full);
      closeTTYStream();
      // Explicitly exit to ensure clean termination when run from install script
      // The TTY stream can keep the event loop alive otherwise
      process.exit(0);
    } catch (err) {
      closeTTYStream();
      throw err;
    }
  });

/**
 * Run the interactive setup wizard
 */
async function runSetupWizard(fullSetup = false): Promise<void> {
  console.log();
  console.log(chalk.bold.magenta("VibeFrame Setup"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();

  // Load existing config or create default
  let config = await loadConfig();
  if (!config) {
    config = createDefaultConfig();
  }

  // Step 1: Select LLM Provider
  console.log(chalk.bold("1. Choose your AI provider"));
  console.log();

  const providers: LLMProvider[] = ["claude", "openai", "gemini", "ollama"];
  const providerLabels = providers.map((p) => {
    const rec = p === "claude" ? chalk.dim(" (recommended)") : "";
    return `${PROVIDER_NAMES[p]}${rec}`;
  });

  const currentIndex = providers.indexOf(config.llm.provider);
  const providerIndex = await promptSelect(
    chalk.cyan("   Select [1-4]: "),
    providerLabels,
    currentIndex >= 0 ? currentIndex : 0
  );
  config.llm.provider = providers[providerIndex];
  console.log();

  // Step 2: API Key for selected provider
  const selectedProvider = config.llm.provider;

  if (selectedProvider !== "ollama") {
    const providerKey =
      selectedProvider === "gemini"
        ? "google"
        : selectedProvider === "claude"
        ? "anthropic"
        : selectedProvider;

    console.log(chalk.bold(`2. ${PROVIDER_NAMES[selectedProvider]} API Key`));

    const existingKey = config.providers[providerKey as keyof typeof config.providers];
    if (existingKey) {
      console.log(chalk.dim(`   Current: ${maskApiKey(existingKey)}`));
      const change = await promptConfirm(chalk.cyan("   Update?"), false);
      if (change) {
        const newKey = await promptHidden(chalk.cyan("   Enter API key: "));
        if (newKey.trim()) {
          config.providers[providerKey as keyof typeof config.providers] = newKey.trim();
          console.log(chalk.green("   ✓ Updated"));
        }
      }
    } else {
      const newKey = await promptHidden(chalk.cyan("   Enter API key: "));
      if (newKey.trim()) {
        config.providers[providerKey as keyof typeof config.providers] = newKey.trim();
        console.log(chalk.green("   ✓ Saved"));
      } else {
        console.log(chalk.yellow("   ⚠ Skipped (required for AI features)"));
      }
    }
    console.log();
  }

  // Step 3: Optional providers (only in full setup mode)
  if (fullSetup) {
    console.log(chalk.bold("3. Additional Providers (optional)"));
    console.log(chalk.dim("   Natural language, video generation, TTS, images, etc."));
    console.log();

    // Build list of optional providers, excluding the one already configured as primary LLM
    const allOptionalProviders = [
      { key: "openai", name: "OpenAI", desc: "NL Commands, DALL-E, Whisper" },
      { key: "anthropic", name: "Anthropic", desc: "Claude, NL Commands" },
      { key: "google", name: "Google", desc: "Gemini" },
      { key: "elevenlabs", name: "ElevenLabs", desc: "TTS & Voice" },
      { key: "runway", name: "Runway", desc: "Video Gen" },
      { key: "kling", name: "Kling", desc: "Video Gen" },
      { key: "stability", name: "Stability AI", desc: "Images" },
      { key: "replicate", name: "Replicate", desc: "Various" },
    ];

    // Get the key of the primary LLM provider to skip it
    const primaryProviderKey =
      selectedProvider === "gemini"
        ? "google"
        : selectedProvider === "claude"
        ? "anthropic"
        : selectedProvider;

    // Filter out the primary provider
    const optionalProviders = allOptionalProviders.filter(
      (p) => p.key !== primaryProviderKey
    );

    for (const provider of optionalProviders) {
      const existing = config.providers[provider.key as keyof typeof config.providers];
      const status = existing ? chalk.green("✓") : chalk.dim("○");

      const configure = await promptConfirm(
        chalk.cyan(`   ${status} ${provider.name} ${chalk.dim(`(${provider.desc})`)}?`),
        false
      );

      if (configure) {
        const key = await promptHidden(chalk.cyan(`      API key: `));
        if (key.trim()) {
          config.providers[provider.key as keyof typeof config.providers] = key.trim();
          console.log(chalk.green("      ✓ Saved"));
        }
      }
    }
    console.log();

    // Step 4: Default aspect ratio
    console.log(chalk.bold("4. Default Aspect Ratio"));
    console.log();

    const ratios = ["16:9", "9:16", "1:1", "4:5"] as const;
    const ratioLabels = [
      "16:9 (YouTube, landscape)",
      "9:16 (TikTok, Reels, Shorts)",
      "1:1 (Instagram, square)",
      "4:5 (Instagram portrait)",
    ];

    const currentRatioIndex = ratios.indexOf(config.defaults.aspectRatio);
    const ratioIndex = await promptSelect(
      chalk.cyan("   Select [1-4]: "),
      ratioLabels,
      currentRatioIndex >= 0 ? currentRatioIndex : 0
    );
    config.defaults.aspectRatio = ratios[ratioIndex];
    console.log();
  }

  // Save configuration
  await saveConfig(config);

  // Done
  console.log(chalk.dim("─".repeat(40)));
  console.log(chalk.green.bold("✓ Setup complete!"));
  console.log();
  console.log(chalk.dim(`Config: ${CONFIG_PATH}`));
  console.log();
  console.log(`Run ${chalk.cyan("vibe")} to start editing`);
  console.log(`Run ${chalk.cyan("vibe setup --full")} to configure more providers`);
  console.log();
}

/**
 * Mask API key for display
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(8)}${key.slice(-4)}`;
}
