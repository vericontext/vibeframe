"use client";

import { useState } from "react";
import { Preview } from "@/components/preview/Preview";
import { Timeline } from "@/components/timeline/Timeline";
import { Library } from "@/components/library/Library";
import { ChatPanel } from "@/components/chat/ChatPanel";

export default function EditorPage() {
  const [showChat, setShowChat] = useState(true);

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-border bg-secondary px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-primary">VibeFrame</h1>
          <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowChat(!showChat)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            {showChat ? "Hide" : "Show"} Assistant
          </button>
          <button className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Export
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Library */}
        <aside className="w-64 flex-shrink-0 border-r border-border bg-secondary">
          <Library />
        </aside>

        {/* Center - Preview and Timeline */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Preview area */}
          <div className="flex-1 bg-background p-4">
            <Preview />
          </div>

          {/* Timeline area */}
          <div className="h-64 border-t border-border bg-secondary">
            <Timeline />
          </div>
        </div>

        {/* Right sidebar - Chat */}
        {showChat && (
          <aside className="w-80 flex-shrink-0 border-l border-border bg-secondary">
            <ChatPanel />
          </aside>
        )}
      </div>
    </main>
  );
}
