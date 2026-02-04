/**
 * Ollama LLM Adapter with JSON-based tool calling
 * Uses prompt engineering to simulate tool calling for local models
 */

import type { LLMAdapter } from "./index.js";
import type {
  ToolDefinition,
  LLMResponse,
  AgentMessage,
  ToolCall,
  LLMProvider,
} from "../types.js";

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export class OllamaAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "ollama";
  private baseUrl: string = "http://localhost:11434";
  private model: string = "llama3.2";
  private initialized: boolean = false;

  async initialize(apiKey: string): Promise<void> {
    // apiKey is ignored for Ollama, but we use it to set custom URL if provided
    if (apiKey && apiKey.startsWith("http")) {
      this.baseUrl = apiKey;
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setModel(model: string): void {
    this.model = model;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  async chat(
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (!this.initialized) {
      throw new Error("Ollama adapter not initialized");
    }

    // Build system prompt with tool definitions
    const systemMessage = messages.find((m) => m.role === "system");
    let systemPrompt = systemMessage?.content || "";

    if (tools.length > 0) {
      systemPrompt += "\n\n## IMPORTANT: Tool Usage Instructions\n";
      systemPrompt += "You have access to tools that you MUST use to complete tasks. Do NOT describe how to do something - USE THE TOOLS.\n\n";
      systemPrompt += "To call a tool, respond with ONLY a JSON object in this exact format:\n";
      systemPrompt += '```json\n{"tool_calls": [{"name": "tool_name", "arguments": {"param": "value"}}]}\n```\n\n';
      systemPrompt += "Example - If the user asks to list files:\n";
      systemPrompt += '```json\n{"tool_calls": [{"name": "fs_list", "arguments": {"path": "."}}]}\n```\n\n';
      systemPrompt += "Example - If the user asks to create a project:\n";
      systemPrompt += '```json\n{"tool_calls": [{"name": "project_create", "arguments": {"name": "my-project"}}]}\n```\n\n';
      systemPrompt += "RULES:\n";
      systemPrompt += "1. When asked to DO something, ALWAYS use the appropriate tool\n";
      systemPrompt += "2. Do NOT explain how to use terminal commands - use tools instead\n";
      systemPrompt += "3. After tool results, summarize what was done\n\n";
      systemPrompt += "## Available Tools:\n";

      for (const tool of tools) {
        systemPrompt += `\n### ${tool.name}\n`;
        systemPrompt += `${tool.description}\n`;
        const params = tool.parameters.properties;
        const required = tool.parameters.required || [];
        if (Object.keys(params).length > 0) {
          systemPrompt += `Parameters:\n`;
          for (const [name, param] of Object.entries(params)) {
            const req = required.includes(name) ? "(required)" : "(optional)";
            systemPrompt += `  - ${name} ${req}: ${(param as { description?: string }).description || ""}\n`;
          }
        }
      }
    }

    // Convert messages to Ollama format
    const ollamaMessages: { role: string; content: string }[] = [];

    // Add system message first
    ollamaMessages.push({
      role: "system",
      content: systemPrompt,
    });

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        ollamaMessages.push({
          role: "user",
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        let content = msg.content;

        // Include tool calls in content for context
        if (msg.toolCalls) {
          content += `\n\nTool calls made:\n${JSON.stringify({ tool_calls: msg.toolCalls }, null, 2)}`;
        }

        ollamaMessages.push({
          role: "assistant",
          content,
        });
      } else if (msg.role === "tool") {
        // Include tool results as user messages for context
        ollamaMessages.push({
          role: "user",
          content: `Tool result (${msg.toolCallId}):\n${msg.content}`,
        });
      }
    }

    // Make API call
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const content = data.message.content;

    // Try to parse tool calls from response
    const toolCalls = this.parseToolCalls(content);

    if (toolCalls.length > 0) {
      // Extract text content before the JSON
      const textContent = this.extractTextBeforeJson(content);

      return {
        content: textContent,
        toolCalls,
        finishReason: "tool_calls",
      };
    }

    return {
      content,
      finishReason: "stop",
    };
  }

  private parseToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    // Try to find JSON block with tool_calls
    const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            toolCalls.push({
              id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: tc.name,
              arguments: tc.arguments || {},
            });
          }
        }
      } catch {
        // Not valid JSON
      }
    }

    // Also try to find raw JSON object
    if (toolCalls.length === 0) {
      const rawJsonMatch = content.match(/\{"tool_calls":\s*\[[\s\S]*?\]\}/);
      if (rawJsonMatch) {
        try {
          const parsed = JSON.parse(rawJsonMatch[0]);
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            for (const tc of parsed.tool_calls) {
              toolCalls.push({
                id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: tc.name,
                arguments: tc.arguments || {},
              });
            }
          }
        } catch {
          // Not valid JSON
        }
      }
    }

    return toolCalls;
  }

  private extractTextBeforeJson(content: string): string {
    // Find the start of JSON block
    const jsonStart = content.indexOf("```json");
    if (jsonStart > 0) {
      return content.substring(0, jsonStart).trim();
    }

    const rawJsonStart = content.indexOf('{"tool_calls"');
    if (rawJsonStart > 0) {
      return content.substring(0, rawJsonStart).trim();
    }

    return "";
  }
}
