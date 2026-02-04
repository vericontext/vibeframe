/**
 * AgentExecutor - Main Agentic Loop
 * Orchestrates LLM reasoning and tool execution
 */

import type {
  AgentConfig,
  AgentMessage,
  AgentContext,
  ToolCall,
  ToolResult,
  LLMProvider,
} from "./types.js";
import type { LLMAdapter } from "./adapters/index.js";
import { createAdapter } from "./adapters/index.js";
import { ToolRegistry, registerAllTools } from "./tools/index.js";
import { getSystemPrompt } from "./prompts/system.js";
import { ConversationMemory } from "./memory/index.js";

export interface AgentExecutorOptions {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  maxTurns?: number;
  verbose?: boolean;
  projectPath?: string;
  /**
   * Callback to confirm before executing each tool.
   * Return true to execute, false to skip.
   */
  confirmCallback?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
}

export interface ExecutionResult {
  response: string;
  toolsUsed: string[];
  turns: number;
}

/**
 * AgentExecutor class
 * Handles the agentic loop: reason → tool call → result → reason → ...
 */
export class AgentExecutor {
  private adapter: LLMAdapter | null = null;
  private registry: ToolRegistry;
  private memory: ConversationMemory;
  private context: AgentContext;
  private config: AgentExecutorOptions;
  private initialized = false;

  constructor(options: AgentExecutorOptions) {
    this.config = {
      maxTurns: 10,
      verbose: false,
      ...options,
    };
    this.registry = new ToolRegistry();
    this.memory = new ConversationMemory();
    this.context = {
      projectPath: options.projectPath || null,
      workingDirectory: process.cwd(),
    };
  }

  /**
   * Initialize the agent
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create and initialize LLM adapter
    this.adapter = await createAdapter(this.config.provider);
    await this.adapter.initialize(this.config.apiKey);

    // Register all tools
    await registerAllTools(this.registry);

    // Add system message
    const systemPrompt = getSystemPrompt(this.context);
    this.memory.addSystem(systemPrompt);

    this.initialized = true;

    if (this.config.verbose) {
      console.log(`[Agent] Initialized with ${this.registry.size} tools`);
      console.log(`[Agent] Provider: ${this.config.provider}`);
    }
  }

  /**
   * Execute a user request
   */
  async execute(userInput: string): Promise<ExecutionResult> {
    if (!this.initialized || !this.adapter) {
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    // Add user message
    this.memory.addUser(userInput);

    const toolsUsed: string[] = [];
    let turns = 0;

    // Agentic loop
    while (turns < this.config.maxTurns!) {
      turns++;

      if (this.config.verbose) {
        console.log(`[Agent] Turn ${turns}`);
      }

      // Get LLM response
      const response = await this.adapter.chat(
        this.memory.getMessages(),
        this.registry.getDefinitions()
      );

      // Handle tool calls
      if (response.finishReason === "tool_calls" && response.toolCalls) {
        // Add assistant message with tool calls
        this.memory.addAssistant(response.content, response.toolCalls);

        // Execute each tool
        for (const toolCall of response.toolCalls) {
          if (this.config.verbose) {
            console.log(`[Agent] Calling tool: ${toolCall.name}`);
            console.log(`[Agent] Args: ${JSON.stringify(toolCall.arguments)}`);
          }

          const result = await this.executeTool(toolCall);
          toolsUsed.push(toolCall.name);

          // Add tool result
          this.memory.addToolResult(toolCall.id, result);

          if (this.config.verbose) {
            console.log(`[Agent] Result: ${result.success ? "success" : "error"}`);
            if (result.output) {
              console.log(`[Agent] Output: ${result.output.substring(0, 200)}...`);
            }
          }
        }

        // Continue loop to get next response
        continue;
      }

      // No more tool calls - we're done
      this.memory.addAssistant(response.content);

      return {
        response: response.content,
        toolsUsed: [...new Set(toolsUsed)], // Deduplicate
        turns,
      };
    }

    // Max turns reached
    return {
      response: "Maximum turns reached. Please try breaking down your request.",
      toolsUsed: [...new Set(toolsUsed)],
      turns,
    };
  }

  /**
   * Execute a single tool
   */
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    // Check confirmCallback if set
    if (this.config.confirmCallback) {
      const confirmed = await this.config.confirmCallback(
        toolCall.name,
        toolCall.arguments
      );
      if (!confirmed) {
        return {
          toolCallId: toolCall.id,
          success: false,
          output: "Tool execution skipped by user",
        };
      }
    }

    const result = await this.registry.execute(
      toolCall.name,
      toolCall.arguments,
      this.context
    );
    result.toolCallId = toolCall.id;
    return result;
  }

  /**
   * Update context (e.g., when project changes)
   */
  updateContext(updates: Partial<AgentContext>): void {
    this.context = { ...this.context, ...updates };
  }

  /**
   * Reset conversation memory
   */
  reset(): void {
    this.memory.clear();
    const systemPrompt = getSystemPrompt(this.context);
    this.memory.addSystem(systemPrompt);
  }

  /**
   * Get current context
   */
  getContext(): AgentContext {
    return { ...this.context };
  }

  /**
   * Get conversation history
   */
  getHistory(): AgentMessage[] {
    return this.memory.getMessages();
  }

  /**
   * Get available tools
   */
  getTools(): string[] {
    return this.registry.list();
  }
}

// Re-export types
export type { AgentConfig, AgentContext, AgentMessage, ToolCall, ToolResult } from "./types.js";
export type { LLMAdapter } from "./adapters/index.js";
export { ToolRegistry } from "./tools/index.js";
export { ConversationMemory } from "./memory/index.js";
