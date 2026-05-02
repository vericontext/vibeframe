/**
 * Core types for the VibeFrame Agentic System
 */

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /**
   * Product-facing classification propagated from the manifest. This is
   * separate from MCP/agent transport exposure and helps agents prefer the
   * intended public workflow over legacy or internal primitives.
   */
  surface?: "public" | "agent" | "advanced" | "legacy" | "internal";
  replacement?: string;
  note?: string;
  /**
   * Cost tier propagated from the manifest's `defineTool` declaration.
   * Five tiers (free / low / medium / high / very-high). Used by the
   * agent executor to decide whether a confirm prompt is mandatory.
   */
  cost?: "free" | "low" | "medium" | "high" | "very-high";
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  output: string;
  error?: string;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface AgentConfig {
  provider: LLMProvider;
  model?: string;
  maxTurns?: number;
  verbose?: boolean;
}

export type LLMProvider = "openai" | "claude" | "gemini" | "ollama" | "xai" | "openrouter";

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

export interface AgentContext {
  projectPath: string | null;
  workingDirectory: string;
}

export interface AgentTurn {
  input: string;
  response: string;
  toolsUsed: string[];
}
