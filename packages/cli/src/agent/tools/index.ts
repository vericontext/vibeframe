/**
 * Tool Registry - Central registry for all agent tools
 */

import type { ToolDefinition, ToolResult, AgentContext } from "../types.js";

export type ToolHandler = (
  args: Record<string, unknown>,
  context: AgentContext
) => Promise<ToolResult>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/**
 * Tool Registry class
 * Manages tool definitions and execution
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a tool
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /**
   * Get all tool definitions
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get a specific tool definition
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Get a specific tool definition (alias for getDefinition)
   */
  get(name: string): ToolDefinition | undefined {
    return this.getDefinition(name);
  }

  /**
   * Get all tool definitions (alias for getDefinitions)
   */
  getAll(): ToolDefinition[] {
    return this.getDefinitions();
  }

  /**
   * Get a tool handler by name
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler;
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: AgentContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      return await tool.handler(args, context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * List all tool names
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Global registry instance
export const toolRegistry = new ToolRegistry();

// Re-export tool modules
export { registerProjectTools } from "./project.js";
export { registerTimelineTools } from "./timeline.js";
export { registerFilesystemTools } from "./filesystem.js";
export { registerMediaTools } from "./media.js";
export { registerAITools } from "./ai.js";
export { registerExportTools } from "./export.js";
export { registerBatchTools } from "./batch.js";

/**
 * Register all tools
 */
export async function registerAllTools(registry: ToolRegistry): Promise<void> {
  const { registerProjectTools } = await import("./project.js");
  const { registerTimelineTools } = await import("./timeline.js");
  const { registerFilesystemTools } = await import("./filesystem.js");
  const { registerMediaTools } = await import("./media.js");
  const { registerAITools } = await import("./ai.js");
  const { registerExportTools } = await import("./export.js");
  const { registerBatchTools } = await import("./batch.js");

  registerProjectTools(registry);
  registerTimelineTools(registry);
  registerFilesystemTools(registry);
  registerMediaTools(registry);
  registerAITools(registry);
  registerExportTools(registry);
  registerBatchTools(registry);
}
