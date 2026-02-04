/**
 * Claude LLM Adapter with tool_use
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter } from "./index.js";
import type {
  ToolDefinition,
  LLMResponse,
  AgentMessage,
  ToolCall,
  LLMProvider,
} from "../types.js";

export class ClaudeAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "claude";
  private client: Anthropic | null = null;
  private model: string = "claude-sonnet-4-20250514";

  async initialize(apiKey: string): Promise<void> {
    this.client = new Anthropic({ apiKey });
  }

  isInitialized(): boolean {
    return this.client !== null;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async chat(
    messages: AgentMessage[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error("Claude adapter not initialized");
    }

    // Extract system message
    const systemMessage = messages.find((m) => m.role === "system");
    const systemPrompt = systemMessage?.content || "";

    // Convert messages to Claude format
    const claudeMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        claudeMessages.push({
          role: "user",
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        const content: Anthropic.ContentBlockParam[] = [];

        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
        }

        if (content.length > 0) {
          claudeMessages.push({
            role: "assistant",
            content,
          });
        }
      } else if (msg.role === "tool") {
        claudeMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId!,
              content: msg.content,
            },
          ],
        });
      }
    }

    // Convert tools to Claude format
    const claudeTools: Anthropic.Tool[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.parameters.properties as Record<string, unknown>,
        required: tool.parameters.required,
      },
    }));

    // Make API call
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages,
      tools: claudeTools.length > 0 ? claudeTools : undefined,
    });

    // Parse response
    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    // Map stop reason
    let finishReason: LLMResponse["finishReason"] = "stop";
    if (response.stop_reason === "tool_use") {
      finishReason = "tool_calls";
    } else if (response.stop_reason === "max_tokens") {
      finishReason = "length";
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
    };
  }
}
