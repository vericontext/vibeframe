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
  config({ path: resolve(process.cwd(), ".env"), debug: false });

  // 2. Load from monorepo root if in development (won't override existing vars)
  const monorepoRoot = findMonorepoRoot();
  if (monorepoRoot && monorepoRoot !== process.cwd()) {
    config({ path: resolve(monorepoRoot, ".env"), debug: false });
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
    ELEVENLABS_API_KEY: "elevenlabs",
    RUNWAY_API_SECRET: "runway",
    KLING_API_KEY: "kling",
    IMGBB_API_KEY: "imgbb",
    STABILITY_API_KEY: "stability",
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
