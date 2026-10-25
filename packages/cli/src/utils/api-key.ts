import { createInterface } from "node:readline";
import { readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";
import chalk from "chalk";
import { getApiKeyFromConfig, PROVIDER_ENV_ALIASES } from "../config/index.js";
import { ApiKeyError } from "./api-key-error.js";

export { ApiKeyError };

const PROVIDER_KEY_BY_ENV_VAR: Record<string, string> = {
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
  GOOGLE_API_KEY: "google",
  XAI_API_KEY: "xai",
  ELEVENLABS_API_KEY: "elevenlabs",
  FAL_API_KEY: "fal",
  RUNWAY_API_SECRET: "runway",
  KLING_API_KEY: "kling",
  IMGBB_API_KEY: "imgbb",
  REPLICATE_API_TOKEN: "replicate",
};

export function providerKeyForEnvVar(envVar: string): string | undefined {
  return PROVIDER_KEY_BY_ENV_VAR[envVar];
}

function getEnvValue(envVar: string): string | undefined {
  return (
    process.env[envVar] ||
    PROVIDER_ENV_ALIASES[envVar]?.map((alias) => process.env[alias]).find(Boolean)
  );
}

/** Bound for the upward .env walk — covers any sane workspace nesting. */
const MAX_ENV_WALK_LEVELS = 10;

/**
 * Load environment variables from .env files.
 * Priority: `projectDir` .env (when given) > CWD .env > ancestor .env files
 * (nearest wins, walking up to $HOME / fs root / {@link MAX_ENV_WALK_LEVELS})
 * > monorepo root .env (development). dotenv never overrides already-set
 * vars, so load order IS precedence. The upward walk is what lets a project
 * run from `<workspace>/<project>/` pick up the keys in `<workspace>/.env`.
 *
 * `VIBE_NO_DOTENV=1` skips every .env file, so only the process environment
 * and config.yaml supply keys. The test suites set it (see
 * scripts/vitest-hermetic-env.mts) so a developer's real keys never reach a
 * test.
 */
export function loadEnv(projectDir?: string): void {
  if (process.env.VIBE_NO_DOTENV === "1") return;
  if (projectDir) config({ path: resolve(projectDir, ".env"), debug: false, quiet: true });
  const home = homedir();
  let dir = process.cwd();
  for (let level = 0; level < MAX_ENV_WALK_LEVELS; level++) {
    config({ path: resolve(dir, ".env"), debug: false, quiet: true });
    const parent = dirname(dir);
    if (dir === home || parent === dir) break;
    dir = parent;
  }

  // Monorepo-root safety net for repos nested deeper than the walk bound.
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
  const configuredKey = await getConfiguredApiKey(envVar, optionValue);
  if (configuredKey) return configuredKey;

  // 4. Check if running in TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    return null;
  }

  // 5. Prompt for API key
  console.log();
  console.log(chalk.yellow(`${providerName} API key not found.`));
  console.log(
    chalk.dim(`Set ${envVar} in .env (current directory), run 'vibe setup', or enter below.`)
  );
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
 * Resolve an API key without prompting.
 *
 * This is for library-style execution paths that should respect
 * `vibe setup --scope project` but must not stop for interactive input
 * when no key exists. Precedence matches `getApiKey()` up to the prompt:
 * CLI override > nearest project/user config.yaml > .env/process env.
 */
export async function getConfiguredApiKey(
  envVar: string,
  optionValue?: string,
  options: { cwd?: string } = {}
): Promise<string | undefined> {
  if (optionValue) return optionValue;

  const providerKey = providerKeyForEnvVar(envVar);
  if (providerKey) {
    const configKey = await getApiKeyFromConfig(providerKey, { cwd: options.cwd });
    if (configKey) return configKey;
  }

  loadEnv();
  return getEnvValue(envVar);
}

/**
 * Like {@link getConfiguredApiKey}, but a missing key throws
 * {@link ApiKeyError} (`API_KEY_MISSING`). Never prompts, so executors shared
 * by the CLI, MCP tools, and pipelines use it to fail the same way on every
 * surface before any provider spend.
 */
export async function requireConfiguredApiKey(
  envVar: string,
  providerName: string,
  optionValue?: string,
  options: { cwd?: string } = {}
): Promise<string> {
  const key = await getConfiguredApiKey(envVar, optionValue, options);
  if (!key) throw new ApiKeyError(envVar, providerName);
  return key;
}

/** True when a key exists in CLI override, config.yaml, .env, or env. */
export async function hasConfiguredApiKey(
  envVar: string,
  optionValue?: string,
  options: { cwd?: string } = {}
): Promise<boolean> {
  return Boolean(await getConfiguredApiKey(envVar, optionValue, options));
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
  return !!getEnvValue(envVar);
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
