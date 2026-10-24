const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

// ── Extract counts from CLI source (build-time SSOT) ────────────────────

function countCliCommands() {
  const distCli = path.resolve(__dirname, "../../packages/cli/dist/index.js");
  try {
    const { execFileSync } = require("child_process");
    const raw = execFileSync(process.execPath, [distCli, "schema", "--list"], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.length;
  } catch {
    // Fallback below covers Vercel/source-only builds where dist is absent.
  }
  return 93;
}

// Matches scripts/print-counts.mts; used when the manifest sources are absent.
const MCP_TOOLS_FALLBACK = 77;

function countManifestTools() {
  const manifestDir = path.resolve(__dirname, "../../packages/cli/src/tools/manifest");
  let total = 0;
  try {
    const files = fs.readdirSync(manifestDir).filter(
      (f) => f.endsWith(".ts") && f !== "index.ts" && !f.endsWith(".test.ts"),
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(manifestDir, file), "utf8");
      total += (content.match(/defineTool\(\{/g) ?? []).length;
    }
  } catch {
    // Fallback below
  }
  return total || MCP_TOOLS_FALLBACK;
}

const aiProvidersDir = path.resolve(__dirname, "../../packages/ai-providers/src");

const cliCommands = countCliCommands();
const mcpTools = countManifestTools();

// Count AI provider directories: dirs that hold a `*Provider.ts`. Shared
// code (interface, catalog, shared, video, testing) has none. Match
// scripts/sync-counts.sh.
let aiProviders = 13;
try {
  const entries = fs.readdirSync(aiProvidersDir, { withFileTypes: true });
  aiProviders =
    entries.filter(
      (e) =>
        e.isDirectory() &&
        fs.readdirSync(path.join(aiProvidersDir, e.name)).some((f) => f.endsWith("Provider.ts"))
    ).length || 13;
} catch {
  // Fallback
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_CLI_COMMANDS: String(cliCommands),
    NEXT_PUBLIC_MCP_TOOLS: String(mcpTools),
    NEXT_PUBLIC_AI_PROVIDERS: String(aiProviders),
  },
};

module.exports = nextConfig;
