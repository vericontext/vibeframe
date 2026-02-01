import { createInterface } from "node:readline";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import chalk from "chalk";

// Load .env from project root (where package.json is)
function findProjectRoot(): string {
  let dir = process.cwd();
  // Walk up to find the monorepo root (where pnpm-workspace.yaml is)
  while (dir !== "/") {
    try {
      require.resolve(resolve(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = resolve(dir, "..");
    }
  }
  return process.cwd();
}

/**
 * Load environment variables from .env file
 */
export function loadEnv(): void {
  const projectRoot = findProjectRoot();
  config({ path: resolve(projectRoot, ".env") });
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
 * Get API key from environment, prompt if not found
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

  // 2. Load .env and check environment
  loadEnv();
  const envValue = process.env[envVar];
  if (envValue) {
    return envValue;
  }

  // 3. Check if running in TTY (interactive terminal)
  if (!process.stdin.isTTY) {
    return null;
  }

  // 4. Prompt for API key
  console.log();
  console.log(chalk.yellow(`${providerName} API key not found.`));
  console.log(chalk.dim(`Set ${envVar} in .env or environment variables.`));
  console.log();

  const apiKey = await prompt(chalk.cyan(`Enter ${providerName} API key: `), true);

  if (!apiKey || apiKey.trim() === "") {
    return null;
  }

  // 5. Ask if user wants to save to .env
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
  const projectRoot = findProjectRoot();
  const envPath = resolve(projectRoot, ".env");

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
