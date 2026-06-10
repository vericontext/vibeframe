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
import {
  applyWorkspaceEnv,
  buildServerInstructions,
  scrubUnresolvedUserConfigEnv,
} from "./instructions.js";

/**
 * VibeFrame MCP Server
 *
 * Exposes VibeFrame functionality through the Model Context Protocol.
 * This allows Claude Desktop, Cursor, and other MCP clients to:
 * - Manipulate video timelines
 * - Access project state
 * - Use AI-powered editing features
 */
/**
 * The stdio transport owns stdout: any stray console.log corrupts JSON-RPC
 * framing. The per-call capture in the MCP adapter covers synchronous tool
 * execution, but promoted (backgrounded) build/render work keeps running
 * after the capture is restored — so route console text output to stderr for
 * the lifetime of the process. (process.stdout.write itself is untouched;
 * the transport needs it.)
 */
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);

// Both must run before buildServerInstructions() reads process.cwd() and
// before any tool touches provider keys.
scrubUnresolvedUserConfigEnv();
applyWorkspaceEnv();

const server = new Server(
  {
    name: "vibeframe",
    // Stamped with the package version by build.js at bundle time.
    version: process.env.VIBE_MCP_SERVER_VERSION ?? "0.0.0-dev",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    instructions: buildServerInstructions(),
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const progressToken = request.params._meta?.progressToken;
  return handleToolCall(
    name,
    args || {},
    progressToken === undefined
      ? undefined
      : {
          onProgress: ({ progress, total, message }) => {
            // Fire-and-forget: a dropped notification must never fail the
            // tool call. Per MCP spec, clients reset their request timeout
            // on each notifications/progress for the request's token.
            void extra
              .sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: progress ?? 0,
                  ...(total !== undefined ? { total } : {}),
                  ...(message ? { message } : {}),
                },
              })
              .catch(() => undefined);
          },
        }
  );
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
