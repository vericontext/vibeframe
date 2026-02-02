"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useTimelineStore } from "@vibeframe/core";
import { Button, cn } from "@vibeframe/ui";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm your VibeFrame assistant. Tell me what you want to do with your video, like \"trim the intro to 3 seconds and add fade out\" or \"add a fade in to the first clip\".",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { clips, addEffect, trimClipEnd } = useTimelineStore();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const parseAndExecuteCommand = useCallback(
    async (command: string): Promise<string> => {
      const lowerCommand = command.toLowerCase();

      // Simple command parsing (in production, this would use AI)
      if (clips.length === 0) {
        return "No clips in the timeline yet. Add some media first!";
      }

      const responses: string[] = [];

      // Trim command
      const trimMatch = lowerCommand.match(
        /(?:trim|shorten|cut)/i
      );
      const durationMatch = lowerCommand.match(/(\d+)\s*(?:s|sec|seconds?)/);

      if (trimMatch && durationMatch) {
        const duration = parseInt(durationMatch[1]);
        clips.forEach((clip) => {
          trimClipEnd(clip.id, duration);
        });
        responses.push(`Trimmed clips to ${duration} seconds.`);
      }

      // Fade in command
      if (/fade\s*in/i.test(lowerCommand)) {
        const firstClip = clips[0];
        if (firstClip) {
          addEffect(firstClip.id, {
            type: "fadeIn",
            startTime: 0,
            duration: 1,
            params: { intensity: 1 },
          });
          responses.push("Added fade in effect to the first clip.");
        }
      }

      // Fade out command
      if (/fade\s*out/i.test(lowerCommand)) {
        const lastClip = clips[clips.length - 1];
        if (lastClip) {
          addEffect(lastClip.id, {
            type: "fadeOut",
            startTime: lastClip.duration - 1,
            duration: 1,
            params: { intensity: 1 },
          });
          responses.push("Added fade out effect to the last clip.");
        }
      }

      if (responses.length === 0) {
        return "I understood your request, but couldn't find a matching command. Try something like:\n• \"Trim to 5 seconds\"\n• \"Add fade in\"\n• \"Add fade out\"";
      }

      return responses.join(" ");
    },
    [clips, addEffect, trimClipEnd]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isProcessing) return;

      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: input.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsProcessing(true);

      try {
        const response = await parseAndExecuteCommand(userMessage.content);

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsProcessing(false);
        inputRef.current?.focus();
      }
    },
    [input, isProcessing, parseAndExecuteCommand]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center border-b border-border px-3">
        <span className="text-sm font-medium text-foreground">
          Vibe Assistant
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              message.role === "user"
                ? "ml-8 bg-primary text-primary-foreground"
                : "mr-8 bg-muted text-foreground"
            )}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
        {isProcessing && (
          <div className="mr-8 rounded-lg bg-muted px-3 py-2">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: "0.1s" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: "0.2s" }}
              />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me what to do..."
            className="flex-1 rounded-md bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            disabled={isProcessing}
          />
          <Button type="submit" size="sm" disabled={isProcessing || !input.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
