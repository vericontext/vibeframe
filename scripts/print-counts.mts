/**
 * @file scripts/print-counts.ts
 * @description Manifest-driven SSOT count printer. Replaces the regex grep
 * counts that previously lived inline in `scripts/sync-counts.sh`.
 *
 * Outputs JSON on stdout — `sync-counts.sh` parses with `jq`. Run via
 * `pnpm exec tsx scripts/print-counts.ts` (no build step needed; tsx
 * resolves cross-workspace TS sources via dynamic import).
 *
 * Why dynamic import: tsx's static-import resolver routes through Node's
 * CJS loader for workspace deps and trips on packages whose `exports` are
 * fine but whose `main`/`module` lookup misbehaves under that path. The
 * dynamic `import()` form uses the ESM resolver and works cleanly.
 */

const { manifest } = await import("../packages/cli/src/tools/manifest/index.js");

console.log(JSON.stringify({ mcp: manifest.length }));
