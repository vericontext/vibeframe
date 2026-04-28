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
  return 81;
}

function countManifestTools() {
  const manifestDir = path.resolve(__dirname, "../../packages/cli/src/tools/manifest");
  let total = 0;
  let agentOnly = 0;
  let mcpOnly = 0;
  try {
    const files = fs.readdirSync(manifestDir).filter(
      (f) => f.endsWith(".ts") && f !== "index.ts",
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(manifestDir, file), "utf8");
      total += (content.match(/defineTool\(\{/g) ?? []).length;
      const lines = content.split(/\r?\n/).map((line) => line.trim());
      agentOnly += lines.filter((line) => line === 'surfaces: ["agent"],').length;
      mcpOnly += lines.filter((line) => line === 'surfaces: ["mcp"],').length;
    }
  } catch {
    return { mcp: 66, agent: 82 };
  }
  if (total === 0) return { mcp: 66, agent: 82 };
  return {
    mcp: total - agentOnly,
    agent: total - mcpOnly,
  };
}

const agentTypesFile = path.resolve(__dirname, "../../packages/cli/src/agent/types.ts");
const aiProvidersDir = path.resolve(__dirname, "../../packages/ai-providers/src");

const cliCommands = countCliCommands();
const toolCounts = countManifestTools();
const agentTools = toolCounts.agent;
const mcpTools = toolCounts.mcp;
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
  transpilePackages: ["@vibeframe/core", "@vibeframe/ui"],
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
