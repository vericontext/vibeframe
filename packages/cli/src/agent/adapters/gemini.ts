/**
 * Gemini LLM Adapter with Function Calling
 */

import { GoogleGenerativeAI, SchemaType, type Content, type Part, type Tool as GeminiTool, type FunctionDeclarationSchemaProperty } from "@google/generative-ai";
import type { LLMAdapter } from "./index.js";
import type {
  ToolDefinition,
  LLMResponse,
  AgentMessage,
  ToolCall,
  LLMProvider,
} from "../types.js";

export class GeminiAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "gemini";
  private client: GoogleGenerativeAI | null = null;
  private model: string = "gemini-2.5-flash";

  async initialize(apiKey: string): Promise<void> {
    this.client = new GoogleGenerativeAI(apiKey);
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
      throw new Error("Gemini adapter not initialized");
    }

    // Extract system message
    const systemMessage = messages.find((m) => m.role === "system");
    const systemInstruction = systemMessage?.content;

    // Convert tools to Gemini format
    const geminiTools: GeminiTool[] = tools.length > 0 ? [{
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: SchemaType.OBJECT,
          properties: tool.parameters.properties as Record<string, FunctionDeclarationSchemaProperty>,
          required: tool.parameters.required,
        },
      })),
    }] : [];

    // Get model with tools
    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction,
      tools: geminiTools.length > 0 ? geminiTools : undefined,
    });

    // Convert messages to Gemini format
    const geminiContents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      if (msg.role === "user") {
        geminiContents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        const parts: Part[] = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            });
          }
        }

        if (parts.length > 0) {
          geminiContents.push({
            role: "model",
            parts,
          });
        }
      } else if (msg.role === "tool") {
        // Gemini expects function responses in user turn
        geminiContents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: msg.toolCallId!.split(":::")[0] || "unknown", // Extract function name from id
              response: { result: msg.content },
            },
          }],
        });
      }
    }

    // Make API call
    const result = await model.generateContent({
      contents: geminiContents,
    });

    const response = result.response;
    const candidate = response.candidates?.[0];

    if (!candidate) {
      return {
        content: "",
        finishReason: "error",
      };
    }

    // Parse response
    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if ("text" in part && part.text) {
        textContent += part.text;
      } else if ("functionCall" in part && part.functionCall) {
        const fc = part.functionCall;
        toolCalls.push({
          id: `${fc.name}:::${Date.now()}`,
          name: fc.name,
          arguments: (fc.args || {}) as Record<string, unknown>,
        });
      }
    }

    // Map finish reason
    let finishReason: LLMResponse["finishReason"] = "stop";
    if (toolCalls.length > 0) {
      finishReason = "tool_calls";
    } else if (candidate.finishReason === "MAX_TOKENS") {
      finishReason = "length";
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
    };
  }
}
