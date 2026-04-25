import { createInterface } from "node:readline";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import chalk from "chalk";
import { getApiKeyFromConfig } from "../config/index.js";

/**
 * Load environment variables from .env files.
 * Priority: CWD .env (project-scoped) > monorepo root .env (development)
 * Later loads don't override earlier values, so CWD takes precedence.
 */
export function loadEnv(): void {
  // 1. Load from current working directory (project-scoped, highest priority)
  config({ path: resolve(process.cwd(), ".env"), debug: false, quiet: true });

  // 2. Load from monorepo root if in development (won't override existing vars)
  const monorepoRoot = findMonorepoRoot();
  if (monorepoRoot && monorepoRoot !== process.cwd()) {
    config({ path: resolve(monorepoRoot, ".env"), debug: false, quiet: true });
  }
}

// Find monorepo root for development environments
function findMonorepoRoot(): string | null {
  let dir = process.cwd();
  while (dir !== "/") {
    try {
      require.resolve(resolve(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = resolve(dir, "..");
    }
  }
  return null;
}

/**
 * Prompt user for input (hidden for API keys)
 */
async function prompt(question: string, hidden = false): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // For hidden input, we need to handle it differently
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);

      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          // Ctrl+C
          process.exit(1);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else {
          input += char;
        }
      };

      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Get API key from config, environment, or prompt
 */
export async function getApiKey(
  envVar: string,
  providerName: string,
  optionValue?: string
): Promise<string | null> {
  // 1. Check command line option
  if (optionValue) {
    return optionValue;
  }

  // 2. Check ~/.vibeframe/config.yaml
  // Map env var to provider key
  const providerKeyMap: Record<string, string> = {
    ANTHROPIC_API_KEY: "anthropic",
    OPENAI_API_KEY: "openai",
    GOOGLE_API_KEY: "google",
    XAI_API_KEY: "xai",
    ELEVENLABS_API_KEY: "elevenlabs",
    RUNWAY_API_SECRET: "runway",
    KLING_API_KEY: "kling",
    OPENROUTER_API_KEY: "openrouter",
    IMGBB_API_KEY: "imgbb",
    REPLICATE_API_TOKEN: "replicate",
  };
  const providerKey = providerKeyMap[envVar];
  if (providerKey) {
    const configKey = await getApiKeyFromConfig(providerKey);
    if (configKey) {
      return configKey;
    }
  }

  // 3. Load .env and check environment
  loadEnv();
  const envValue = process.env[envVar];
  if (envValue) {
    return envValue;
  }

  // 4. Check if running in TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    return null;
  }

  // 5. Prompt for API key
  console.log();
  console.log(chalk.yellow(`${providerName} API key not found.`));
  console.log(chalk.dim(`Set ${envVar} in .env (current directory), run 'vibe setup', or enter below.`));
  console.log();

  const apiKey = await prompt(chalk.cyan(`Enter ${providerName} API key: `), true);

  if (!apiKey || apiKey.trim() === "") {
    return null;
  }

  // 6. Ask if user wants to save to .env
  const save = await prompt(chalk.cyan("Save to .env for future use? (y/N): "));

  if (save.toLowerCase() === "y" || save.toLowerCase() === "yes") {
    await saveApiKeyToEnv(envVar, apiKey.trim());
    console.log(chalk.green("API key saved to .env"));
  }

  return apiKey.trim();
}

/**
 * Error thrown when a required API key is missing (non-interactive mode)
 */
/** URLs where users can obtain API keys */
const API_KEY_URLS: Record<string, string> = {
  GOOGLE_API_KEY: "https://aistudio.google.com/apikey",
  OPENAI_API_KEY: "https://platform.openai.com/api-keys",
  ANTHROPIC_API_KEY: "https://console.anthropic.com/settings/keys",
  XAI_API_KEY: "https://console.x.ai",
  ELEVENLABS_API_KEY: "https://elevenlabs.io/app/settings/api-keys",
  RUNWAY_API_SECRET: "https://app.runwayml.com/settings/api-keys",
  KLING_API_KEY: "https://klingai.com/dev",
  REPLICATE_API_TOKEN: "https://replicate.com/account/api-tokens",
};

export class ApiKeyError extends Error {
  public envVar: string;
  public providerName: string;

  constructor(envVar: string, providerName: string) {
    const keyUrl = API_KEY_URLS[envVar];
    const urlHint = keyUrl ? `\n  Get key: ${keyUrl}` : "";
    super(
      `${providerName} API key required.\n` +
        `  Set ${envVar} in .env, or run: vibe setup${urlHint}`
    );
    this.name = "ApiKeyError";
    this.envVar = envVar;
    this.providerName = providerName;
  }

  toStructured(): {
    success: false;
    error: string;
    code: string;
    exitCode: number;
    suggestion: string;
    retryable: false;
  } {
    const keyUrl = API_KEY_URLS[this.envVar];
    const urlHint = keyUrl ? ` Get key: ${keyUrl}` : "";
    return {
      success: false as const,
      error: `${this.providerName} API key required.`,
      code: "API_KEY_MISSING",
      exitCode: 4,
      suggestion: `Set ${this.envVar} in .env, or run: vibe setup. Check available features: vibe doctor --json.${urlHint}`,
      retryable: false as const,
    };
  }
}

/**
 * Check if an API key is available without prompting or side effects.
 *
 * Sync env-only check — for the config-file fallback (set via `vibe setup`),
 * use the async {@link getApiKey} instead. Two bugs in the previous
 * implementation made this lie: (1) `getApiKeyFromConfig` is async and
 * was called without `await`, so `!!Promise` always returned `true`,
 * and (2) the function expects a provider key (`"elevenlabs"`) but was
 * being passed the env-var name (`"ELEVENLABS_API_KEY"`). The result
 * was that `vibe scene add --tts auto` always took the ElevenLabs path
 * and crashed with "API key required" even though we were supposed to
 * fall back to local Kokoro. Caught during pre-HN error-message audit.
 */
export function hasApiKey(envVar: string): boolean {
  loadEnv();
  return !!process.env[envVar];
}

/**
 * Get API key or throw ApiKeyError if not found.
 * Use this instead of getApiKey() + manual null check.
 */
export async function requireApiKey(
  envVar: string,
  providerName: string,
  cliOverride?: string
): Promise<string> {
  const key = await getApiKey(envVar, providerName, cliOverride);
  if (!key) {
    throw new ApiKeyError(envVar, providerName);
  }
  return key;
}

/**
 * Save API key to .env file
 */
async function saveApiKeyToEnv(envVar: string, apiKey: string): Promise<void> {
  const envPath = resolve(process.cwd(), ".env");

  let content = "";

  try {
    await access(envPath);
    content = await readFile(envPath, "utf-8");
  } catch {
    // File doesn't exist, will create new
  }

  // Check if variable already exists
  const regex = new RegExp(`^${envVar}=.*$`, "m");
  if (regex.test(content)) {
    // Replace existing
    content = content.replace(regex, `${envVar}=${apiKey}`);
  } else {
    // Append new
    if (content && !content.endsWith("\n")) {
      content += "\n";
    }
    content += `${envVar}=${apiKey}\n`;
  }

  await writeFile(envPath, content, "utf-8");
}
