/**
 * @module utils/project-resolver
 *
 * Single resolver for "where is the timeline file?" The CLI accepts three
 * input shapes:
 *
 *   1. Direct file path: passed through as-is.
 *   2. Directory: looks for `timeline.json` first (canonical),
 *      falls back to an existing `project.vibe.json` (legacy).
 *   3. Non-existent path: passed through so the caller surfaces the error.
 *
 * `detectSceneProject(dir)` answers "is this a scene project directory?"
 * (i.e. has `vibe.project.yaml`). Used to give a useful error when the
 * user runs `vibe timeline info` on a scene directory.
 */

import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";

export const TIMELINE_FILENAME = "timeline.json";
export const LEGACY_TIMELINE_FILENAME = "project.vibe.json";
export const SCENE_CONFIG_FILENAME = "vibe.project.yaml";

/**
 * Resolve `inputPath` to a concrete timeline file path.
 *
 * Directory inputs prefer `timeline.json`; if absent, fall back to an existing
 * legacy `project.vibe.json`. Empty directories resolve to `timeline.json` so
 * the caller surfaces a canonical missing-file error. File inputs and unknown
 * paths pass through unchanged.
 */
export async function resolveTimelineFile(
  inputPath: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const filePath = resolve(cwd, inputPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      const canonical = resolve(filePath, TIMELINE_FILENAME);
      try {
        await access(canonical);
        return canonical;
      } catch {
        // Fall through to legacy
      }
      const legacy = resolve(filePath, LEGACY_TIMELINE_FILENAME);
      try {
        await access(legacy);
        return legacy;
      } catch {
        return canonical;
      }
    }
  } catch {
    // Path doesn't exist — let caller surface the error
  }

  return filePath;
}

/** True when the directory contains `vibe.project.yaml`. */
export async function detectSceneProject(dir: string): Promise<boolean> {
  try {
    await access(resolve(dir, SCENE_CONFIG_FILENAME));
    return true;
  } catch {
    return false;
  }
}
