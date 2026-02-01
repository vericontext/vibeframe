"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTimelineStore, usePlaybackState } from "@vibe-edit/core";
import { PlaybackControls } from "./PlaybackControls";

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);

  const { isPlaying, currentTime } = usePlaybackState();
  const { project, clips, sources, seek, pause } = useTimelineStore();

  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });

  // Calculate canvas dimensions based on aspect ratio
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const containerWidth = container.clientWidth - 32; // padding
      const containerHeight = container.clientHeight - 80; // controls

      const ratios: Record<string, number> = {
        "16:9": 16 / 9,
        "9:16": 9 / 16,
        "1:1": 1,
        "4:5": 4 / 5,
      };

      const aspectRatio = ratios[project.aspectRatio] || 16 / 9;

      let width = containerWidth;
      let height = width / aspectRatio;

      if (height > containerHeight) {
        height = containerHeight;
        width = height * aspectRatio;
      }

      setCanvasSize({ width: Math.floor(width), height: Math.floor(height) });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [project.aspectRatio]);

  // Get active clip at current time
  const getActiveClip = useCallback(
    (time: number) => {
      // Find video clip at current time
      const videoClips = clips.filter((clip) => {
        const source = sources.find((s) => s.id === clip.sourceId);
        return (
          source?.type === "video" &&
          time >= clip.startTime &&
          time < clip.startTime + clip.duration
        );
      });

      // Return the topmost video clip (last in array for overlapping)
      return videoClips[videoClips.length - 1];
    },
    [clips, sources]
  );

  // Render frame
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const activeClip = getActiveClip(currentTime);

    if (!activeClip) {
      // No clip - show placeholder
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = "16px sans-serif";
      ctx.fillStyle = "#666666";
      ctx.textAlign = "center";
      ctx.fillText("No video at current time", canvas.width / 2, canvas.height / 2);
      return;
    }

    const source = sources.find((s) => s.id === activeClip.sourceId);
    if (!source) return;

    // For now, show placeholder with clip info
    // TODO: Integrate with WebCodecs for actual frame rendering
    const clipProgress = (currentTime - activeClip.startTime) / activeClip.duration;

    // Gradient background representing the clip
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "hsl(262, 83%, 30%)");
    gradient.addColorStop(1, "hsl(262, 83%, 20%)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clip name
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(source.name, canvas.width / 2, canvas.height / 2 - 20);

    // Time info
    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#cccccc";
    const sourceTime = activeClip.sourceStartOffset + (currentTime - activeClip.startTime);
    ctx.fillText(
      `${formatTime(sourceTime)} / ${formatTime(source.duration)}`,
      canvas.width / 2,
      canvas.height / 2 + 10
    );

    // Progress bar
    const barWidth = canvas.width * 0.6;
    const barHeight = 4;
    const barX = (canvas.width - barWidth) / 2;
    const barY = canvas.height / 2 + 30;

    ctx.fillStyle = "#333333";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    ctx.fillStyle = "hsl(262, 83%, 58%)";
    ctx.fillRect(barX, barY, barWidth * clipProgress, barHeight);
  }, [currentTime, getActiveClip, sources]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      renderFrame();
      return;
    }

    lastTimeRef.current = performance.now();

    const animate = (timestamp: number) => {
      const deltaMs = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const deltaSeconds = deltaMs / 1000;
      const newTime = currentTime + deltaSeconds;

      if (newTime >= project.duration) {
        pause();
        seek(0);
      } else {
        seek(newTime);
      }

      renderFrame();
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, currentTime, project.duration, pause, seek, renderFrame]);

  // Initial render
  useEffect(() => {
    renderFrame();
  }, [renderFrame]);

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col items-center justify-center"
    >
      {/* Canvas */}
      <div className="relative rounded-lg overflow-hidden shadow-2xl">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="bg-black"
        />

        {/* Aspect ratio badge */}
        <div className="absolute top-2 right-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
          {project.aspectRatio}
        </div>
      </div>

      {/* Playback controls */}
      <div className="mt-4">
        <PlaybackControls />
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
