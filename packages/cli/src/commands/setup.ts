/**
 * Setup command - Interactive configuration wizard
 */

import { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { parse as parseDotenv } from "dotenv";
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  USER_CONFIG_PATH,
  getConfigPath,
  getActiveScope,
  type LLMProvider,
  type Scope,
  PROVIDER_NAMES,
} from "../config/index.js";
import { exitWithError, generalError } from "./output.js";
import {
  prompt,
  promptHidden,
  promptSelect,
  promptConfirm,
  promptMultiSelect,
  closeTTYStream,
  hasTTY,
} from "../utils/tty.js";
import { loadEnv } from "../utils/api-key.js";
import { validateKeyFormat } from "../utils/key-format.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { detectedAgentHosts, summariseAgentHosts } from "../utils/agent-host-detect.js";
import { getSetupProviders, getAllApiKeys, type ApiKeyMeta } from "@vibeframe/ai-providers";
import { listWalkthroughs } from "./_shared/walkthroughs/walkthroughs.js";

const VALID_LLM_PROVIDERS: readonly LLMProvider[] = [
  "claude",
  "openai",
  "gemini",
  "ollama",
  "xai",
  "openrouter",
];

const VALID_SCOPES: readonly Scope[] = ["user", "project"];

function envValueFor(meta: Pick<ApiKeyMeta, "envVar" | "envAliases">): string | undefined {
  return (
    process.env[meta.envVar] ||
    meta.envAliases?.map((alias: string) => process.env[alias]).find(Boolean)
  );
}

function envValueForName(envVar: string): string | undefined {
  return process.env[envVar];
}

function parseScope(raw: unknown): Scope {
  const v = String(raw ?? "user");
  if (!VALID_SCOPES.includes(v as Scope)) {
    exitWithError(
      generalError(`Invalid --scope: ${v}`, `Must be one of: ${VALID_SCOPES.join(", ")}`)
    );
  }
  return v as Scope;
}

export const setupCommand = new Command("setup")
  .description("Configure VibeFrame (LLM provider, API keys)")
  .option("--reset", "Reset configuration to defaults")
  .option("--full", "Run full setup with all optional providers")
  .option("--show", "Show current configuration (for debugging)")
  .option(
    "-v, --verbose",
    "With --show: include unset providers + Resolution order + Defaults block"
  )
  .option("--claude-code", "Show Claude Code integration guide")
  .option("-y, --yes", "Non-interactive: write config without prompting (CI / devcontainer)")
  .option(
    "--provider <id>",
    "Set the Agent LLM provider (claude | openai | gemini | xai | openrouter | ollama)"
  )
  .option("--import-env", "Promote API keys from .env / shell env into config.yaml")
  .option("--test", "After save, live-test each configured key (exits 7 if any FAIL)")
  .option(
    "--scope <scope>",
    "Where to save: 'user' (~/.vibeframe/config.yaml, shared) or 'project' (./.vibeframe/config.yaml, gitignored, this project only)",
    "user"
  )
  .addHelpText(
    "after",
    `
Non-interactive examples (no TTY required):
  vibe setup --yes --provider claude --import-env         Bootstrap CI / devcontainer
  vibe setup --yes --import-env --test                    Persist .env keys + verify each one
  vibe setup --yes --provider openai                      Just switch the agent provider
  vibe setup --scope project --yes --import-env           Project-only setup (./.vibeframe/config.yaml)

Scopes:
  user    (default) ~/.vibeframe/config.yaml — shared across every project
  project ./.vibeframe/config.yaml — gitignored, isolates keys/defaults to this directory
          When a project config exists at the cwd, it is used and the user file is ignored.

Exit codes (non-interactive):
  0  success                7  --test verification failed (one or more keys returned non-2xx)
  2  usage error            (other codes match the rest of the CLI: 4/5/6 = auth/api/network)
`
  )
  .action(async (options) => {
    if (options.claudeCode) {
      await setupClaudeCode();
      return;
    }

    if (options.show) {
      await showConfig({ verbose: Boolean(options.verbose) });
      return;
    }

    const scope = parseScope(options.scope);

    if (options.reset) {
      const config = createDefaultConfig();
      await saveConfig(config, { scope });
      console.log(chalk.green("✓ Configuration reset to defaults"));
      console.log(chalk.dim(`  Saved to: ${getConfigPath(scope)}`));
      return;
    }

    // Non-interactive path: --yes (or no-TTY combined with --provider/--import-env)
    const wantsNonInteractive =
      Boolean(options.yes) || (!hasTTY() && (options.provider || options.importEnv));
    if (wantsNonInteractive) {
      await runNonInteractiveSetup({
        provider: options.provider,
        importEnv: Boolean(options.importEnv),
        test: Boolean(options.test),
        scope,
      });
      return;
    }

    // Check if TTY is available
    if (!hasTTY()) {
      exitWithError(
        generalError(
          "Interactive setup requires a terminal.",
          "Run 'vibe setup' directly from your terminal, or use 'vibe setup --yes --provider <id> --import-env' for CI."
        )
      );
    }

    try {
      await runSetupWizard(options.full, scope);
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

interface AIFeatureProviderChoice {
  label: string;
  desc: string;
  key?: AIFeatureKey;
  extraKeys?: AIFeatureKey[];
  keyless?: boolean;
  defaultFor?: {
    kind: "image" | "video";
    value: string;
  };
}

interface AIFeature {
  label: string;
  desc: string;
  defaultProvider: string;
  alsoAvailable: string;
  keyHint?: string;
  keys: AIFeatureKey[];
  providerChoices?: AIFeatureProviderChoice[];
  tryCommand: string;
}

const AI_FEATURES: AIFeature[] = [
  {
    label: "Images",
    desc: "generate + edit",
    defaultProvider: "OpenAI gpt-image-2 (Artificial Analysis #1, since v0.56)",
    alsoAvailable: "Gemini Nano Banana, Grok Imagine",
    keyHint: "1 key",
    keys: [
      {
        configKey: "openai",
        envVar: "OPENAI_API_KEY",
        name: "OpenAI",
        url: "https://platform.openai.com/api-keys",
        what: "gpt-image-2 image generation + editing (also Whisper, Agent)",
      },
    ],
    providerChoices: [
      {
        label: "OpenAI gpt-image-2",
        desc: "recommended default, image generation + editing",
        key: {
          configKey: "openai",
          envVar: "OPENAI_API_KEY",
          name: "OpenAI",
          url: "https://platform.openai.com/api-keys",
          what: "gpt-image-2 image generation + editing (also Whisper, Agent)",
        },
        defaultFor: { kind: "image", value: "openai" },
      },
      {
        label: "Gemini",
        desc: "Google image generation + multimodal analysis",
        key: {
          configKey: "google",
          envVar: "GOOGLE_API_KEY",
          name: "Google",
          url: "https://aistudio.google.com/apikey",
          what: "Gemini image generation and multimodal analysis",
        },
        defaultFor: { kind: "image", value: "gemini" },
      },
      {
        label: "Grok",
        desc: "xAI image generation",
        key: {
          configKey: "xai",
          envVar: "XAI_API_KEY",
          name: "xAI",
          url: "https://console.x.ai/",
          what: "Grok image generation and Agent",
        },
        defaultFor: { kind: "image", value: "grok" },
      },
    ],
    tryCommand: 'vibe generate image "a sunset over mountains" -o test.png',
  },
  {
    label: "Videos",
    desc: "generate + extend",
    defaultProvider: "Seedance 2.0 via fal.ai (Artificial Analysis #2 t2v + i2v, since v0.57)",
    alsoAvailable: "Grok Imagine, Kling, Runway Gen-4.5, Google Veo",
    keyHint: "1-2 keys",
    keys: [
      {
        configKey: "fal",
        envVar: "FAL_API_KEY",
        name: "Seedance 2.0 (via fal.ai)",
        url: "https://fal.ai/dashboard/keys",
        what: "ByteDance Seedance 2.0 text-to-video and image-to-video",
      },
    ],
    providerChoices: [
      {
        label: "Seedance 2.0 via fal.ai",
        desc: "recommended default, text-to-video + image-to-video",
        key: {
          configKey: "fal",
          envVar: "FAL_API_KEY",
          name: "Seedance 2.0 (via fal.ai)",
          url: "https://fal.ai/dashboard/keys",
          what: "ByteDance Seedance 2.0 text-to-video and image-to-video",
        },
        extraKeys: [
          {
            configKey: "imgbb",
            envVar: "IMGBB_API_KEY",
            name: "ImgBB",
            url: "https://api.imgbb.com/",
            what: "Image hosting for Seedance image-to-video uploads",
          },
        ],
        defaultFor: { kind: "video", value: "seedance" },
      },
      {
        label: "Grok",
        desc: "xAI video generation with audio",
        key: {
          configKey: "xai",
          envVar: "XAI_API_KEY",
          name: "xAI",
          url: "https://console.x.ai/",
          what: "Grok video generation and Agent",
        },
        defaultFor: { kind: "video", value: "grok" },
      },
      {
        label: "Kling",
        desc: "Kling v2.5/v3 video generation",
        key: {
          configKey: "kling",
          envVar: "KLING_API_KEY",
          name: "Kling",
          url: "https://platform.klingai.com/",
          what: "Kling video generation",
        },
        extraKeys: [
          {
            configKey: "imgbb",
            envVar: "IMGBB_API_KEY",
            name: "ImgBB",
            url: "https://api.imgbb.com/",
            what: "Image hosting for Kling image-to-video uploads",
          },
        ],
        defaultFor: { kind: "video", value: "kling" },
      },
      {
        label: "Runway",
        desc: "Runway Gen-4.5 video generation",
        key: {
          configKey: "runway",
          envVar: "RUNWAY_API_SECRET",
          name: "Runway",
          url: "https://app.runwayml.com/settings/api-keys",
          what: "Runway Gen-4.5 video generation",
        },
        defaultFor: { kind: "video", value: "runway" },
      },
      {
        label: "Veo",
        desc: "Google Veo video generation",
        key: {
          configKey: "google",
          envVar: "GOOGLE_API_KEY",
          name: "Google",
          url: "https://aistudio.google.com/apikey",
          what: "Google Veo video generation",
        },
        defaultFor: { kind: "video", value: "veo" },
      },
    ],
    tryCommand: 'vibe generate video "ocean waves" -o waves.mp4',
  },
  {
    label: "Audio",
    desc: "TTS, SFX, music, voice clone",
    defaultProvider:
      "ElevenLabs (paid, premium quality) — falls back to local Kokoro when no key (free, since v0.54)",
    alsoAvailable: "Replicate MusicGen (music only)",
    keyHint: "0-1 key",
    keys: [
      {
        configKey: "elevenlabs",
        envVar: "ELEVENLABS_API_KEY",
        name: "ElevenLabs",
        url: "https://elevenlabs.io/app/settings/api-keys",
        what: "Text-to-speech, sound effects, music, voice cloning (skip to use local Kokoro)",
      },
    ],
    providerChoices: [
      {
        label: "ElevenLabs",
        desc: "premium TTS, SFX, music, voice clone",
        key: {
          configKey: "elevenlabs",
          envVar: "ELEVENLABS_API_KEY",
          name: "ElevenLabs",
          url: "https://elevenlabs.io/app/settings/api-keys",
          what: "Text-to-speech, sound effects, music, voice cloning",
        },
      },
      {
        label: "Kokoro local",
        desc: "free local TTS fallback, no API key",
        keyless: true,
      },
      {
        label: "Replicate MusicGen",
        desc: "background music generation",
        key: {
          configKey: "replicate",
          envVar: "REPLICATE_API_TOKEN",
          name: "Replicate",
          url: "https://replicate.com/account/api-tokens",
          what: "MusicGen background music",
        },
      },
    ],
    tryCommand: 'vibe generate speech "Hello world" -o hello.mp3',
  },
  {
    label: "AI editing + motion",
    desc: "captions, grade, reframe, motion graphics",
    defaultProvider: "Whisper (transcription) + Claude (reasoning)",
    alsoAvailable: "",
    keyHint: "2 keys",
    keys: [
      {
        configKey: "openai",
        envVar: "OPENAI_API_KEY",
        name: "OpenAI",
        url: "https://platform.openai.com/api-keys",
        what: "Whisper transcription (captions, jump-cut)",
      },
      {
        configKey: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        name: "Anthropic",
        url: "https://console.anthropic.com/settings/keys",
        what: "Claude (color grade, reframe, motion graphics)",
      },
    ],
    tryCommand: "vibe edit caption video.mp4 -o captioned.mp4",
  },
];

function addUniqueKey(keys: AIFeatureKey[], keyDef: AIFeatureKey): void {
  if (!keys.some((k) => k.configKey === keyDef.configKey)) {
    keys.push(keyDef);
  }
}

function applyProviderDefault(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  choice: AIFeatureProviderChoice
): void {
  if (!choice.defaultFor) return;
  if (choice.defaultFor.kind === "image") {
    config.defaults.imageProvider = choice.defaultFor.value as NonNullable<
      typeof config.defaults.imageProvider
    >;
  } else {
    config.defaults.videoProvider = choice.defaultFor.value as NonNullable<
      typeof config.defaults.videoProvider
    >;
  }
}

function isProviderChoiceConfigured(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  choice: AIFeatureProviderChoice
): boolean {
  if (choice.key) {
    const value = config.providers[choice.key.configKey as keyof typeof config.providers];
    if (value) return true;
  }
  if (choice.defaultFor?.kind === "image") {
    return config.defaults.imageProvider === choice.defaultFor.value;
  }
  if (choice.defaultFor?.kind === "video") {
    return config.defaults.videoProvider === choice.defaultFor.value;
  }
  return false;
}

function getConfiguredUploadProvider(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>
): "imgbb" | "s3" {
  return process.env.VIBE_UPLOAD_PROVIDER?.toLowerCase() === "s3" || config.upload.provider === "s3"
    ? "s3"
    : "imgbb";
}

function hasVideoFeature(features: AIFeature[]): boolean {
  return features.some((feature) => feature.label === "Videos");
}

async function promptOptionalValue(
  label: string,
  currentValue: string | undefined
): Promise<string | undefined> {
  const suffix = currentValue ? chalk.dim(` [${currentValue}]`) : "";
  const value = await prompt(chalk.cyan(`  ${label}${suffix}: `));
  const trimmed = value.trim();
  return trimmed || currentValue;
}

async function configureUploadHost(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>
): Promise<"continue" | "back"> {
  console.log(chalk.dim("2b. Upload host"));
  console.log(chalk.bold("Where should image-to-video upload reference images?"));
  console.log(
    chalk.dim(
      "  Seedance and Kling need a temporary HTTPS image URL when you start from a local image."
    )
  );
  console.log();

  const currentProvider = getConfiguredUploadProvider(config);
  const selected = await promptSelect(
    chalk.cyan("  Upload host [1-3]: "),
    [
      `ImgBB ${chalk.dim("- easiest setup, third-party image hosting (default)")}`,
      `S3 ${chalk.dim("- your own bucket, better control/privacy")}`,
      `Back ${chalk.dim("(choose different features)")}`,
    ],
    currentProvider === "s3" ? 1 : 0,
    { backIndex: 2 }
  );
  console.log();

  if (selected === 2) {
    return "back";
  }

  if (selected === 0) {
    config.upload.provider = "imgbb";
    process.env.VIBE_UPLOAD_PROVIDER = "imgbb";
    console.log(chalk.dim("  ImgBB selected. Seedance/Kling setup will ask for IMGBB_API_KEY."));
    console.log();
    return "continue";
  }

  config.upload.provider = "s3";
  process.env.VIBE_UPLOAD_PROVIDER = "s3";
  config.upload.s3 = config.upload.s3 ?? {};
  const envBucket = process.env.VIBE_UPLOAD_S3_BUCKET;
  const envRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  const envPrefix = process.env.VIBE_UPLOAD_S3_PREFIX;
  const envTtl = process.env.VIBE_UPLOAD_TTL_SECONDS;

  console.log(chalk.dim("  S3 selected. AWS credentials stay in your shell/.env/AWS profile."));
  console.log(chalk.dim("  Required at runtime: AWS credentials, region, and bucket."));
  console.log();

  const bucket = await promptOptionalValue("S3 bucket", envBucket ?? config.upload.s3.bucket);
  const region = await promptOptionalValue("AWS region", envRegion ?? config.upload.s3.region);
  const prefix = await promptOptionalValue(
    "S3 prefix",
    envPrefix ?? config.upload.s3.prefix ?? "vibeframe/tmp"
  );
  const ttlValue = await promptOptionalValue(
    "Upload URL TTL seconds",
    envTtl ?? String(config.upload.ttlSeconds ?? 3600)
  );

  if (bucket) config.upload.s3.bucket = bucket;
  if (region) config.upload.s3.region = region;
  if (prefix) config.upload.s3.prefix = prefix;
  const ttlSeconds = ttlValue ? Number.parseInt(ttlValue, 10) : NaN;
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    config.upload.ttlSeconds = ttlSeconds;
  }

  if (!config.upload.s3.bucket || !config.upload.s3.region) {
    console.log(
      chalk.yellow(
        "  ⚠ S3 selected, but bucket/region is incomplete. Set VIBE_UPLOAD_S3_BUCKET and AWS_REGION before image-to-video."
      )
    );
  } else {
    console.log(
      `  ${chalk.green("✓")} S3 upload host configured ${chalk.dim(`(${config.upload.s3.bucket}/${config.upload.s3.prefix ?? "vibeframe/tmp"})`)}`
    );
  }
  console.log();
  return "continue";
}

function getChoiceExtraKeys(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  choice: AIFeatureProviderChoice
): AIFeatureKey[] {
  if (config.upload.provider === "s3") {
    return [];
  }
  return choice.extraKeys ?? [];
}

function isFeatureConfigured(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  feature: AIFeature
): boolean {
  if (feature.providerChoices?.some((choice) => isProviderChoiceConfigured(config, choice))) {
    return true;
  }
  return feature.keys.some((keyDef) =>
    Boolean(config.providers[keyDef.configKey as keyof typeof config.providers])
  );
}

function mergeSelectedFeatures(current: AIFeature[], next: AIFeature[]): AIFeature[] {
  const merged = [...current];
  for (const feature of next) {
    if (!merged.some((f) => f.label === feature.label)) {
      merged.push(feature);
    }
  }
  return merged;
}

/**
 * Non-interactive setup for CI / devcontainer / scripted bootstrap.
 *
 * Exits 0 even when no fields are touched — running `vibe setup --yes` with no
 * other flags is a valid "ensure config file exists" idempotency op, similar
 * to `git init`. Prints a one-line summary so callers can grep for it.
 */
interface NonInteractiveOptions {
  provider?: string;
  importEnv?: boolean;
  test?: boolean;
  scope?: Scope;
}

async function runNonInteractiveSetup(opts: NonInteractiveOptions): Promise<void> {
  const scope: Scope = opts.scope ?? "user";
  let config = await loadConfig({ scope });
  if (!config) {
    config = createDefaultConfig();
  }

  const changes: string[] = [];

  if (opts.provider) {
    if (!VALID_LLM_PROVIDERS.includes(opts.provider as LLMProvider)) {
      exitWithError(
        generalError(
          `Invalid --provider: ${opts.provider}`,
          `Must be one of: ${VALID_LLM_PROVIDERS.join(", ")}`
        )
      );
    }
    if (config.llm.provider !== opts.provider) {
      config.llm.provider = opts.provider as LLMProvider;
      changes.push(`provider=${opts.provider}`);
    }
  }

  const warnings: string[] = [];
  let importedCount = 0;
  if (opts.importEnv) {
    loadEnv();
    for (const meta of getAllApiKeys()) {
      const envValue = envValueFor(meta);
      if (!envValue) continue;
      const existing = config.providers[meta.configKey as keyof typeof config.providers];
      if (existing === envValue) continue;
      const fmt = validateKeyFormat(meta.configKey, envValue);
      if (!fmt.ok && fmt.expected) {
        warnings.push(`${meta.label}: format looks unusual (expected ${fmt.expected})`);
      }
      config.providers[meta.configKey as keyof typeof config.providers] = envValue;
      importedCount++;
    }
    if (importedCount > 0) {
      changes.push(`imported ${importedCount} key${importedCount === 1 ? "" : "s"} from env`);
    }
  }

  await saveConfig(config, { scope });

  // Output: one structured line per change, plus warnings on stderr.
  console.log(chalk.green(`✓ Setup complete (non-interactive, ${scope} scope)`));
  console.log(chalk.dim(`  Config: ${getConfigPath(scope)}`));
  if (changes.length > 0) {
    for (const c of changes) {
      console.log(chalk.dim(`  ${c}`));
    }
  } else {
    console.log(chalk.dim("  No changes (config already up to date)"));
  }
  for (const w of warnings) {
    console.error(chalk.yellow(`⚠ ${w}`));
  }

  // --test: live-validate every configured key. Exits 7 (verification
  // failed) if any provider returned a non-2xx response, so CI scripts
  // can `vibe setup --yes --import-env --test || exit 1` and catch
  // bad keys before the first paid call.
  if (opts.test) {
    const { testKey } = await import("../utils/key-live-test.js");
    console.log();
    console.log(chalk.bold("Live key tests"));
    let failures = 0;
    let tested = 0;
    for (const meta of getAllApiKeys()) {
      const value = config.providers[meta.configKey as keyof typeof config.providers];
      if (!value) continue;
      tested++;
      const result = await testKey(meta.configKey, value);
      const label = meta.label.padEnd(12);
      if (result.skipped) {
        console.log(chalk.dim(`  SKIP  ${label} ${result.message ?? "no test available"}`));
      } else if (result.ok) {
        console.log(chalk.green(`  ✓     ${label}`) + chalk.dim(` ${result.status}`));
      } else {
        failures++;
        const detail = result.message ?? `status ${result.status ?? "?"}`;
        console.log(chalk.red(`  ✗     ${label}`) + chalk.dim(` ${detail}`));
      }
    }
    if (tested === 0) {
      console.log(chalk.dim("  (no keys configured to test)"));
    }
    if (failures > 0) {
      console.error();
      console.error(
        chalk.red(
          `Verification failed: ${failures} key${failures === 1 ? "" : "s"} returned non-2xx.`
        )
      );
      process.exit(7);
    }
  }
}

/**
 * Run the interactive setup wizard
 */
async function runSetupWizard(fullSetup = false, scope: Scope = "user"): Promise<void> {
  console.log();
  loadEnv();
  const cfgPath = getConfigPath(scope).replace(homedir(), "~");
  const scopeNote =
    scope === "project"
      ? "applies to this project only · add .vibeframe/ to .gitignore"
      : "applies to every project for this user";
  console.log(chalk.bold.magenta("VibeFrame Setup") + chalk.bold(` — ${scope} scope`));
  console.log(chalk.dim(`${cfgPath} · ${scopeNote}`));
  if (scope === "user") {
    console.log(
      chalk.dim("Tip: for per-project keys, cd into a project and run: vibe setup --scope project")
    );
  }
  console.log(chalk.dim("─".repeat(40)));
  console.log();

  // Show detected agent hosts up-front so the user knows VibeFrame can
  // tell what they have. Informational only — never blocks setup.
  const hosts = detectedAgentHosts();
  console.log(chalk.dim(`Agent hosts: ${summariseAgentHosts(hosts)}`));
  console.log();

  // Load existing config or create default
  let config = await loadConfig({ scope });
  if (!config) {
    config = createDefaultConfig();
  }

  // If --full, run the custom provider-by-provider flow
  if (fullSetup) {
    await runCustomSetup(config, scope);
    return;
  }

  // Step 1: What do you want to do?
  console.log(chalk.dim("1. Goal"));
  console.log(chalk.bold("What would you like to do?"));
  console.log();

  const topLabels = [
    `Edit videos offline ${chalk.dim("(silence-cut, fade, noise-reduce, detect)")} ${chalk.green("no API keys")}`,
    `AI features ${chalk.dim("(pick what you need — images, videos, audio, editing)")}`,
    `Full AI pipeline ${chalk.dim("(build, remix highlights, auto-shorts)")}`,
    `Full provider list ${chalk.dim("(every supported provider, one by one — same as --full)")}`,
  ];

  const topIndex = await promptSelect(chalk.cyan("  Select [1-4]: "), topLabels, 0);
  console.log();

  // ── Edit videos (FREE) ─────────────────────────────────────────────
  if (topIndex === 0) {
    await saveConfig(config, { scope });
    await completeOrContinue(config, "vibe edit silence-cut video.mp4 -o clean.mp4", [], scope);
    return;
  }

  // ── Custom setup ───────────────────────────────────────────────────
  if (topIndex === 3) {
    await runCustomSetup(config, scope, { showComplete: false });
    await saveConfig(config, { scope });
    await completeOrContinue(config, "vibe doctor --test-keys", [], scope);
    return;
  }

  // ── Full AI pipeline ───────────────────────────────────────────────
  if (topIndex === 2) {
    config.llm.provider = "claude";
    const pipelineKeys: AIFeatureKey[] = [
      {
        configKey: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        name: "Anthropic",
        url: "https://console.anthropic.com/settings/keys",
        what: "Claude — storyboard generation + reasoning",
      },
      {
        configKey: "openai",
        envVar: "OPENAI_API_KEY",
        name: "OpenAI",
        url: "https://platform.openai.com/api-keys",
        what: "gpt-image-2 image generation (default since v0.56) + Whisper word-level transcribe",
      },
      {
        configKey: "fal",
        envVar: "FAL_API_KEY",
        name: "fal.ai",
        url: "https://fal.ai/dashboard/keys",
        what: "Seedance 2.0 — video generation, default since v0.57",
      },
      {
        configKey: "elevenlabs",
        envVar: "ELEVENLABS_API_KEY",
        name: "ElevenLabs",
        url: "https://elevenlabs.io/app/settings/api-keys",
        what: "Text-to-speech narration + music (skip to use local Kokoro)",
      },
    ];

    console.log(chalk.dim("2. API keys"));
    console.log(chalk.bold("Pipeline requires these API keys:"));
    console.log(chalk.dim("  Saved locally, never shared. Press Enter to skip."));
    console.log();

    await collectKeys(config, pipelineKeys);

    await saveConfig(config, { scope });
    await completeOrContinue(
      config,
      "vibe build my-story/   # see CONTRIBUTING.md for STORYBOARD.md format",
      [],
      scope
    );
    return;
  }

  const result = await runAIFeaturesSetup(config, scope);
  if (result.back) {
    await completeOrContinue(config, "vibe --help", [], scope);
    return;
  }
  await saveConfig(config, { scope });
  await completeOrContinue(config, result.tryCommand, result.selectedFeatures, scope);
}

async function completeOrContinue(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  tryCommand: string,
  selectedFeatures: AIFeature[],
  scope: Scope
): Promise<void> {
  console.log(chalk.dim("Setup checkpoint"));
  console.log(chalk.bold("Anything else to configure?"));
  console.log();

  const action = await promptSelect(
    chalk.cyan("  Next: "),
    [
      `Add or update AI features ${chalk.dim("(images, videos, audio, editing)")}`,
      `Open full provider list ${chalk.dim("(every supported provider)")}`,
      "Finish setup",
    ],
    2
  );
  console.log();

  if (action === 0) {
    const result = await runAIFeaturesSetup(config, scope);
    if (result.back) {
      await completeOrContinue(config, tryCommand, selectedFeatures, scope);
      return;
    }
    const mergedFeatures = mergeSelectedFeatures(selectedFeatures, result.selectedFeatures);
    const mergedTryCommand = selectedFeatures.length > 0 ? tryCommand : result.tryCommand;
    await saveConfig(config, { scope });
    await completeOrContinue(config, mergedTryCommand, mergedFeatures, scope);
    return;
  }

  if (action === 1) {
    await runCustomSetup(config, scope, { showComplete: false });
    await saveConfig(config, { scope });
    await completeOrContinue(config, tryCommand, selectedFeatures, scope);
    return;
  }

  await showComplete(config, tryCommand, selectedFeatures, scope);
}

async function runAIFeaturesSetup(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  _scope: Scope
): Promise<{ tryCommand: string; selectedFeatures: AIFeature[]; back?: boolean }> {
  featureSelection: for (;;) {
    // ── AI generation (mix and match) ──────────────────────────────────
    console.log(chalk.dim("2. Features"));
    console.log(chalk.bold("Which AI features do you need?"));
    console.log(
      chalk.dim(
        `  ${chalk.bold("Most users pick more than one.")} Press ${chalk.bold("space")} on each feature you want, then ${chalk.bold("enter")} to confirm.`
      )
    );
    console.log(chalk.dim("  Shortcut: enter alone picks only the highlighted feature."));
    console.log(
      chalk.dim(
        `  Select ${chalk.bold("Back")} or press ${chalk.bold("Esc/←")} to return to the setup checkpoint.`
      )
    );
    console.log();

    const backIndex = AI_FEATURES.length;
    const featureLabels = [
      ...AI_FEATURES.map((f) => {
        const tag = chalk.dim(f.keyHint ?? `${f.keys.length} key${f.keys.length > 1 ? "s" : ""}`);
        return `${f.label} ${chalk.dim(`(${f.desc})`)} ${tag}`;
      }),
      `Back ${chalk.dim("(return to setup checkpoint)")}`,
    ];
    const configuredFeatures = AI_FEATURES.map((feature) => isFeatureConfigured(config, feature));
    const picked = await promptMultiSelect(
      chalk.cyan("  Pick (e.g. 1,3 or 'all'): "),
      featureLabels,
      [...configuredFeatures, false],
      { pickFocusedOnEnter: true, backIndex }
    );
    if (picked.includes(backIndex)) {
      console.log();
      return { tryCommand: "vibe --help", selectedFeatures: [], back: true };
    }
    const selectedFeatures: AIFeature[] = picked
      .filter((i) => i < AI_FEATURES.length)
      .map((i) => AI_FEATURES[i]);
    console.log();

    if (selectedFeatures.length === 0) {
      console.log(chalk.dim("  No features selected. You can re-run setup anytime."));
      console.log();
      return { tryCommand: "vibe --help", selectedFeatures: [] };
    }

    if (hasVideoFeature(selectedFeatures)) {
      const uploadResult = await configureUploadHost(config);
      if (uploadResult === "back") {
        console.log();
        continue featureSelection;
      }
    }

    const plannedKeys = new Map<string, AIFeatureKey[]>();

    console.log(chalk.dim("3. Providers"));
    console.log(chalk.bold("Choose providers for each selected feature"));
    console.log(
      chalk.dim(
        `  Recommended default is highlighted. Press ${chalk.bold("enter")} to pick the highlighted provider, ${chalk.bold("space")} to choose multiple, or ${chalk.bold("Esc/←")} to go back.`
      )
    );
    console.log();

    for (const feature of selectedFeatures) {
      const keysForFeature: AIFeatureKey[] = [];

      if (feature.providerChoices && feature.providerChoices.length > 0) {
        console.log(chalk.bold.cyan(`  ${feature.label}`));
        console.log(chalk.dim(`  Default path: ${feature.defaultProvider}`));
        if (feature.alsoAvailable) {
          console.log(chalk.dim(`  Alternatives: ${feature.alsoAvailable}`));
        }
        console.log();

        const defaultSelected = feature.providerChoices.map((choice) =>
          isProviderChoiceConfigured(config, choice)
        );
        const providerLabels = feature.providerChoices.map((choice) => {
          const keyHint = choice.keyless
            ? chalk.dim("no key")
            : choice.key
              ? chalk.dim(
                  [
                    choice.key.envVar,
                    ...getChoiceExtraKeys(config, choice).map((keyDef) => keyDef.envVar),
                  ]
                    .filter(Boolean)
                    .join(" + ")
                )
              : chalk.dim("no key");
          const defaultHint =
            choice === feature.providerChoices?.[0] ? chalk.dim("recommended default") : "";
          return [choice.label, defaultHint, chalk.dim(`- ${choice.desc}`), keyHint]
            .filter(Boolean)
            .join(" ");
        });
        const backProviderIndex = providerLabels.length;
        const pickedProviders = await promptMultiSelect(
          chalk.cyan("  Providers (arrow + enter picks one, space adds more): "),
          [...providerLabels, `Back ${chalk.dim("(choose different features)")}`],
          [...defaultSelected, false],
          {
            pickFocusedOnEnter: true,
            preserveDefaultSelectionOnEnter: true,
            backIndex: backProviderIndex,
          }
        );
        if (pickedProviders.includes(backProviderIndex)) {
          console.log();
          continue featureSelection;
        }

        const selectedChoices = pickedProviders
          .filter((i) => i < feature.providerChoices!.length)
          .map((i) => feature.providerChoices![i]);
        const defaultChoice = selectedChoices.find((choice) => choice.defaultFor);
        if (defaultChoice) {
          applyProviderDefault(config, defaultChoice);
        }

        for (const choice of selectedChoices) {
          if (choice.key) addUniqueKey(keysForFeature, choice.key);
          for (const keyDef of getChoiceExtraKeys(config, choice)) {
            addUniqueKey(keysForFeature, keyDef);
          }
        }
        if (selectedChoices.some((choice) => choice.keyless)) {
          console.log(chalk.dim("  No API key needed for selected local provider(s)."));
        }
        console.log();
      } else {
        for (const keyDef of feature.keys) {
          addUniqueKey(keysForFeature, keyDef);
        }
      }

      plannedKeys.set(feature.label, keysForFeature);
    }

    const needsKeys = [...plannedKeys.values()].some((keys) => keys.length > 0);
    if (needsKeys) {
      // Collect keys feature-by-feature with context
      console.log(chalk.dim("4. API keys"));
      console.log(chalk.bold("API Keys"));
      console.log(chalk.dim("  Saved locally, never shared. Press Enter to skip."));
      console.log();

      // Track already-collected keys to avoid asking twice
      const collectedKeys = new Set<string>();

      for (const feature of selectedFeatures) {
        const keysForFeature = plannedKeys.get(feature.label) ?? [];
        if (keysForFeature.length === 0) {
          continue;
        }

        // Feature header
        console.log(chalk.bold.cyan(`  ${feature.label}`));
        console.log(chalk.dim(`  Default: ${feature.defaultProvider}`));
        if (feature.alsoAvailable) {
          console.log(chalk.dim(`  Also available: ${feature.alsoAvailable}`));
        }
        console.log();

        for (const keyDef of keysForFeature) {
          // Skip if already collected for a previous feature
          if (collectedKeys.has(keyDef.configKey)) {
            console.log(`  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} (already set above)`);
            continue;
          }

          // Check existing config / .env
          loadEnv();
          const configValue = config.providers[keyDef.configKey as keyof typeof config.providers];
          const envValue = envValueForName(keyDef.envVar);

          if (configValue || envValue) {
            const value = configValue || envValue!;
            const source = configValue ? "config" : ".env";
            console.log(
              `  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(value)} ${chalk.dim(`(${source})`)}`
            );
            collectedKeys.add(keyDef.configKey);
            continue;
          }

          // Show what this key is for + where to get it
          console.log(chalk.dim(`  ${keyDef.what}`));
          console.log(chalk.dim(`  Get key: ${keyDef.url}  [o] open in browser`));
          const newKey = await promptHidden(
            chalk.cyan(`  ${keyDef.name.padEnd(14)} ${chalk.dim(keyDef.envVar)}: `),
            { openHotkeyUrl: keyDef.url }
          );
          if (newKey.trim()) {
            const trimmed = newKey.trim();
            config.providers[keyDef.configKey as keyof typeof config.providers] = trimmed;
            const fmt = validateKeyFormat(keyDef.configKey, trimmed);
            if (!fmt.ok && fmt.expected) {
              console.log(
                `  ${chalk.yellow("⚠")} Saved, but format looks unusual ${chalk.dim(`(expected ${fmt.expected})`)}`
              );
            } else {
              console.log(`  ${chalk.green("✓")} Saved`);
            }
            collectedKeys.add(keyDef.configKey);
          } else {
            console.log(
              `  ${chalk.yellow("⚠")} Skipped ${chalk.dim(`(set ${keyDef.envVar} in .env later)`)}`
            );
          }
        }
        console.log();
      }
    } else {
      console.log(chalk.dim("4. API keys"));
      console.log(chalk.dim("  No API keys needed for the selected provider(s)."));
      console.log();
    }

    return { tryCommand: selectedFeatures[0].tryCommand, selectedFeatures };
  }
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
    const envValue = envValueForName(keyDef.envVar);

    if (configValue) {
      console.log(
        `  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(configValue)} ${chalk.dim("(config)")}`
      );
      continue;
    }
    if (envValue) {
      console.log(
        `  ${chalk.green("✓")} ${keyDef.name.padEnd(14)} ${maskApiKey(envValue)} ${chalk.dim("(.env)")}`
      );
      continue;
    }

    console.log(chalk.dim(`  ${keyDef.what}`));
    console.log(chalk.dim(`  Get key: ${keyDef.url}  [o] open in browser`));
    const newKey = await promptHidden(
      chalk.cyan(`  ${keyDef.name.padEnd(14)} ${chalk.dim(keyDef.envVar)}: `),
      { openHotkeyUrl: keyDef.url }
    );
    if (newKey.trim()) {
      const trimmed = newKey.trim();
      config.providers[keyDef.configKey as keyof typeof config.providers] = trimmed;
      const fmt = validateKeyFormat(keyDef.configKey, trimmed);
      if (!fmt.ok && fmt.expected) {
        console.log(
          `  ${chalk.yellow("⚠")} Saved, but format looks unusual ${chalk.dim(`(expected ${fmt.expected})`)}`
        );
      } else {
        console.log(`  ${chalk.green("✓")} Saved`);
      }
    } else {
      console.log(
        `  ${chalk.yellow("⚠")} Skipped ${chalk.dim(`(set ${keyDef.envVar} in .env later)`)}`
      );
    }
  }
  console.log();
}

/**
 * Custom setup — provider-by-provider (old --full flow)
 */
async function runCustomSetup(
  config: Awaited<ReturnType<typeof loadConfig>> & object,
  scope: Scope = "user",
  opts: { showComplete?: boolean } = {}
): Promise<void> {
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
      console.log(
        `  ${chalk.green("✓")} ${p.name.padEnd(12)} ${maskApiKey(existing)} ${chalk.dim(p.desc)}`
      );
      const change = await promptConfirm(chalk.cyan("    Update?"), false);
      if (change) {
        console.log(chalk.dim(`    Get key: ${p.url}  [o] open in browser`));
        const newKey = await promptHidden(chalk.cyan("    New key: "), { openHotkeyUrl: p.url });
        if (newKey.trim()) {
          const trimmed = newKey.trim();
          config.providers[p.key as keyof typeof config.providers] = trimmed;
          const fmt = validateKeyFormat(p.key, trimmed);
          if (!fmt.ok && fmt.expected) {
            console.log(
              chalk.yellow(`    ⚠ Updated, but format looks unusual (expected ${fmt.expected})`)
            );
          } else {
            console.log(chalk.green("    ✓ Updated"));
          }
        }
      }
    } else {
      console.log(
        chalk.dim(
          `  ${chalk.dim("○")} ${p.name.padEnd(12)} ${chalk.dim(p.desc)}  Get key: ${p.url}  [o] open`
        )
      );
      const newKey = await promptHidden(chalk.cyan(`    ${p.env}: `), { openHotkeyUrl: p.url });
      if (newKey.trim()) {
        const trimmed = newKey.trim();
        config.providers[p.key as keyof typeof config.providers] = trimmed;
        const fmt = validateKeyFormat(p.key, trimmed);
        if (!fmt.ok && fmt.expected) {
          console.log(
            `  ${chalk.yellow("⚠")} Saved, but format looks unusual ${chalk.dim(`(expected ${fmt.expected})`)}`
          );
        } else {
          console.log(`  ${chalk.green("✓")} Saved`);
        }
      }
    }
  }
  console.log();

  // Save
  await saveConfig(config, { scope });
  if (opts.showComplete !== false) {
    await showComplete(config, "vibe doctor", [], scope);
  }
}

/**
 * Show completion message with contextual "try it" commands
 */
async function showComplete(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  defaultTryCommand: string,
  features: AIFeature[] = [],
  scope: Scope = "user"
): Promise<void> {
  console.log(chalk.dim("─".repeat(40)));
  console.log(chalk.green.bold("✓ Setup complete!"));
  console.log();
  const scopeNote =
    scope === "project" ? chalk.dim(" (project scope)") : chalk.dim(" (user scope)");
  console.log(chalk.dim(`  Config: ${getConfigPath(scope)}${scopeNote}`));
  console.log();

  // The first try-this command is what most users will run next; copy it
  // to the clipboard so they can paste straight into the next prompt.
  // Best-effort — failures are silent (missing pbcopy/xclip, headless CI).
  const primaryTry = features.length > 1 ? features[0].tryCommand : defaultTryCommand;
  if (features.length > 1) {
    console.log(chalk.bold("  Try these:"));
    for (const f of features) {
      console.log(`    ${chalk.cyan(f.tryCommand)}`);
    }
  } else {
    console.log(`  Try: ${chalk.cyan(defaultTryCommand)}`);
  }
  if (process.stdout.isTTY) {
    const copied = await copyToClipboard(primaryTry);
    if (copied) {
      console.log(chalk.dim("    ✓ Copied to clipboard"));
    }
  }
  console.log();
  console.log(chalk.bold("  Next steps:"));
  console.log(
    chalk.dim(
      "    cd <project>; vibe init   Scaffold AGENTS.md / CLAUDE.md / .env.example (project scope)"
    )
  );

  // Surface every registered walkthrough — the topic table is the single
  // source of truth (`walkthroughs.ts`), so adding a topic there shows up
  // here automatically. When an agent host is detected, the `scene` flow
  // is the canonical entry point so we tag it (recommended).
  const hostDetected = detectedAgentHosts().length > 0;
  for (const w of listWalkthroughs()) {
    const cmd = `vibe walkthrough ${w.topic}`.padEnd(26);
    const tag = hostDetected && w.topic === "scene" ? chalk.cyan(" (recommended)") : "";
    console.log(chalk.dim(`    ${cmd}${w.summary}${tag}`));
  }

  console.log(
    chalk.dim("    vibe doctor --test-keys   Live-check each provider key against its API")
  );
  console.log(chalk.dim("    vibe doctor               Check system health + available commands"));
  console.log(chalk.dim("    vibe schema --list        Discover every command"));
  console.log(chalk.dim("    vibe setup                Re-run user-scope setup anytime"));

  // Tab-completion install hint — pick the user's likely shell from
  // $SHELL, fall back to a generic line. Runs once at setup time so
  // returning users see it.
  const shellHint = pickCompletionHint(process.env.SHELL);
  if (shellHint) {
    console.log();
    console.log(chalk.bold("  Tab completion:"));
    console.log(chalk.dim(`    ${shellHint}`));
  }

  // Tailored hint when an agent host is detected — points at the file
  // `vibe init` will scaffold for that host, and surfaces the Plan H
  // agentic compose path so they know `vibe build` will dispatch to
  // their host agent automatically.
  const hosts = detectedAgentHosts();
  const primary = hosts[0];
  if (primary) {
    console.log();
    console.log(
      chalk.dim(
        `  Detected ${primary.label} — \`vibe init\` will scaffold ${primary.projectFiles.join(" + ")} in your project.`
      )
    );
    console.log(
      chalk.dim(
        `  Scene composer will auto-dispatch to ${primary.label} (${chalk.bold("--mode agent")}). ` +
          `Run \`vibe init my-promo\` to scaffold a video project + install local composition rules.`
      )
    );
  } else {
    console.log();
    console.log(
      chalk.dim(
        `  No agent host detected — \`vibe build\` will use the internal LLM composer (${chalk.bold("--mode batch")}).`
      )
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
 * Show current configuration for debugging.
 *
 * Default mode lists only set keys + the LLM provider + config path.
 * `--verbose` re-adds unset rows, the Defaults block, and the
 * Resolution order — useful when troubleshooting why a key isn't being
 * picked up. The default keeps a returning user's status check to
 * roughly the screen height.
 */
async function showConfig(opts: { verbose: boolean } = { verbose: false }): Promise<void> {
  const { verbose } = opts;
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

  const activeScope = await getActiveScope();
  const userPath = USER_CONFIG_PATH;
  const projectPath = getConfigPath("project");
  const userExists = (await loadConfig({ scope: "user" })) !== null;
  const projectExists = (await loadConfig({ scope: "project" })) !== null;

  console.log();
  console.log(chalk.bold.magenta("VibeFrame Configuration"));
  console.log(chalk.dim("─".repeat(40)));
  console.log();
  const userMark =
    activeScope === "user" && userExists
      ? chalk.cyan("← active")
      : userExists
        ? chalk.dim("(present)")
        : chalk.dim("(missing)");
  const projectMark =
    activeScope === "project"
      ? chalk.cyan("← active")
      : projectExists
        ? chalk.dim("(present)")
        : chalk.dim("(missing)");
  console.log(chalk.dim(`Scopes:`));
  console.log(chalk.dim(`  user     ${userPath} ${userMark}`));
  console.log(chalk.dim(`  project  ${projectPath} ${projectMark}`));
  if (hasCwdEnv) {
    console.log(chalk.dim(`  .env     ${cwdEnvPath} ${chalk.dim("(env vars override config)")}`));
  }
  console.log();

  // Show whichever scope is active (auto-detect: project if exists, else user).
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
    { key: "fal", name: "fal.ai", env: "FAL_API_KEY" },
    { key: "elevenlabs", name: "ElevenLabs", env: "ELEVENLABS_API_KEY" },
    { key: "runway", name: "Runway", env: "RUNWAY_API_SECRET" },
    { key: "kling", name: "Kling", env: "KLING_API_KEY" },
    { key: "imgbb", name: "ImgBB", env: "IMGBB_API_KEY" },
    { key: "replicate", name: "Replicate", env: "REPLICATE_API_TOKEN" },
    { key: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY" },
  ];

  let unsetCount = 0;
  for (const p of providerKeys) {
    const configValue = config?.providers[p.key as keyof typeof config.providers];
    const dotenvValue = dotenvKeys[p.env];

    if (configValue || dotenvValue) {
      // Show effective value (config wins) and all sources
      const sources: string[] = [];
      if (configValue) sources.push("config");
      if (dotenvValue) sources.push(".env");
      const value = configValue || dotenvValue!;
      const status = chalk.green("✓");
      console.log(`  ${status} ${p.name.padEnd(12)} ${maskApiKey(value)} (${sources.join(" + ")})`);
    } else {
      unsetCount++;
      if (verbose) {
        const status = chalk.dim("○");
        console.log(`  ${status} ${p.name.padEnd(12)} ${chalk.dim("not set")}`);
      }
    }
  }
  if (!verbose && unsetCount > 0) {
    console.log(
      chalk.dim(
        `  (${unsetCount} provider${unsetCount === 1 ? "" : "s"} unset — run with --verbose to list)`
      )
    );
  }
  console.log();

  // Defaults + resolution order are debugging aids — only useful when
  // something's actually wrong. Hide behind --verbose by default.
  if (verbose) {
    if (config) {
      console.log(chalk.bold("Defaults:"));
      console.log(`  Aspect Ratio: ${config.defaults.aspectRatio}`);
      console.log(`  Export Quality: ${config.defaults.exportQuality}`);
      console.log();
    }

    console.log(chalk.bold("Resolution order:"));
    console.log(chalk.dim("  1. --api-key CLI option"));
    console.log(
      chalk.dim(`  2. Active config scope: ${activeScope === "project" ? projectPath : userPath}`)
    );
    console.log(
      chalk.dim(`     (project takes priority when present at cwd; user is ignored in that case)`)
    );
    console.log(chalk.dim("  3. .env / shell environment variables (process.env)"));
    console.log();
  }
}

/**
 * Suggest the appropriate `vibe completion` install one-liner based on
 * the user's $SHELL. Returns `undefined` for unknown shells (no
 * suggestion is better than the wrong suggestion).
 */
function pickCompletionHint(shellPath: string | undefined): string | undefined {
  if (!shellPath) return undefined;
  const shell = shellPath.split("/").pop() ?? "";
  if (shell.includes("zsh")) {
    return `echo 'eval "$(vibe completion zsh)"' >> ~/.zshrc`;
  }
  if (shell.includes("bash")) {
    return `echo 'eval "$(vibe completion bash)"' >> ~/.bashrc`;
  }
  if (shell.includes("fish")) {
    return `vibe completion fish > ~/.config/fish/completions/vibe.fish`;
  }
  return undefined;
}
