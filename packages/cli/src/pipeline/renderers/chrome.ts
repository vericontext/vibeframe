/**
 * @module pipeline/renderers/chrome
 *
 * Shared Chrome/Chromium discovery + preflight used by every Hyperframes-
 * backed renderer (the FFmpeg-bridge backend in `hyperframes.ts` and the
 * direct scene renderer in `commands/_shared/scene-render.ts`). Centralised
 * so that adding a new candidate path or env var only touches one file.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CHROME_NOT_FOUND_REASON =
  "Chrome not found. Set HYPERFRAMES_CHROME_PATH, or install Chrome " +
  "(macOS: brew install --cask google-chrome · Linux: apt install chromium). " +
  "Run `vibe doctor` for details.";

/**
 * Walk the candidate list in priority order (env vars first, then puppeteer's
 * cache, then well-known system locations). Returns the first existing path,
 * or undefined when none are present.
 */
export function findChrome(): string | undefined {
  const candidates = [
    process.env.HYPERFRAMES_CHROME_PATH,
    process.env.CHROME_PATH,
    // puppeteer auto-downloaded headless shell
    join(homedir(), ".cache", "puppeteer", "chrome-headless-shell", "mac_arm-147.0.7727.56",
      "chrome-headless-shell-mac_arm", "chrome-headless-shell"),
    // system Chrome / Chromium
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return undefined;
}

/**
 * Returns `{ok: true}` when Chrome is available, otherwise a structured
 * `{ok: false, reason}` with installation guidance. Used by both the
 * `RenderBackend.preflight` interface and the standalone scene render path.
 */
export async function preflightChrome(): Promise<{ ok: true } | { ok: false; reason: string }> {
  return findChrome() ? { ok: true } : { ok: false, reason: CHROME_NOT_FOUND_REASON };
}
