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
 * the current working directory or one of its parents, it is used and the user
 * config is ignored.
 * Pass `{scope:"user"}` or `{scope:"project"}` to force one side.
 *
 * Pass `{merge:true}` to overlay project on user (project wins). Used by
 * doctor to render "where did this key come from" diagnostics.
 */

import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { parse, stringify } from "yaml";
import {
  type VibeConfig,
  createDefaultConfig,
  PROVIDER_ENV_ALIASES,
  PROVIDER_ENV_VARS,
} from "./schema.js";

export type Scope = "user" | "project";

function resolveEnvPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? resolve(value) : null;
}

function resolveXdgAppDir(opts: {
  overrideEnv: string;
  xdgEnv: string;
  fallbackHomeRel: string;
}): string {
  const override = resolveEnvPath(opts.overrideEnv);
  if (override) return override;
  const xdgBase = resolveEnvPath(opts.xdgEnv);
  const base = xdgBase ?? resolve(homedir(), opts.fallbackHomeRel);
  return resolve(base, "vibeframe");
}

/** User-scope config directory (~/.vibeframe by default). */
export const USER_CONFIG_DIR =
  resolveEnvPath("VIBEFRAME_CONFIG_HOME") ?? resolve(homedir(), ".vibeframe");

/** User-scope config file (~/.vibeframe/config.yaml by default). */
export const USER_CONFIG_PATH = resolve(USER_CONFIG_DIR, "config.yaml");

/** User data directory (~/.local/share/vibeframe by default). */
export const USER_DATA_DIR = resolveXdgAppDir({
  overrideEnv: "VIBEFRAME_DATA_HOME",
  xdgEnv: "XDG_DATA_HOME",
  fallbackHomeRel: ".local/share",
});

/** User cache directory (~/.vibeframe/cache by default). */
export const USER_CACHE_DIR =
  resolveEnvPath("VIBEFRAME_CACHE_HOME") ?? resolve(USER_CONFIG_DIR, "cache");

/** Legacy user-scope config directory used by pre-XDG installs. */
export const LEGACY_USER_CONFIG_DIR = resolve(homedir(), ".vibeframe");

/** Legacy user-scope config file used by pre-XDG installs. */
export const LEGACY_USER_CONFIG_PATH = resolve(LEGACY_USER_CONFIG_DIR, "config.yaml");

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

export interface UserConfigStatus {
  /** True when either the primary config file or legacy ~/.vibeframe/config.yaml exists. */
  configured: boolean;
  /** Path loadConfig({scope:"user"}) will read from, or the write path when absent. */
  configPath: string;
  /** Write target for new user-scope saves. */
  writePath: string;
  /** Legacy fallback path. */
  legacyConfigPath: string;
  /** True when the primary write target exists. */
  primaryConfigured: boolean;
  /** True when the legacy fallback exists. */
  legacyConfigured: boolean;
  /** Source currently used for user-scope reads. */
  source: "user" | "legacy" | null;
}

export async function getUserConfigStatus(): Promise<UserConfigStatus> {
  const primaryConfigured = await fileExists(USER_CONFIG_PATH);
  const legacyConfigured =
    LEGACY_USER_CONFIG_PATH === USER_CONFIG_PATH
      ? primaryConfigured
      : await fileExists(LEGACY_USER_CONFIG_PATH);
  const source = primaryConfigured
    ? "user"
    : legacyConfigured && LEGACY_USER_CONFIG_PATH !== USER_CONFIG_PATH
      ? "legacy"
      : null;
  return {
    configured: primaryConfigured || legacyConfigured,
    configPath:
      source === "user"
        ? USER_CONFIG_PATH
        : source === "legacy"
          ? LEGACY_USER_CONFIG_PATH
          : USER_CONFIG_PATH,
    writePath: USER_CONFIG_PATH,
    legacyConfigPath: LEGACY_USER_CONFIG_PATH,
    primaryConfigured,
    legacyConfigured,
    source,
  };
}

export async function findProjectConfigPath(cwd: string = process.cwd()): Promise<string | null> {
  let dir = resolve(cwd);
  const homeDir = resolve(homedir());
  for (;;) {
    if (dir === homeDir) return null;
    const candidate = getProjectConfigPath(dir);
    if (
      candidate !== USER_CONFIG_PATH &&
      candidate !== LEGACY_USER_CONFIG_PATH &&
      (await fileExists(candidate))
    ) {
      return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The scope that `loadConfig()` will read from when called without an
 * explicit scope. Returns `"project"` if a project config exists at cwd or an
 * ancestor directory, else `"user"` (regardless of whether the user file exists).
 */
export async function getActiveScope(cwd?: string): Promise<Scope> {
  return (await findProjectConfigPath(cwd)) ? "project" : "user";
}

function applyDefaults(parsed: VibeConfig): VibeConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...parsed,
    llm: { ...defaults.llm, ...parsed.llm },
    providers: { ...defaults.providers, ...parsed.providers },
    defaults: { ...defaults.defaults, ...parsed.defaults },
    upload: {
      ...defaults.upload,
      ...parsed.upload,
      s3: { ...defaults.upload.s3, ...parsed.upload?.s3 },
    },
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

async function readUserConfigFile(): Promise<VibeConfig | null> {
  if (await fileExists(USER_CONFIG_PATH)) return readConfigFile(USER_CONFIG_PATH);
  if (await fileExists(LEGACY_USER_CONFIG_PATH)) return readConfigFile(LEGACY_USER_CONFIG_PATH);
  return null;
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
    const user = await readUserConfigFile();
    const projectPath = await findProjectConfigPath(cwd);
    const project = projectPath ? await readConfigFile(projectPath) : null;
    if (!user && !project) return null;
    if (!user) return project;
    if (!project) return user;
    return {
      ...user,
      ...project,
      llm: { ...user.llm, ...project.llm },
      providers: { ...user.providers, ...project.providers },
      defaults: { ...user.defaults, ...project.defaults },
      upload: {
        ...user.upload,
        ...project.upload,
        s3: { ...user.upload.s3, ...project.upload.s3 },
      },
      repl: { ...user.repl, ...project.repl },
    };
  }

  if (scope) {
    return scope === "user" ? readUserConfigFile() : readConfigFile(getConfigPath(scope, cwd));
  }

  // Auto: nearest project config takes priority — using project means
  // "user-scope is ignored".
  const projectPath = await findProjectConfigPath(cwd);
  const project = projectPath ? await readConfigFile(projectPath) : null;
  if (project) return project;
  return readUserConfigFile();
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
  options: SaveConfigOptions = {}
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
export async function isConfigured(options: Pick<LoadConfigOptions, "cwd"> = {}): Promise<boolean> {
  const config = await loadConfig({ cwd: options.cwd });
  if (!config) return false;

  const provider = config.llm.provider;
  const providerKey =
    provider === "gemini" ? "google" : provider === "claude" ? "anthropic" : provider;

  if (config.providers[providerKey as keyof typeof config.providers]) {
    return true;
  }

  const envVar = PROVIDER_ENV_VARS[providerKey];
  if (envVar && getEnvValue(envVar)) {
    return true;
  }

  return false;
}

/**
 * Get an API key. Auto-detects scope (project > user) and falls through to
 * the provider's environment variable if neither config has it.
 */
export async function getApiKeyFromConfig(
  providerKey: string,
  options: Pick<LoadConfigOptions, "cwd"> = {}
): Promise<string | undefined> {
  const config = await loadConfig({ cwd: options.cwd });
  if (config?.providers[providerKey as keyof typeof config.providers]) {
    return config.providers[providerKey as keyof typeof config.providers];
  }

  const envVar = PROVIDER_ENV_VARS[providerKey];
  if (envVar) return getEnvValue(envVar);
  return undefined;
}

function getEnvValue(envVar: string): string | undefined {
  return (
    process.env[envVar] ||
    PROVIDER_ENV_ALIASES[envVar]?.map((alias) => process.env[alias]).find(Boolean)
  );
}

/**
 * Update a provider key in the active scope (project if present, else user).
 * Pass `{scope}` to force a specific destination.
 */
export async function updateProviderKey(
  providerKey: string,
  apiKey: string,
  options: SaveConfigOptions = {}
): Promise<void> {
  const scope = options.scope ?? (await getActiveScope(options.cwd));
  let config = await loadConfig({ scope, cwd: options.cwd });
  if (!config) config = createDefaultConfig();

  config.providers[providerKey as keyof typeof config.providers] = apiKey;
  await saveConfig(config, { scope, cwd: options.cwd });
}

// Re-export types
export type { VibeConfig, LLMProvider } from "./schema.js";
export {
  createDefaultConfig,
  PROVIDER_NAMES,
  PROVIDER_ENV_ALIASES,
  PROVIDER_ENV_VARS,
} from "./schema.js";
