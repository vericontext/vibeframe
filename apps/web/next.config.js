const fs = require("fs");
const path = require("path");
const pkg = require("./package.json");

// ── Extract counts from CLI source (build-time SSOT) ────────────────────

function countPattern(dir, pattern) {
  let total = 0;
  try {
    // Exclude *.test.ts — fixture strings in tests (e.g. `name: "intro"`
    // inside a handleSceneToolCall arg) get caught by the production regex
    // and over-count by 1+. The MCP server actually registers 58 tools at
    // runtime, not 59.
    const files = fs.readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
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
const cliCommandsDir = path.resolve(__dirname, "../../packages/cli/src/commands");
const mcpToolsDir = path.resolve(__dirname, "../../packages/mcp-server/src/tools");
const agentTypesFile = path.resolve(__dirname, "../../packages/cli/src/agent/types.ts");
const aiProvidersDir = path.resolve(__dirname, "../../packages/ai-providers/src");

const agentTools = countPattern(cliToolsDir, "ToolDefinition = \\{") || 58;
const cliCommands = countPattern(cliCommandsDir, '\\.command\\("[a-z]') || 107;
const mcpTools = countPattern(mcpToolsDir, 'name: "') || 27;
// Count LLM providers from the LLMProvider type union (e.g., "openai" | "claude" | ...)
let llmProviders = 6;
try {
  const typesContent = fs.readFileSync(agentTypesFile, "utf8");
  const providerLine = typesContent.match(/LLMProvider\s*=\s*(.+)/);
  if (providerLine) {
    const matches = providerLine[1].match(/"[a-z]+"/g);
    if (matches) llmProviders = matches.length;
  }
} catch {
  // Fallback
}

// Count unique AI provider directories (each dir = one provider service)
let aiProviders = 11;
try {
  const entries = fs.readdirSync(aiProvidersDir, { withFileTypes: true });
  aiProviders = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "interface").length || 11;
} catch {
  // Fallback
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@vibe-edit/core", "@vibe-edit/ui"],
  experimental: {
    optimizePackageImports: ["@radix-ui/react-icons"],
  },
  env: {
    NEXT_PUBLIC_VERSION: pkg.version,
    NEXT_PUBLIC_AGENT_TOOLS: String(agentTools),
    NEXT_PUBLIC_CLI_COMMANDS: String(cliCommands),
    NEXT_PUBLIC_MCP_TOOLS: String(mcpTools),
    NEXT_PUBLIC_LLM_PROVIDERS: String(llmProviders),
    NEXT_PUBLIC_AI_PROVIDERS: String(aiProviders),
  },
};

module.exports = nextConfig;
