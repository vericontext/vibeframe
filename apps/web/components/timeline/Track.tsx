"use client";

import React, { useCallback } from "react";
import { Track as TrackType, Clip as ClipType, useTimelineStore } from "@vibe-edit/core";
import { ClipComponent } from "./Clip";
import { cn } from "@vibe-edit/ui";

interface TrackProps {
  track: TrackType;
  clips: ClipType[];
  zoom: number;
}

export function Track({ track, clips, zoom }: TrackProps) {
  const { addClip, sources } = useTimelineStore();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();

      const sourceId = e.dataTransfer.getData("application/vibe-source-id");
      if (!sourceId) return;

      const source = sources.find((s) => s.id === sourceId);
      if (!source) return;

      // Calculate drop position in timeline
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startTime = x / zoom;

      // Check if source type matches track type
      if (source.type !== track.type && !(source.type === "video" && track.type === "audio")) {
        return;
      }

      addClip({
        sourceId: source.id,
        trackId: track.id,
        startTime: Math.max(0, startTime),
        duration: source.duration,
        sourceStartOffset: 0,
        sourceEndOffset: source.duration,
      });
    },
    [zoom, track, sources, addClip]
  );

  return (
    <div
      className={cn(
        "relative h-16 border-b border-border",
        track.type === "video" ? "bg-secondary/30" : "bg-muted/30",
        track.isLocked && "opacity-50"
      )}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Grid lines */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="h-full w-full opacity-20" />
      </div>

      {/* Clips */}
      {clips.map((clip) => (
        <ClipComponent key={clip.id} clip={clip} zoom={zoom} track={track} />
      ))}

      {/* Empty state */}
      {clips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-muted-foreground">
            Drop media here
          </span>
        </div>
      )}
    </div>
  );
}
