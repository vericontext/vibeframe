/**
 * Configuration loader/saver for VibeFrame CLI.
 *
 * Two scopes:
 *   - user    ~/.vibeframe/config.yaml         (shared across projects)
 *   - project <cwd>/.vibeframe/config.yaml     (gitignored, per-project)
 *
 * Precedence at runtime: process.env > project > user.
 *
 * Default `loadConfig()` behavior is "auto" — if a project config exists in
 * the current working directory, it is used and the user config is ignored.
 * Pass `{scope:"user"}` or `{scope:"project"}` to force one side.
 *
 * Pass `{merge:true}` to overlay project on user (project wins). Used by
 * doctor to render "where did this key come from" diagnostics.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { type VibeConfig, createDefaultConfig, PROVIDER_ENV_VARS } from "./schema.js";

export type Scope = "user" | "project";

/** User-scope config directory (~/.vibeframe). */
export const USER_CONFIG_DIR = resolve(homedir(), ".vibeframe");

/** User-scope config file (~/.vibeframe/config.yaml). */
export const USER_CONFIG_PATH = resolve(USER_CONFIG_DIR, "config.yaml");

/**
 * Back-compat aliases. New code should use `USER_CONFIG_PATH` /
 * `USER_CONFIG_DIR` or `getConfigPath(scope)` to be scope-explicit.
 */
export const CONFIG_DIR = USER_CONFIG_DIR;
export const CONFIG_PATH = USER_CONFIG_PATH;

/** Project-scope config directory (`<cwd>/.vibeframe`). */
export function getProjectConfigDir(cwd: string = process.cwd()): string {
  return resolve(cwd, ".vibeframe");
}

/** Project-scope config file (`<cwd>/.vibeframe/config.yaml`). */
export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return resolve(getProjectConfigDir(cwd), "config.yaml");
}

/** Resolve config file path for a given scope. */
export function getConfigPath(scope: Scope, cwd?: string): string {
  return scope === "project" ? getProjectConfigPath(cwd) : USER_CONFIG_PATH;
}

/** Resolve config directory for a given scope. */
export function getConfigDir(scope: Scope, cwd?: string): string {
  return scope === "project" ? getProjectConfigDir(cwd) : USER_CONFIG_DIR;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The scope that `loadConfig()` will read from when called without an
 * explicit scope. Returns `"project"` if a project config exists at cwd,
 * else `"user"` (regardless of whether the user file exists).
 */
export async function getActiveScope(cwd?: string): Promise<Scope> {
  return (await fileExists(getProjectConfigPath(cwd))) ? "project" : "user";
}

function applyDefaults(parsed: VibeConfig): VibeConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...parsed,
    llm: { ...defaults.llm, ...parsed.llm },
    providers: { ...defaults.providers, ...parsed.providers },
    defaults: { ...defaults.defaults, ...parsed.defaults },
    repl: { ...defaults.repl, ...parsed.repl },
  };
}

async function readConfigFile(path: string): Promise<VibeConfig | null> {
  if (!(await fileExists(path))) return null;
  try {
    const content = await readFile(path, "utf-8");
    const parsed = parse(content) as VibeConfig;
    return applyDefaults(parsed);
  } catch {
    return null;
  }
}

export interface LoadConfigOptions {
  /** Force a specific scope. Default: auto (project if exists, else user). */
  scope?: Scope;
  /** Working directory for resolving the project scope. Default: process.cwd(). */
  cwd?: string;
  /** Overlay project on user (project wins). Useful for doctor diagnostics. */
  merge?: boolean;
}

/**
 * Load configuration. Returns null if no config exists at the resolved scope.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<VibeConfig | null> {
  const { scope, cwd, merge } = options;

  if (merge) {
    const user = await readConfigFile(USER_CONFIG_PATH);
    const project = await readConfigFile(getProjectConfigPath(cwd));
    if (!user && !project) return null;
    if (!user) return project;
    if (!project) return user;
    return {
      ...user,
      ...project,
      llm: { ...user.llm, ...project.llm },
      providers: { ...user.providers, ...project.providers },
      defaults: { ...user.defaults, ...project.defaults },
      repl: { ...user.repl, ...project.repl },
    };
  }

  if (scope) {
    return readConfigFile(getConfigPath(scope, cwd));
  }

  // Auto: project takes priority — using project means "user-scope is ignored".
  const project = await readConfigFile(getProjectConfigPath(cwd));
  if (project) return project;
  return readConfigFile(USER_CONFIG_PATH);
}

export interface SaveConfigOptions {
  /** Target scope. Default: "user" (back-compat with prior behavior). */
  scope?: Scope;
  /** Working directory for resolving the project scope. Default: process.cwd(). */
  cwd?: string;
}

/** Save configuration to the chosen scope. Default scope is "user". */
export async function saveConfig(
  config: VibeConfig,
  options: SaveConfigOptions = {},
): Promise<void> {
  const scope = options.scope ?? "user";
  const dir = getConfigDir(scope, options.cwd);
  const path = getConfigPath(scope, options.cwd);

  await mkdir(dir, { recursive: true });
  const content = stringify(config, { indent: 2, lineWidth: 0 });
  await writeFile(path, content, "utf-8");
}

/**
 * Check if any configuration is present and the primary LLM provider has a
 * key (in the active scope or the environment).
 */
export async function isConfigured(): Promise<boolean> {
  const config = await loadConfig();
  if (!config) return false;

  const provider = config.llm.provider;
  const providerKey =
    provider === "gemini" ? "google" : provider === "claude" ? "anthropic" : provider;

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
 * Get an API key. Auto-detects scope (project > user) and falls through to
 * the provider's environment variable if neither config has it.
 */
export async function getApiKeyFromConfig(providerKey: string): Promise<string | undefined> {
  const config = await loadConfig();
  if (config?.providers[providerKey as keyof typeof config.providers]) {
    return config.providers[providerKey as keyof typeof config.providers];
  }

  const envVar = PROVIDER_ENV_VARS[providerKey];
  if (envVar) return process.env[envVar];
  return undefined;
}

/**
 * Update a provider key in the active scope (project if present, else user).
 * Pass `{scope}` to force a specific destination.
 */
export async function updateProviderKey(
  providerKey: string,
  apiKey: string,
  options: SaveConfigOptions = {},
): Promise<void> {
  const scope = options.scope ?? (await getActiveScope(options.cwd));
  let config = await loadConfig({ scope, cwd: options.cwd });
  if (!config) config = createDefaultConfig();

  config.providers[providerKey as keyof typeof config.providers] = apiKey;
  await saveConfig(config, { scope, cwd: options.cwd });
}

// Re-export types
export type { VibeConfig, LLMProvider } from "./schema.js";
export { createDefaultConfig, PROVIDER_NAMES, PROVIDER_ENV_VARS } from "./schema.js";
