/**
 * Configuration loader/saver for VibeFrame CLI
 * Config stored at ~/.vibeframe/config.yaml
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { type VibeConfig, createDefaultConfig, PROVIDER_ENV_VARS } from "./schema.js";

/** Config directory path */
export const CONFIG_DIR = resolve(homedir(), ".vibeframe");

/** Config file path */
export const CONFIG_PATH = resolve(CONFIG_DIR, "config.yaml");

/**
 * Load configuration from ~/.vibeframe/config.yaml
 * Returns null if config doesn't exist
 */
export async function loadConfig(): Promise<VibeConfig | null> {
  try {
    await access(CONFIG_PATH);
    const content = await readFile(CONFIG_PATH, "utf-8");
    const config = parse(content) as VibeConfig;

    // Merge with defaults to ensure all fields exist
    const defaults = createDefaultConfig();
    return {
      ...defaults,
      ...config,
      llm: { ...defaults.llm, ...config.llm },
      providers: { ...defaults.providers, ...config.providers },
      defaults: { ...defaults.defaults, ...config.defaults },
      repl: { ...defaults.repl, ...config.repl },
    };
  } catch {
    return null;
  }
}

/**
 * Save configuration to ~/.vibeframe/config.yaml
 */
export async function saveConfig(config: VibeConfig): Promise<void> {
  // Ensure config directory exists
  await mkdir(CONFIG_DIR, { recursive: true });

  // Write config as YAML
  const content = stringify(config, {
    indent: 2,
    lineWidth: 0, // Don't wrap lines
  });

  await writeFile(CONFIG_PATH, content, "utf-8");
}

/**
 * Check if configuration exists and has required API key
 */
export async function isConfigured(): Promise<boolean> {
  const config = await loadConfig();
  if (!config) return false;

  // Check if primary LLM provider has API key
  const provider = config.llm.provider;
  const providerKey = provider === "gemini" ? "google" : provider === "claude" ? "anthropic" : provider;

  // Check config first, then environment
  if (config.providers[providerKey as keyof typeof config.providers]) {
    return true;
  }

  const envVar = PROVIDER_ENV_VARS[providerKey];
  if (envVar && process.env[envVar]) {
    return true;
  }

  return false;
}

/**
 * Get API key from config, then environment
 * @param providerKey Provider key (e.g., "anthropic", "openai")
 * @returns API key or undefined
 */
export async function getApiKeyFromConfig(
  providerKey: string
): Promise<string | undefined> {
  const config = await loadConfig();

  // Check config first
  if (config?.providers[providerKey as keyof typeof config.providers]) {
    return config.providers[providerKey as keyof typeof config.providers];
  }

  // Fall back to environment variable
  const envVar = PROVIDER_ENV_VARS[providerKey];
  if (envVar) {
    return process.env[envVar];
  }

  return undefined;
}

/**
 * Update a specific provider API key in config
 */
export async function updateProviderKey(
  providerKey: string,
  apiKey: string
): Promise<void> {
  let config = await loadConfig();
  if (!config) {
    config = createDefaultConfig();
  }

  config.providers[providerKey as keyof typeof config.providers] = apiKey;
  await saveConfig(config);
}

// Re-export types
export type { VibeConfig, LLMProvider } from "./schema.js";
export { createDefaultConfig, PROVIDER_NAMES, PROVIDER_ENV_VARS } from "./schema.js";
