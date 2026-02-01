"use client";

import React from "react";
import { useTimelineStore, usePlaybackState } from "@vibe-edit/core";
import {
  Button,
  PlayIcon,
  PauseIcon,
  TrackPreviousIcon,
  TrackNextIcon,
} from "@vibe-edit/ui";

export function PlaybackControls() {
  const { isPlaying, currentTime } = usePlaybackState();
  const { project, play, pause, togglePlayback, seek } = useTimelineStore();

  const handleSkipBack = () => {
    seek(Math.max(0, currentTime - 5));
  };

  const handleSkipForward = () => {
    seek(Math.min(project.duration, currentTime + 5));
  };

  const handleGoToStart = () => {
    seek(0);
  };

  const handleGoToEnd = () => {
    seek(project.duration);
  };

  return (
    <div className="flex items-center gap-4">
      {/* Time display */}
      <div className="min-w-[120px] text-center">
        <span className="font-mono text-sm text-foreground">
          {formatTime(currentTime)}
        </span>
        <span className="mx-1 text-muted-foreground">/</span>
        <span className="font-mono text-sm text-muted-foreground">
          {formatTime(project.duration)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={handleGoToStart}>
          <TrackPreviousIcon className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" onClick={handleSkipBack}>
          <SkipBackIcon className="h-4 w-4" />
        </Button>

        <Button
          variant="default"
          size="icon"
          className="h-10 w-10"
          onClick={togglePlayback}
        >
          {isPlaying ? (
            <PauseIcon className="h-5 w-5" />
          ) : (
            <PlayIcon className="h-5 w-5" />
          )}
        </Button>

        <Button variant="ghost" size="icon" onClick={handleSkipForward}>
          <SkipForwardIcon className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" onClick={handleGoToEnd}>
          <TrackNextIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Spacer */}
      <div className="min-w-[120px]" />
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Custom skip icons since Radix doesn't have them
function SkipBackIcon({ className }: { className?: string }) {
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
      <polygon points="11 19 2 12 11 5 11 19" />
      <polygon points="22 19 13 12 22 5 22 19" />
    </svg>
  );
}

function SkipForwardIcon({ className }: { className?: string }) {
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
      <polygon points="13 19 22 12 13 5 13 19" />
      <polygon points="2 19 11 12 2 5 2 19" />
    </svg>
  );
}
