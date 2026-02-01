"use client";

import React, { useCallback, useState, useRef } from "react";
import { Clip, Track, useTimelineStore } from "@vibe-edit/core";
import {
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ScissorsIcon,
  CopyIcon,
  TrashIcon,
} from "@vibe-edit/ui";

interface ClipProps {
  clip: Clip;
  zoom: number;
  track: Track;
}

type DragMode = "move" | "trim-start" | "trim-end" | null;

export function ClipComponent({ clip, zoom, track }: ClipProps) {
  const {
    sources,
    selectedClipIds,
    selectClip,
    moveClip,
    trimClipStart,
    trimClipEnd,
    removeClip,
  } = useTimelineStore();

  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalStartTime, setOriginalStartTime] = useState(0);
  const [originalDuration, setOriginalDuration] = useState(0);
  const clipRef = useRef<HTMLDivElement>(null);

  const source = sources.find((s) => s.id === clip.sourceId);
  const isSelected = selectedClipIds.includes(clip.id);

  const left = clip.startTime * zoom;
  const width = clip.duration * zoom;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode) => {
      if (track.isLocked) return;

      e.stopPropagation();
      setDragMode(mode);
      setDragStartX(e.clientX);
      setOriginalStartTime(clip.startTime);
      setOriginalDuration(clip.duration);

      if (!isSelected) {
        selectClip(clip.id, e.shiftKey);
      }
    },
    [track.isLocked, clip, isSelected, selectClip]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragMode) return;

      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / zoom;

      switch (dragMode) {
        case "move":
          moveClip(clip.id, track.id, Math.max(0, originalStartTime + deltaTime));
          break;
        case "trim-start":
          const newStartTime = Math.max(0, originalStartTime + deltaTime);
          const maxStartTime = originalStartTime + originalDuration - 0.1;
          trimClipStart(clip.id, Math.min(newStartTime, maxStartTime));
          break;
        case "trim-end":
          const newDuration = Math.max(0.1, originalDuration + deltaTime);
          trimClipEnd(clip.id, newDuration);
          break;
      }
    },
    [
      dragMode,
      dragStartX,
      zoom,
      clip.id,
      track.id,
      originalStartTime,
      originalDuration,
      moveClip,
      trimClipStart,
      trimClipEnd,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setDragMode(null);
  }, []);

  React.useEffect(() => {
    if (dragMode) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragMode, handleMouseMove, handleMouseUp]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      selectClip(clip.id, e.shiftKey);
    },
    [clip.id, selectClip]
  );

  const handleDelete = useCallback(() => {
    removeClip(clip.id);
  }, [clip.id, removeClip]);

  const clipColor =
    track.type === "video"
      ? "bg-primary/80 hover:bg-primary"
      : "bg-green-600/80 hover:bg-green-600";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={clipRef}
          className={cn(
            "absolute top-1 h-14 rounded cursor-pointer transition-colors",
            clipColor,
            isSelected && "ring-2 ring-white ring-offset-1 ring-offset-transparent",
            dragMode && "cursor-grabbing"
          )}
          style={{
            left: `${left}px`,
            width: `${Math.max(width, 4)}px`,
          }}
          onClick={handleClick}
          onMouseDown={(e) => handleMouseDown(e, "move")}
        >
          {/* Trim handles */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-l"
            onMouseDown={(e) => handleMouseDown(e, "trim-start")}
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 rounded-r"
            onMouseDown={(e) => handleMouseDown(e, "trim-end")}
          />

          {/* Clip content */}
          <div className="flex h-full items-center px-3 overflow-hidden">
            <span className="truncate text-xs font-medium text-white">
              {source?.name || "Unknown"}
            </span>
          </div>

          {/* Duration badge */}
          {width > 60 && (
            <div className="absolute bottom-1 right-2 text-[10px] text-white/70">
              {formatDuration(clip.duration)}
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem disabled>
          <ScissorsIcon className="mr-2 h-4 w-4" />
          Split at Playhead
        </ContextMenuItem>
        <ContextMenuItem disabled>
          <CopyIcon className="mr-2 h-4 w-4" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDelete} className="text-red-500">
          <TrashIcon className="mr-2 h-4 w-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
