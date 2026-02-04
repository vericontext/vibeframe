/**
 * Conversation Memory Management
 */

import type { AgentMessage, ToolCall, ToolResult } from "../types.js";

/**
 * ConversationMemory class
 * Manages conversation history for the agent
 */
export class ConversationMemory {
  private messages: AgentMessage[] = [];
  private maxMessages: number;

  constructor(maxMessages: number = 100) {
    this.maxMessages = maxMessages;
  }

  /**
   * Add a system message
   */
  addSystem(content: string): void {
    // Replace existing system message or add new one
    const existingIndex = this.messages.findIndex((m) => m.role === "system");
    if (existingIndex !== -1) {
      this.messages[existingIndex] = { role: "system", content };
    } else {
      this.messages.unshift({ role: "system", content });
    }
  }

  /**
   * Add a user message
   */
  addUser(content: string): void {
    this.messages.push({ role: "user", content });
    this.trim();
  }

  /**
   * Add an assistant message
   */
  addAssistant(content: string, toolCalls?: ToolCall[]): void {
    this.messages.push({
      role: "assistant",
      content,
      toolCalls,
    });
    this.trim();
  }

  /**
   * Add a tool result message
   */
  addToolResult(toolCallId: string, result: ToolResult): void {
    const content = result.success
      ? result.output
      : `Error: ${result.error || "Unknown error"}`;

    this.messages.push({
      role: "tool",
      content,
      toolCallId,
    });
    this.trim();
  }

  /**
   * Get all messages
   */
  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  /**
   * Get messages for a specific role
   */
  getByRole(role: AgentMessage["role"]): AgentMessage[] {
    return this.messages.filter((m) => m.role === role);
  }

  /**
   * Get the last N messages
   */
  getLast(n: number): AgentMessage[] {
    return this.messages.slice(-n);
  }

  /**
   * Clear all messages except system
   */
  clear(): void {
    const system = this.messages.find((m) => m.role === "system");
    this.messages = system ? [system] : [];
  }

  /**
   * Clear all messages including system
   */
  clearAll(): void {
    this.messages = [];
  }

  /**
   * Get message count
   */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Trim messages to max limit (keep system + most recent)
   */
  private trim(): void {
    if (this.messages.length <= this.maxMessages) return;

    const system = this.messages.find((m) => m.role === "system");
    const nonSystem = this.messages.filter((m) => m.role !== "system");

    // Keep the most recent messages
    const toKeep = nonSystem.slice(-(this.maxMessages - 1));
    this.messages = system ? [system, ...toKeep] : toKeep;
  }

  /**
   * Summarize conversation for context compression
   */
  summarize(): string {
    const userMessages = this.getByRole("user");
    const summary = userMessages
      .slice(-5)
      .map((m) => `- ${m.content}`)
      .join("\n");

    return `Recent requests:\n${summary}`;
  }

  /**
   * Export conversation as JSON
   */
  toJSON(): AgentMessage[] {
    return this.messages;
  }

  /**
   * Import conversation from JSON
   */
  fromJSON(messages: AgentMessage[]): void {
    this.messages = messages;
  }
}
