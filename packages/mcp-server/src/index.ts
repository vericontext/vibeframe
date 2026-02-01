#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { tools, handleToolCall } from "./tools/index.js";
import { resources, readResource } from "./resources/index.js";
import { prompts, getPrompt } from "./prompts/index.js";

/**
 * VibeFrame MCP Server
 *
 * Exposes VibeFrame functionality through the Model Context Protocol.
 * This allows Claude Desktop, Cursor, and other MCP clients to:
 * - Manipulate video timelines
 * - Access project state
 * - Use AI-powered editing features
 */
const server = new Server(
  {
    name: "vibeframe",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args || {});
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources };
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  return readResource(uri);
});

// List available prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts };
});

// Get prompt content
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return getPrompt(name, args || {});
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeFrame MCP Server started");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
