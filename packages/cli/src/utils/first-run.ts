/**
 * First-run detection for VibeFrame CLI
 * Shows a welcome banner when user has never configured the tool
 */

import { access, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import chalk from "chalk";
import { USER_CONFIG_DIR, loadConfig } from "../config/index.js";
import { PROVIDER_ENV_VARS } from "../config/schema.js";
import { loadEnv } from "./api-key.js";

/** Marker file to track if banner has been shown */
const BANNER_SHOWN_PATH = `${USER_CONFIG_DIR}/.banner-shown`;

/**
 * Check if this is the user's first run (no config and no env vars set)
 */
export async function isFirstRun(): Promise<boolean> {
  // Check if banner was already shown
  try {
    await access(BANNER_SHOWN_PATH);
    return false;
  } catch {
    // Banner not shown yet
  }

  // Check if user config exists, including the legacy ~/.vibeframe fallback.
  if (await loadConfig({ scope: "user" })) return false;

  // Load .env files
  loadEnv();

  // Check if any provider API key is set in environment
  for (const envVar of Object.values(PROVIDER_ENV_VARS)) {
    if (process.env[envVar]) {
      return false;
    }
  }

  return true;
}

/**
 * Mark that the first-run banner has been shown (won't show again)
 */
export async function markBannerShown(): Promise<void> {
  try {
    await mkdir(dirname(BANNER_SHOWN_PATH), { recursive: true });
    await writeFile(BANNER_SHOWN_PATH, new Date().toISOString());
  } catch {
    // Best-effort
  }
}

/**
 * Show a friendly welcome banner for first-time users
 */
export function showFirstRunBanner(): void {
  console.log();
  console.log(chalk.cyan.bold("  Welcome to VibeFrame!"));
  console.log(chalk.dim("  Frontier video generation for your coding agent. Your keys, your ceiling."));
  console.log();
  console.log(
    `  ${chalk.white("1.")} ${chalk.green("vibe init demo --from \"30s video\"")}  Scaffold a project ${chalk.dim("(no key needed)")}`
  );
  console.log(
    `  ${chalk.white("2.")} ${chalk.green("vibe build demo --dry-run")}          Price it before any spend`
  );
  console.log(
    `  ${chalk.white("3.")} ${chalk.green("vibe setup")}                         Add provider keys when a step generates`
  );
  console.log();
  console.log(chalk.dim("  Try without keys:"));
  console.log(
    `    ${chalk.green("vibe build demo --dry-run --max-cost 5")}  See the cost gate refuse an over-budget build`
  );
  console.log(chalk.dim("    vibe demo                        Run sample edits on a test video"));
  console.log(chalk.dim("    vibe edit silence-cut video.mp4 -o clean.mp4"));
  console.log();
}
