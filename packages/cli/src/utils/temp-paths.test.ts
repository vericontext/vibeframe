/**
 * Temp files live in a private dir from `mkdtemp`, never at a guessable path.
 *
 * `/tmp/vibe_caption_${Date.now()}` can be pre-created or symlinked by
 * another user on a shared machine, and `mkdir({recursive: true})` happily
 * reuses it; a temp file named after the input lands next to the user's own
 * files. `mkdtemp` makes a fresh, owner-only dir with a random suffix and
 * fails rather than reuse one.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Files still being fixed in their own PR. Remove an entry when that PR lands. */
const PENDING: readonly string[] = ["commands/ai-highlights.ts"];

const GUESSABLE = [
  // A literal /tmp path.
  /["'`]\/tmp\//,
  // tmpdir() joined with a timestamp instead of mkdtemp.
  /tmpdir\(\)[^;\n]*Date\.now\(\)/,
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.includes(".test.") ? [path] : [];
  });
}

describe("temp paths", () => {
  it("no source file builds a guessable temp path", () => {
    const offenders = sources(SRC).flatMap((path) => {
      const rel = relative(SRC, path);
      if (PENDING.includes(rel)) return [];
      return readFileSync(path, "utf-8")
        .split("\n")
        .flatMap((line, i) => (GUESSABLE.some((re) => re.test(line)) ? [`${rel}:${i + 1}: ${line.trim()}`] : []));
    });
    expect(offenders).toEqual([]);
  });
});
