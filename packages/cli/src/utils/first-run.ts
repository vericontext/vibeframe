/**
 * First-run detection for VibeFrame CLI
 * Shows a welcome banner when user has never configured the tool
 */

import { access, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import chalk from "chalk";
import { CONFIG_PATH } from "../config/index.js";
import { PROVIDER_ENV_VARS } from "../config/schema.js";
import { loadEnv } from "./api-key.js";

/** Marker file to track if banner has been shown */
const BANNER_SHOWN_PATH = CONFIG_PATH.replace(/config\.yaml$/, ".banner-shown");

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

  // Check if config file exists
  try {
    await access(CONFIG_PATH);
    return false;
  } catch {
    // Config doesn't exist, check env vars
  }

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
  console.log(chalk.dim("  AI-native video editing from your terminal."));
  console.log();
  console.log(`  ${chalk.white("1.")} ${chalk.green("vibe setup")}         Configure API keys ${chalk.dim("(1 min)")}`);
  console.log(`  ${chalk.white("2.")} ${chalk.green("vibe doctor")}        Check system health`);
  console.log(`  ${chalk.white("3.")} ${chalk.green("vibe --help")}        See all commands`);
  console.log();
  console.log(chalk.dim("  No API keys yet? Try these offline:"));
  console.log(chalk.dim("    vibe edit silence-cut video.mp4 -o clean.mp4"));
  console.log(chalk.dim("    vibe detect scenes video.mp4"));
  console.log(chalk.dim("    vibe edit fade video.mp4 -o faded.mp4 --fade-in 1 --fade-out 1"));
  console.log();
}
