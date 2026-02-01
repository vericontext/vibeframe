"use client";

import React, { useCallback, useState } from "react";
import { useTimelineStore } from "@vibe-edit/core";

interface PlayheadProps {
  currentTime: number;
  zoom: number;
  height: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function Playhead({
  currentTime,
  zoom,
  height,
  onDragStart,
  onDragEnd,
}: PlayheadProps) {
  const { seek } = useTimelineStore();
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);

  const left = currentTime * zoom;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsDragging(true);
      setDragStartX(e.clientX);
      setDragStartTime(currentTime);
      onDragStart?.();
    },
    [currentTime, onDragStart]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const deltaTime = deltaX / zoom;
      seek(Math.max(0, dragStartTime + deltaTime));
    },
    [isDragging, dragStartX, dragStartTime, zoom, seek]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    onDragEnd?.();
  }, [onDragEnd]);

  React.useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      className="absolute top-0 z-20 pointer-events-none"
      style={{ left: `${left}px` }}
    >
      {/* Playhead handle */}
      <div
        className="relative -translate-x-1/2 cursor-grab pointer-events-auto"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="w-4 h-4 bg-red-500 rounded-sm rotate-45 translate-y-1" />
      </div>

      {/* Playhead line */}
      <div
        className="w-px bg-red-500 -translate-x-1/2"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
