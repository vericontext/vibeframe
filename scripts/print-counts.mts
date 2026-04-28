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
 *
 * Why this exists: the previous regex approach silently mis-counted whenever
 * a new file or surface filter was introduced (v0.66 PR3 broke counts by
 * lumping agent-only entries into MCP totals). One `manifest.filter(...)` is
 * a lot harder to drift than four greps.
 */

const { manifest } = await import("../packages/cli/src/tools/manifest/index.js");

const total = manifest.length;
const mcp = manifest.filter((t) => !t.surfaces || t.surfaces.includes("mcp")).length;
const agent = manifest.filter((t) => !t.surfaces || t.surfaces.includes("agent")).length;
const agentOnly = manifest.filter(
  (t) => t.surfaces && t.surfaces.length === 1 && t.surfaces[0] === "agent",
).length;
const mcpOnly = manifest.filter(
  (t) => t.surfaces && t.surfaces.length === 1 && t.surfaces[0] === "mcp",
).length;

console.log(
  JSON.stringify({
    total,
    mcp,
    agent,
    agentOnly,
    mcpOnly,
  }),
);
