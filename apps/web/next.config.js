const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

// ── Extract counts from CLI source (build-time SSOT) ────────────────────

function countPattern(dir, pattern) {
  let total = 0;
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      const matches = content.match(new RegExp(pattern, "g"));
      if (matches) total += matches.length;
    }
  } catch {
    // Fallback: directory not found (e.g., Vercel build without full monorepo)
  }
  return total;
}

function countInFile(filePath, pattern) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.match(new RegExp(pattern, "g"));
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

const cliToolsDir = path.resolve(__dirname, "../../packages/cli/src/agent/tools");
const mcpToolsDir = path.resolve(__dirname, "../../packages/mcp-server/src/tools");
const agentTypesFile = path.resolve(__dirname, "../../packages/cli/src/agent/types.ts");

const agentTools = countPattern(cliToolsDir, "ToolDefinition = \\{") || 58;
const mcpTools = countPattern(mcpToolsDir, 'name: "') || 27;
const llmProviders = countInFile(agentTypesFile, '"[a-z]+"') || 6;

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vibe-edit/core", "@vibe-edit/ui"],
  experimental: {
    optimizePackageImports: ["@radix-ui/react-icons"],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_AGENT_TOOLS: String(agentTools),
    NEXT_PUBLIC_MCP_TOOLS: String(mcpTools),
    NEXT_PUBLIC_LLM_PROVIDERS: String(llmProviders),
  },
};

module.exports = nextConfig;
