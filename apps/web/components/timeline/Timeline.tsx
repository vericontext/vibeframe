"use client";

import React, { useRef, useCallback, useState } from "react";
import { useTimelineStore, useZoom, useTracks, useClips } from "@vibe-edit/core";
import { Track } from "./Track";
import { Playhead } from "./Playhead";
import { TimeRuler } from "./TimeRuler";
import { Button, PlusIcon, MinusIcon } from "@vibe-edit/ui";

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracks = useTracks();
  const clips = useClips();
  const zoom = useZoom();
  const {
    currentTime,
    scrollX,
    project,
    setZoom,
    setScrollX,
    seek,
    addTrack,
  } = useTimelineStore();

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  // Calculate timeline width based on project duration and zoom
  const timelineWidth = Math.max(
    (project.duration + 10) * zoom,
    containerRef.current?.clientWidth || 1000
  );

  const handleZoomIn = useCallback(() => {
    setZoom(zoom * 1.2);
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(zoom / 1.2);
  }, [zoom, setZoom]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollX(e.currentTarget.scrollLeft);
    },
    [setScrollX]
  );

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingPlayhead) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollX;
      const time = x / zoom;
      seek(Math.max(0, time));
    },
    [scrollX, zoom, seek, isDraggingPlayhead]
  );

  const handleAddVideoTrack = useCallback(() => {
    const videoTrackCount = tracks.filter((t) => t.type === "video").length;
    addTrack({
      name: `Video ${videoTrackCount + 1}`,
      type: "video",
      order: tracks.length,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });
  }, [tracks, addTrack]);

  const handleAddAudioTrack = useCallback(() => {
    const audioTrackCount = tracks.filter((t) => t.type === "audio").length;
    addTrack({
      name: `Audio ${audioTrackCount + 1}`,
      type: "audio",
      order: tracks.length,
      isMuted: false,
      isLocked: false,
      isVisible: true,
    });
  }, [tracks, addTrack]);

  // Sort tracks: video tracks first (higher order on top), then audio
  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "video" ? -1 : 1;
    }
    return b.order - a.order;
  });

  return (
    <div className="flex h-full flex-col" ref={containerRef}>
      {/* Timeline toolbar */}
      <div className="flex h-10 items-center justify-between border-b border-border bg-secondary px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Timeline</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={handleZoomOut}>
            <MinusIcon className="h-4 w-4" />
          </Button>
          <span className="min-w-[3rem] text-center text-xs text-muted-foreground">
            {Math.round(zoom)}px/s
          </span>
          <Button variant="ghost" size="icon" onClick={handleZoomIn}>
            <PlusIcon className="h-4 w-4" />
          </Button>
          <div className="mx-2 h-4 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={handleAddVideoTrack}>
            + Video
          </Button>
          <Button variant="outline" size="sm" onClick={handleAddAudioTrack}>
            + Audio
          </Button>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track labels */}
        <div className="w-40 flex-shrink-0 border-r border-border bg-secondary">
          <div className="h-6 border-b border-border" /> {/* Ruler spacer */}
          {sortedTracks.map((track) => (
            <div
              key={track.id}
              className="flex h-16 items-center border-b border-border px-3"
            >
              <span className="truncate text-sm text-foreground">
                {track.name}
              </span>
            </div>
          ))}
        </div>

        {/* Timeline area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={handleScroll}
        >
          <div
            className="relative"
            style={{ width: timelineWidth }}
            onClick={handleTimelineClick}
          >
            {/* Time ruler */}
            <TimeRuler
              zoom={zoom}
              width={timelineWidth}
              duration={project.duration + 10}
            />

            {/* Tracks */}
            <div className="relative">
              {sortedTracks.map((track) => (
                <Track
                  key={track.id}
                  track={track}
                  clips={clips.filter((c) => c.trackId === track.id)}
                  zoom={zoom}
                />
              ))}

              {/* Playhead */}
              <Playhead
                currentTime={currentTime}
                zoom={zoom}
                height={sortedTracks.length * 64}
                onDragStart={() => setIsDraggingPlayhead(true)}
                onDragEnd={() => setIsDraggingPlayhead(false)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
