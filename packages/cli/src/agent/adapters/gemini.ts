/**
 * Gemini LLM Adapter with Function Calling
 */

import { GoogleGenerativeAI, SchemaType, type Content, type Part, type Tool as GeminiTool, type FunctionDeclarationSchemaProperty } from "@google/generative-ai";
import { GEMINI_AGENT_DEFAULT_TEXT_MODEL } from "@vibeframe/ai-providers";
import type { LLMAdapter } from "./index.js";
import type {
  ToolDefinition,
  LLMResponse,
  AgentMessage,
  ToolCall,
  LLMProvider,
} from "../types.js";

/**
 * Keys Gemini's function-declaration schema (an OpenAPI subset) accepts.
 * Anything else, such as the `additionalProperties` that `z.record()` emits,
 * makes generateContent reject the whole request with a 400.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
]);

/** Drop schema keys Gemini rejects, recursing into properties and items. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, prop]) => [name, toGeminiSchema(prop)])
      );
    } else if (key === "items") {
      out.items = toGeminiSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export class GeminiAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "gemini";
  private client: GoogleGenerativeAI | null = null;
  private model: string = GEMINI_AGENT_DEFAULT_TEXT_MODEL;

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
          properties: Object.fromEntries(
            Object.entries(tool.parameters.properties).map(([name, prop]) => [
              name,
              toGeminiSchema(prop) as FunctionDeclarationSchemaProperty,
            ])
          ),
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
        if (msg.providerContent) {
          geminiContents.push({ role: "model", parts: msg.providerContent as Part[] });
          continue;
        }
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
        // Gemini expects all function responses for one model turn in a
        // single user turn.
        const part: Part = {
          functionResponse: {
            name: msg.toolCallId!.split(":::")[0] || "unknown", // Extract function name from id
            response: { result: msg.content },
          },
        };
        const last = geminiContents.at(-1);
        if (last?.role === "user" && last.parts.every((p) => "functionResponse" in p)) {
          last.parts.push(part);
        } else {
          geminiContents.push({ role: "user", parts: [part] });
        }
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
      providerContent: candidate.content.parts,
    };
  }
}
