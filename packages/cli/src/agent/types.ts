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

export type LLMProvider = "openai" | "claude" | "gemini" | "ollama" | "xai";

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
