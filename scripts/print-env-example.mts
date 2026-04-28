/**
 * @file scripts/print-env-example.mts
 * @description Regenerate `.env.example` from the `defineApiKey` registry in
 * `@vibeframe/ai-providers/api-keys.ts`.
 *
 * Run via `pnpm exec tsx scripts/print-env-example.mts > .env.example` (or
 * use `--check` to fail on drift). `sync-counts.sh` invokes this in
 * `--check` mode as part of the pre-push hook.
 *
 * Why dynamic import + .mts: identical reasoning to `print-counts.mts` —
 * tsx's static-import resolver routes through Node's CJS loader for
 * workspace deps and trips on packages whose `exports` are fine but whose
 * lookup misbehaves there. Dynamic `import()` uses the ESM resolver
 * cleanly. `.mts` forces ESM mode for top-level await.
 */

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

const { getAllApiKeys } = await import(
  "../packages/ai-providers/src/index.js"
);

const HEADER = `# VibeEdit Environment Variables
# Copy this file to .env and fill in your API keys
`;

function render(): string {
  const blocks = getAllApiKeys().map((k) => {
    const lines = ["", `# ${k.envExampleComment}`];
    // Extra lines (e.g. format hints) go BEFORE the "Get yours at" URL —
    // matches the v0.67 layout in `.env.example`.
    if (k.envExampleExtraLines) {
      for (const extra of k.envExampleExtraLines) lines.push(`# ${extra}`);
    }
    lines.push(`# Get yours at: ${k.envExampleUrl}`);
    lines.push(`${k.envVar}=`);
    return lines.join("\n");
  });
  return HEADER + blocks.join("\n") + "\n";
}

const args = process.argv.slice(2);
const checkMode = args.includes("--check");

const generated = render();

if (checkMode) {
  const envExamplePath = resolvePath(import.meta.dirname, "..", ".env.example");
  const current = await readFile(envExamplePath, "utf-8");
  if (current.trim() !== generated.trim()) {
    console.error(
      ".env.example is out of sync with `defineApiKey` declarations.\n" +
        "Run `pnpm exec tsx scripts/print-env-example.mts > .env.example` to regenerate.",
    );
    process.exit(1);
  }
  console.log(".env.example matches registry.");
} else {
  process.stdout.write(generated);
}
