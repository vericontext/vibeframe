/**
 * Default output paths for paid generations run without `-o`, so a result
 * the user paid for always lands on disk instead of being dropped (images)
 * or left behind an expiring provider URL (videos).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** `out.png` → `out-2.png`. */
export function numberedPath(path: string, n: number): string {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)}-${n}${path.slice(dot)}` : `${path}-${n}`;
}

/**
 * The first of `name`, `name-2`, `name-3`, ... (before the extension) that
 * would not overwrite anything, counting the `-2`, `-3` siblings a
 * multi-image run writes next to it. Relative to `cwd`.
 */
export function defaultOutputPath(name: string, count = 1, cwd = process.cwd()): string {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : numberedPath(name, n);
    const paths = [candidate];
    for (let i = 2; i <= count; i++) paths.push(numberedPath(candidate, i));
    if (paths.every((path) => !existsSync(resolve(cwd, path)))) return candidate;
  }
}
