"use client";

import React, { useCallback } from "react";
import { MediaSource, useTimelineStore } from "@vibeframe/core";
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  FileVideoIcon,
  ImageIcon,
  TrashIcon,
} from "@vibeframe/ui";

interface MediaItemProps {
  source: MediaSource;
}

export function MediaItem({ source }: MediaItemProps) {
  const { removeSource, tracks, addClip } = useTimelineStore();

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData("application/vibe-source-id", source.id);
      e.dataTransfer.effectAllowed = "copy";
    },
    [source.id]
  );

  const handleAddToTimeline = useCallback(() => {
    // Find appropriate track
    const targetTrack = tracks.find((t) => t.type === source.type);
    if (!targetTrack) return;

    // Find the end time of existing clips on this track
    addClip({
      sourceId: source.id,
      trackId: targetTrack.id,
      startTime: 0, // Will be placed at the start, user can move it
      duration: source.duration,
      sourceStartOffset: 0,
      sourceEndOffset: source.duration,
    });
  }, [source, tracks, addClip]);

  const handleDelete = useCallback(() => {
    removeSource(source.id);
  }, [source.id, removeSource]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getIcon = () => {
    switch (source.type) {
      case "video":
        return <FileVideoIcon className="h-6 w-6" />;
      case "image":
        return <ImageIcon className="h-6 w-6" />;
      case "audio":
        return <AudioIcon className="h-6 w-6" />;
      default:
        return <FileVideoIcon className="h-6 w-6" />;
    }
  };

  const getTypeColor = () => {
    switch (source.type) {
      case "video":
        return "bg-primary/20 text-primary";
      case "audio":
        return "bg-green-600/20 text-green-500";
      case "image":
        return "bg-blue-500/20 text-blue-500";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative cursor-grab rounded-lg border border-border bg-muted/50 p-2 transition-colors hover:border-primary/50 hover:bg-muted active:cursor-grabbing"
          draggable
          onDragStart={handleDragStart}
          onDoubleClick={handleAddToTimeline}
        >
          {/* Thumbnail */}
          <div
            className={cn(
              "flex h-16 items-center justify-center rounded",
              getTypeColor()
            )}
          >
            {source.thumbnail ? (
              <img
                src={source.thumbnail}
                alt={source.name}
                className="h-full w-full object-cover rounded"
              />
            ) : (
              getIcon()
            )}
          </div>

          {/* Info */}
          <div className="mt-2">
            <p className="truncate text-xs font-medium text-foreground">
              {source.name}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {formatDuration(source.duration)}
              {source.width && source.height && (
                <span className="ml-1">
                  • {source.width}x{source.height}
                </span>
              )}
            </p>
          </div>

          {/* Type badge */}
          <div
            className={cn(
              "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase",
              getTypeColor()
            )}
          >
            {source.type}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onClick={handleAddToTimeline}>
          Add to Timeline
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDelete} className="text-red-500">
          <TrashIcon className="mr-2 h-4 w-4" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AudioIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
