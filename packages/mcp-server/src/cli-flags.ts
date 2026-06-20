/**
 * Pre-flight CLI flag handling for the MCP server entry.
 *
 * The server normally speaks MCP over stdio and never reads argv, but a human
 * probing the package (`npx -y @vibeframe/mcp-server --help`) reasonably
 * expects `--help`/`--version` to print and exit instead of silently booting a
 * stdio server. This lives in its own module so it stays unit-testable — the
 * entry (`index.ts`) connects the transport at import time and is deliberately
 * not imported by tests.
 */

function usage(version: string): string {
  return [
    `VibeFrame MCP Server v${version}`,
    "",
    "AI-native video editing exposed over the Model Context Protocol (stdio).",
    "It is launched by an MCP client (Claude Desktop, Cursor, Claude Code), not",
    "run directly — there is normally nothing to interact with on the terminal.",
    "",
    "Add it to your client config:",
    "",
    '  {',
    '    "mcpServers": {',
    '      "vibeframe": {',
    '        "command": "npx",',
    '        "args": ["-y", "@vibeframe/mcp-server"]',
    '      }',
    '    }',
    '  }',
    "",
    "Options:",
    "  -h, --help     Show this help and exit",
    "  -V, --version  Print the version and exit",
    "",
    "Docs: https://github.com/vericontext/vibeframe#mcp-integration",
  ].join("\n");
}

/**
 * If argv requests help/version, print it and return true (caller should exit).
 * Returns false for normal startup (including unknown args, so the server still
 * boots and lets the MCP client drive it).
 */
export function handleCliFlags(argv: string[], version: string): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage(version));
    return true;
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(version);
    return true;
  }
  return false;
}
