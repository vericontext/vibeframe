/**
 * Regression cover for the `-q` flag collision (project memory:
 * `project_q_flag_collision.md`). The root `vibe` program declares
 * `-q, --quiet` (boolean), and four subcommands previously declared their
 * own `-q, --quality <quality>` shorthand. Commander resolves `-q` at the
 * parent level, so `vibe generate image -p openai -q hd "real prompt"`
 * silently parsed as `--quiet=true`, then `hd` became the `[prompt]`
 * positional, and the real prompt was dropped without error — users got a
 * generic stock-image hallucination from gpt-image-2.
 *
 * This test is a static guard against regressions: any subcommand that
 * registers `-q` as a value-taking shorthand is the bug coming back.
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Note: `ai-video-fx.ts` previously appeared here but was deleted alongside the
// dead `commands/ai.ts` orchestrator (the `vibe ai *` namespace was never
// `addCommand`'d to `program`). Its `-q` regression now lives in `edit-cmd.ts`
// (where the upscale-video / interpolate commands moved).
const FILES_THAT_PREVIOUSLY_HAD_DASH_Q = [
  "generate.ts",
  "ai-image.ts",
  "edit-cmd.ts",
];

describe("-q flag collision regression", () => {
  it.each(FILES_THAT_PREVIOUSLY_HAD_DASH_Q)(
    "%s does not register -q shorthand for --quality (collides with global --quiet)",
    async (filename) => {
      const path = resolve(here, filename);
      const src = await readFile(path, "utf8");
      // Match `.option("-q, ...` or `.option('-q, ...` — the exact form that
      // collided with the global `vibe -q,--quiet` flag.
      const offending = /\.option\s*\(\s*["']-q\s*,/.test(src);
      expect(offending, `${filename} re-introduced -q shorthand`).toBe(false);
    },
  );
});
