/**
 * Setup command - Interactive configuration wizard
 */

import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { access, readFile } from "node:fs/promises";
import { parse as parseDotenv } from "dotenv";
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  CONFIG_PATH,
  type LLMProvider,
  PROVIDER_NAMES,
} from "../config/index.js";
import { exitWithError, generalError } from "./output.js";
import {
  promptHidden,
  promptSelect,
  promptConfirm,
  closeTTYStream,
  hasTTY,
} from "../utils/tty.js";
import { loadEnv } from "../utils/api-key.js";
import {
  detectedAgentHosts,
  summariseAgentHosts,
} from "../utils/agent-host-detect.js";
import { getSetupProviders } from "@vibeframe/ai-providers";

export const setupCommand = new Command("setup")
  .description("Configure VibeFrame (LLM provider, API keys)")
  .option("--reset", "Reset configuration to defaults")
  .option("--full", "Run full setup with all optional providers")
  .option("--show", "Show current configuration (for debugging)")
  .option("--claude-code", "Show Claude Code integration guide")
  .action(async (options) => {
    if (options.claudeCode) {
      await setupClaudeCode();
      return;
    }

    if (options.show) {
      await showConfig();
      return;
    }

    if (options.reset) {
      const config = createDefaultConfig();
      await saveConfig(config);
      console.log(chalk.green("✓ Configuration reset to defaults"));
      console.log(chalk.dim(`  Saved to: ${CONFIG_PATH}`));
      return;
    }

    // Check if TTY is available
    if (!hasTTY()) {
      exitWithError(generalError("Interactive setup requires a terminal.", "Run 'vibe setup' directly from your terminal."));
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

// ── AI feature definitions for mix-and-match selection ────────────────

interface AIFeatureKey {
  configKey: string;
  envVar: string;
  name: string;
  url: string;
  what: string;
}

interface AIFeature {
  label: string;
  desc: string;
  defaultProvider: string;
  alsoAvailable: string;
  keys: AIFeatureKey[];
  tryCommand: string;
}

const AI_FEATURES: AIFeature[] = [
  {
    label: "Images",
    desc: "generate + edit",
    defaultProvider: "OpenAI gpt-image-2 (Artificial Analysis #1, since v0.56)",
    alsoAvailable: "Gemini Nano Banana, Grok Imagine",
    keys: [{ configKey: "openai", envVar: "OPENAI_API_KEY", name: "OpenAI", url: "https://platform.openai.com/api-keys", what: "gpt-image-2 image generation + editing (also Whisper, Agent)" }],
    tryCommand: 'vibe generate image "a sunset over mountains" -o test.png',
  },
  {
    label: "Videos",
    desc: "generate + extend",
    defaultProvider: "fal.ai Seedance 2.0 (Artificial Analysis #2 t2v + i2v, since v0.57)",
    alsoAvailable: "Grok Imagine, Kling, Runway Gen-4.5, Google Veo",
    keys: [{ configKey: "fal", envVar: "FAL_KEY", name: "fal.ai", url: "https://fal.ai/dashboard/keys", what: "ByteDance Seedance 2.0 text-to-video and image-to-video" }],
    tryCommand: 'vibe generate video "ocean waves" -o waves.mp4',
  },
  {
    label: "Audio",
    desc: "TTS, SFX, music, voice clone",
    defaultProvider: "ElevenLabs (paid, premium quality) — falls back to local Kokoro when no key (free, since v0.54)",
    alsoAvailable: "Replicate MusicGen (music only)",
    keys: [{ configKey: "elevenlabs", envVar: "ELEVENLABS_API_KEY", name: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys", what: "Text-to-speech, sound effects, music, voice cloning (skip to use local Kokoro)" }],
    tryCommand: 'vibe generate speech "Hello world" -o hello.mp3',
  },
  {
    label: "AI editing + motion",
    desc: "captions, grade, reframe, motion graphics",
    defaultProvider: "Whisper (transcription) + Claude (reasoning)",
    alsoAvailable: "",
    keys: [
      { configKey: "openai", envVar: "OPENAI_API_KEY", name: "OpenAI", url: "https://platform.openai.com/api-keys", what: "Whisper transcription (captions, jump-cut)" },
      { configKey: "anthropic", envVar: "ANTHROPIC_API_KEY", name: "Anthropic", url: "https://console.anthropic.com/settings/keys", what: "Claude (color grade, reframe, motion graphics)" },
    ],
    tryCommand: 'vibe edit caption video.mp4 -o captioned.mp4',
  },
];

/**
 * Run the interactive setup wizard
 */
async function runSetupWizard(fullSetup = false): Promise<void> {
  console.log();
  console.log(chalk.bold.magenta("VibeFrame Setup") + chalk.dim(" — user scope"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();

  // Show detected agent hosts up-front so the user knows VibeFrame can
  // tell what they have. Informational only — never blocks setup.
  const hosts = detectedAgentHosts();
  console.log(chalk.dim(`Agent hosts: ${summariseAgentHosts(hosts)}`));
  console.log();

  // Load existing config or create default
  let config = await loadConfig();
  if (!config) {
    config = createDefaultConfig();
  }

  // If --full, run the custom provider-by-provider flow
  if (fullSetup) {
    await runCustomSetup(config);
    return;
  }

  // Step 1: What do you want to do?
  console.log(chalk.dim("Step 1 of 2"));
  console.log(chalk.bold("What would you like to do?"));
  console.log();

  const topLabels = [
    `Edit videos offline ${chalk.dim("(silence-cut, fade, noise-reduce, detect)")} ${chalk.green("no API keys")}`,
    `AI features ${chalk.dim("(pick what you need — images, videos, audio, editing)")}`,
    `Full AI pipeline ${chalk.dim("(script-to-video, highlights, auto-shorts)")}`,
    `Custom setup ${chalk.dim("(choose providers one by one)")}`,
  ];

  const topIndex = await promptSelect(chalk.cyan("  Select [1-4]: "), topLabels, 0);
  console.log();

  // ── Edit videos (FREE) ─────────────────────────────────────────────
  if (topIndex === 0) {
    await saveConfig(config);
    showComplete(config, 'vibe edit silence-cut video.mp4 -o clean.mp4');
    return;
  }

  // ── Custom setup ───────────────────────────────────────────────────
  if (topIndex === 3) {
    await runCustomSetup(config);
    return;
  }

  // ── Full AI pipeline ───────────────────────────────────────────────
  if (topIndex === 2) {
    config.llm.provider = "claude";
    const pipelineKeys: AIFeatureKey[] = [
      { configKey: "anthropic", envVar: "ANTHROPIC_API_KEY", name: "Anthropic", url: "https://console.anthropic.com/settings/keys", what: "Claude — storyboard generation + reasoning" },
      { configKey: "openai", envVar: "OPENAI_API_KEY", name: "OpenAI", url: "https://platform.openai.com/api-keys", what: "gpt-image-2 image generation (default since v0.56) + Whisper word-level transcribe" },
      { configKey: "fal", envVar: "FAL_KEY", name: "fal.ai", url: "https://fal.ai/dashboard/keys", what: "Seedance 2.0 — video generation, default since v0.57" },
      { configKey: "elevenlabs", envVar: "ELEVENLABS_API_KEY", name: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys", what: "Text-to-speech narration + music (skip to use local Kokoro)" },
    ];

    console.log(chalk.dim("Step 2 of 2"));
    console.log(chalk.bold("Pipeline requires these API keys:"));
    console.log(chalk.dim("  Saved locally, never shared. Press Enter to skip."));
    console.log();

    await collectKeys(config, pipelineKeys);

    await saveConfig(config);
    showComplete(config, 'vibe pipeline script-to-video "A day in the life..." -o ./output/');
    return;
  }

  // ── AI generation (mix and match) ──────────────────────────────────
  console.log(chalk.dim("Step 2 of 2"));
  console.log(chalk.bold("Which AI features do you need?"));
  console.log(chalk.dim("  Select each one you want to use."));
  console.log();

  const selectedFeatures: AIFeature[] = [];
  for (const feature of AI_FEATURES) {
    const keyCount = feature.keys.length;
    const tag = chalk.dim(`${keyCount} key${keyCount > 1 ? "s" : ""}`);
    const yes = await promptConfirm(
      chalk.cyan(`  ${feature.label} ${chalk.dim(`(${feature.desc})`)} ${tag}`),
      true
    );
    if (yes) {
      selectedFeatures.push(feature);
    }
  }
  console.log();

  if (selectedFeatures.length === 0) {
    console.log(chalk.dim("  No features selected. You can re-run setup anytime."));
    console.log();
    await saveConfig(config);
    showComplete(config, 'vibe --help', []);
    return;
  }

  // Collect keys feature-by-feature with context
  console.log(chalk.bold("API Keys"));
  console.log(chalk.dim("  Saved locally, never shared. Press Enter to skip."));
  console.log();

  // Track already-collected keys to avoid asking twice
  const collectedKeys = new Set<string>();

  for (const feature of selectedFeatures) {
    // Feature header
    console.log(chalk.bold.cyan(`  ${feature.label}`));
    console.log(chalk.dim(`  Default: ${feature.defaultProvider}`));
    if (feature.alsoAvailable) {
      console.log(chalk.dim(`  Also available: ${feature.alsoAvailable}`));
    }
    console.log();

    for (const keyDef of feature.keys) {
      // Skip if already collected for a previous feature
      if (collectedKeys.has(keyDef.configKey)) {
        console.log(`  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} (already set above)`);
        continue;
      }

      // Check existing config / .env
      loadEnv();
      const configValue = config.providers[keyDef.configKey as keyof typeof config.providers];
      const envValue = process.env[keyDef.envVar];

      if (configValue || envValue) {
        const value = configValue || envValue!;
        const source = configValue ? "config" : ".env";
        console.log(`  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(value)} ${chalk.dim(`(${source})`)}`);
        collectedKeys.add(keyDef.configKey);
        continue;
      }

      // Show what this key is for + where to get it
      console.log(chalk.dim(`  ${keyDef.what}`));
      console.log(chalk.dim(`  Get key: ${keyDef.url}`));
      const newKey = await promptHidden(chalk.cyan(`  ${keyDef.name.padEnd(14)} ${chalk.dim(keyDef.envVar)}: `));
      if (newKey.trim()) {
        config.providers[keyDef.configKey as keyof typeof config.providers] = newKey.trim();
        console.log(`  ${chalk.green("✓")} Saved`);
        collectedKeys.add(keyDef.configKey);
      } else {
        console.log(`  ${chalk.yellow("⚠")} Skipped ${chalk.dim(`(set ${keyDef.envVar} in .env later)`)}`);
      }
    }
    console.log();
  }

  await saveConfig(config);
  showComplete(config, selectedFeatures[0].tryCommand, selectedFeatures);
}

/**
 * Collect API keys, skipping already-configured ones (checks config + .env + env vars)
 */
async function collectKeys(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  keys: AIFeatureKey[]
): Promise<void> {
  loadEnv();

  for (const keyDef of keys) {
    const configValue = config.providers[keyDef.configKey as keyof typeof config.providers];
    const envValue = process.env[keyDef.envVar];

    if (configValue) {
      console.log(`  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(configValue)} ${chalk.dim("(config)")}`);
      continue;
    }
    if (envValue) {
      console.log(`  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(envValue)} ${chalk.dim("(.env)")}`);
      continue;
    }

    console.log(chalk.dim(`  ${keyDef.what}`));
    console.log(chalk.dim(`  Get key: ${keyDef.url}`));
    const newKey = await promptHidden(chalk.cyan(`  ${keyDef.name.padEnd(14)} ${chalk.dim(keyDef.envVar)}: `));
    if (newKey.trim()) {
      config.providers[keyDef.configKey as keyof typeof config.providers] = newKey.trim();
      console.log(`  ${chalk.green("✓")} Saved`);
    } else {
      console.log(`  ${chalk.yellow("⚠")} Skipped ${chalk.dim(`(set ${keyDef.envVar} in .env later)`)}`);
    }
  }
  console.log();
}

/**
 * Custom setup — provider-by-provider (old --full flow)
 */
async function runCustomSetup(config: Awaited<ReturnType<typeof loadConfig>> & object): Promise<void> {
  // LLM Provider selection (for Agent mode only)
  console.log(chalk.bold("1. Agent LLM Provider") + chalk.dim(" (for vibe agent)"));
  console.log(chalk.dim("   Only needed if you use the interactive Agent mode."));
  console.log();

  const providers: LLMProvider[] = ["claude", "openai", "gemini", "xai", "openrouter", "ollama"];
  const providerDescriptions: Record<LLMProvider, string> = {
    claude: "Best reasoning, most capable for complex tasks",
    openai: "GPT-5-mini, reliable and fast, good default",
    gemini: "Google AI, strong multimodal understanding",
    xai: "Grok 4.1 Fast, 2M context, great for tool calling",
    openrouter: "300+ models via one API key (Claude, GPT, Gemini, Llama, etc.)",
    ollama: "Free, local, no API key — offline capable (default: llama3.2)",
  };
  const providerLabels = providers.map((p) => {
    const rec = p === "claude" ? chalk.dim(" (recommended)") : "";
    return `${PROVIDER_NAMES[p]}${rec} ${chalk.dim(`- ${providerDescriptions[p]}`)}`;
  });

  const currentIndex = providers.indexOf(config.llm.provider);
  const providerIndex = await promptSelect(
    chalk.cyan("   Select [1-6]: "),
    providerLabels,
    currentIndex >= 0 ? currentIndex : 0
  );
  config.llm.provider = providers[providerIndex];
  console.log();

  // Collect all provider keys
  console.log(chalk.bold("2. API Keys"));
  console.log(chalk.dim("   Press Enter to skip any provider you don't need."));
  console.log();

  // Derived from the provider registry — adding/editing a row means
  // editing `defineApiKey({...setupDescription})` in
  // `packages/ai-providers/src/api-keys.ts`. The order follows declaration
  // order in api-keys.ts.
  const allProviders = getSetupProviders();

  for (const p of allProviders) {
    const existing = config.providers[p.key as keyof typeof config.providers];
    if (existing) {
      console.log(`  ${chalk.green("✓")} ${p.name.padEnd(12)} ${maskApiKey(existing)} ${chalk.dim(p.desc)}`);
      const change = await promptConfirm(chalk.cyan("    Update?"), false);
      if (change) {
        const newKey = await promptHidden(chalk.cyan("    New key: "));
        if (newKey.trim()) {
          config.providers[p.key as keyof typeof config.providers] = newKey.trim();
          console.log(chalk.green("    ✓ Updated"));
        }
      }
    } else {
      const newKey = await promptHidden(chalk.cyan(`  ${chalk.dim("○")} ${p.name.padEnd(12)} ${chalk.dim(p.desc)}: `));
      if (newKey.trim()) {
        config.providers[p.key as keyof typeof config.providers] = newKey.trim();
        console.log(`  ${chalk.green("✓")} Saved`);
      }
    }
  }
  console.log();

  // Save
  await saveConfig(config);
  showComplete(config, "vibe doctor");
}

/**
 * Show completion message with contextual "try it" commands
 */
function showComplete(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  defaultTryCommand: string,
  features: AIFeature[] = []
): void {
  console.log(chalk.dim("─".repeat(40)));
  console.log(chalk.green.bold("✓ Setup complete!"));
  console.log();
  console.log(chalk.dim(`  Config: ${CONFIG_PATH}`));
  console.log();

  if (features.length > 1) {
    console.log(chalk.bold("  Try these:"));
    for (const f of features) {
      console.log(`    ${chalk.cyan(f.tryCommand)}`);
    }
  } else {
    console.log(`  Try: ${chalk.cyan(defaultTryCommand)}`);
  }
  console.log();
  console.log(chalk.bold("  Next steps:"));
  console.log(chalk.dim("    cd <project>; vibe init   Scaffold AGENTS.md / CLAUDE.md / .env.example (project scope)"));
  console.log(chalk.dim("    vibe doctor               Check system health + available commands"));
  console.log(chalk.dim("    vibe schema --list        Discover all 69 commands"));
  console.log(chalk.dim("    vibe setup                Re-run user-scope setup anytime"));

  // Tailored hint when an agent host is detected — points at the file
  // `vibe init` will scaffold for that host.
  const hosts = detectedAgentHosts();
  const primary = hosts[0];
  if (primary) {
    console.log();
    console.log(
      chalk.dim(
        `  Detected ${primary.label} — \`vibe init\` will scaffold ${primary.projectFiles.join(" + ")} in your project.`,
      ),
    );
  }
  console.log();
}

/**
 * Show Claude Code integration instructions
 */
async function setupClaudeCode(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("Claude Code Integration"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();
  console.log("  VibeFrame CLI is self-discoverable — no extra setup needed.");
  console.log("  Claude Code can use these commands to understand the CLI:");
  console.log();
  console.log(`  ${chalk.green("vibe --help")}                  All command groups`);
  console.log(`  ${chalk.green("vibe schema --list --json")}    Full command catalog`);
  console.log(`  ${chalk.green("vibe schema generate.video")}   JSON Schema for any command`);
  console.log(`  ${chalk.green("vibe doctor --json")}           Available providers`);
  console.log();
  console.log(chalk.dim("  Global flags: --json, --dry-run, --stdin, --fields"));
  console.log();
}

/**
 * Mask API key for display
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}${"*".repeat(8)}${key.slice(-4)}`;
}

/**
 * Show current configuration for debugging
 */
async function showConfig(): Promise<void> {
  // Load CWD .env before showing config
  loadEnv();

  const cwdEnvPath = resolve(process.cwd(), ".env");
  let hasCwdEnv = false;
  try {
    await access(cwdEnvPath);
    hasCwdEnv = true;
  } catch {
    // no .env in CWD
  }

  console.log();
  console.log(chalk.bold.magenta("VibeFrame Configuration"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();
  console.log(chalk.dim(`Config file: ${CONFIG_PATH}`));
  if (hasCwdEnv) {
    console.log(chalk.dim(`Project .env: ${cwdEnvPath}`));
  }
  console.log();

  const config = await loadConfig();

  // Parse .env file directly to know which keys are in it
  let dotenvKeys: Record<string, string> = {};
  if (hasCwdEnv) {
    try {
      const envContent = await readFile(cwdEnvPath, "utf-8");
      dotenvKeys = parseDotenv(Buffer.from(envContent));
    } catch {
      // ignore parse errors
    }
  }

  if (!config && !hasCwdEnv) {
    console.log(chalk.yellow("No configuration found."));
    console.log(chalk.dim("Run 'vibe setup' or create .env in your project directory."));
    return;
  }

  // Show LLM provider
  if (config) {
    console.log(chalk.bold("LLM Provider:"));
    console.log(`  ${PROVIDER_NAMES[config.llm.provider]}`);
    console.log();
  }

  // Show API keys (masked) with accurate source detection
  console.log(chalk.bold("API Keys:"));
  const providerKeys = [
    { key: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY" },
    { key: "openai", name: "OpenAI", env: "OPENAI_API_KEY" },
    { key: "google", name: "Google", env: "GOOGLE_API_KEY" },
    { key: "xai", name: "xAI", env: "XAI_API_KEY" },
    { key: "fal", name: "fal.ai", env: "FAL_KEY" },
    { key: "elevenlabs", name: "ElevenLabs", env: "ELEVENLABS_API_KEY" },
    { key: "runway", name: "Runway", env: "RUNWAY_API_SECRET" },
    { key: "kling", name: "Kling", env: "KLING_API_KEY" },
    { key: "imgbb", name: "ImgBB", env: "IMGBB_API_KEY" },
    { key: "replicate", name: "Replicate", env: "REPLICATE_API_TOKEN" },
    { key: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY" },
  ];

  for (const p of providerKeys) {
    const configValue = config?.providers[p.key as keyof typeof config.providers];
    const dotenvValue = dotenvKeys[p.env];

    if (configValue || dotenvValue) {
      // Show effective value (config wins) and all sources
      const sources: string[] = [];
      if (configValue) sources.push("config");
      if (dotenvValue) sources.push(".env");
      const value = configValue || dotenvValue;
      const status = chalk.green("✓");
      console.log(`  ${status} ${p.name.padEnd(12)} ${maskApiKey(value)} (${sources.join(" + ")})`);
    } else {
      const status = chalk.dim("○");
      console.log(`  ${status} ${p.name.padEnd(12)} ${chalk.dim("not set")}`);
    }
  }
  console.log();

  // Show defaults
  if (config) {
    console.log(chalk.bold("Defaults:"));
    console.log(`  Aspect Ratio: ${config.defaults.aspectRatio}`);
    console.log(`  Export Quality: ${config.defaults.exportQuality}`);
    console.log();
  }

  // Show resolution order
  console.log(chalk.bold("Resolution order:"));
  console.log(chalk.dim("  1. --api-key CLI option"));
  console.log(chalk.dim(`  2. ${CONFIG_PATH}`));
  console.log(chalk.dim("  3. .env in current directory"));
  console.log(chalk.dim("  4. Shell environment variables"));
  console.log();
}
