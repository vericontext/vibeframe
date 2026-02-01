"use client";

import React from "react";

interface TimeRulerProps {
  zoom: number;
  width: number;
  duration: number;
}

export function TimeRuler({ zoom, duration }: TimeRulerProps) {
  // Calculate tick interval based on zoom level
  const getTickInterval = () => {
    if (zoom >= 100) return 1; // 1 second
    if (zoom >= 50) return 2; // 2 seconds
    if (zoom >= 25) return 5; // 5 seconds
    if (zoom >= 10) return 10; // 10 seconds
    return 30; // 30 seconds
  };

  const tickInterval = getTickInterval();
  const tickCount = Math.ceil(duration / tickInterval);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-6 border-b border-border bg-secondary relative">
      {Array.from({ length: tickCount + 1 }).map((_, i) => {
        const time = i * tickInterval;
        const left = time * zoom;

        return (
          <div
            key={i}
            className="absolute top-0 h-full"
            style={{ left: `${left}px` }}
          >
            <div className="h-2 w-px bg-muted-foreground" />
            <span className="absolute top-2 -translate-x-1/2 text-[10px] text-muted-foreground">
              {formatTime(time)}
            </span>
          </div>
        );
      })}

      {/* Minor ticks */}
      {zoom >= 30 &&
        Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => {
          if (i % tickInterval === 0) return null;
          const left = i * zoom;

          return (
            <div
              key={`minor-${i}`}
              className="absolute top-0 h-1 w-px bg-muted-foreground/50"
              style={{ left: `${left}px` }}
            />
          );
        })}
    </div>
  );
}
