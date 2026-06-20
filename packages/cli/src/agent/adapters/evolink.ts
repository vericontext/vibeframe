/**
 * Evolink LLM Adapter (OpenAI-compatible)
 * Routes to GPT-5, Claude, Gemini, DeepSeek & more via https://direct.evolink.ai/v1
 */

import OpenAI from "openai";
import type { LLMAdapter } from "./index.js";
import type {
  ToolDefinition,
  LLMResponse,
  AgentMessage,
  ToolCall,
  LLMProvider,
} from "../types.js";

export class EvolinkAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "evolink";
  private client: OpenAI | null = null;
  private model: string = "gpt-5.2";

  async initialize(apiKey: string): Promise<void> {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://direct.evolink.ai/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://vibeframe.dev",
        "X-Title": "VibeFrame",
      },
    });
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
      throw new Error("Evolink adapter not initialized");
    }

    // Convert messages to OpenAI format
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map(
      (msg) => {
        if (msg.role === "tool") {
          return {
            role: "tool" as const,
            tool_call_id: msg.toolCallId!,
            content: msg.content,
          };
        }
        if (msg.role === "assistant" && msg.toolCalls) {
          return {
            role: "assistant" as const,
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        return {
          role: msg.role as "system" | "user" | "assistant",
          content: msg.content,
        };
      }
    );

    // Convert tools to OpenAI format
    const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));

    // Make API call
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: openaiTools.length > 0 ? openaiTools : undefined,
      tool_choice: openaiTools.length > 0 ? "auto" : undefined,
    });

    const choice = response.choices[0];
    const message = choice.message;

    // Parse tool calls
    let toolCalls: ToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    // Map finish reason
    let finishReason: LLMResponse["finishReason"] = "stop";
    if (choice.finish_reason === "tool_calls") {
      finishReason = "tool_calls";
    } else if (choice.finish_reason === "length") {
      finishReason = "length";
    }

    return {
      content: message.content || "",
      toolCalls,
      finishReason,
    };
  }
}
