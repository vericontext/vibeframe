"use client";

import React, { useCallback, useState } from "react";
import { useTimelineStore, useSources, MediaSource, MediaType } from "@vibe-edit/core";
import { MediaItem } from "./MediaItem";
import { UploadZone } from "./UploadZone";
import { Button, MagnifyingGlassIcon } from "@vibe-edit/ui";
import { cn } from "@vibe-edit/ui";

type FilterType = "all" | MediaType;

export function Library() {
  const sources = useSources();
  const { addSource } = useTimelineStore();
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const handleFilesAdded = useCallback(
    (files: File[]) => {
      files.forEach((file) => {
        const type = getMediaType(file.type);
        if (!type) return;

        // Create object URL for preview
        const url = URL.createObjectURL(file);

        // Get video duration if it's a video
        if (type === "video" || type === "audio") {
          const media = document.createElement(type === "video" ? "video" : "audio");
          media.src = url;
          media.onloadedmetadata = () => {
            addSource({
              name: file.name,
              type,
              url,
              duration: media.duration || 5,
              width: type === "video" ? (media as HTMLVideoElement).videoWidth : undefined,
              height: type === "video" ? (media as HTMLVideoElement).videoHeight : undefined,
            });
          };
          media.onerror = () => {
            // Fallback with default duration
            addSource({
              name: file.name,
              type,
              url,
              duration: 5,
            });
          };
        } else {
          // Image
          addSource({
            name: file.name,
            type,
            url,
            duration: 5, // Default image duration
          });
        }
      });
    },
    [addSource]
  );

  const filteredSources = sources.filter((source) => {
    const matchesFilter = filter === "all" || source.type === filter;
    const matchesSearch =
      !searchQuery || source.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const filterButtons: { label: string; value: FilterType }[] = [
    { label: "All", value: "all" },
    { label: "Video", value: "video" },
    { label: "Audio", value: "audio" },
    { label: "Image", value: "image" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-medium text-foreground">Library</span>
        <span className="text-xs text-muted-foreground">{sources.length} items</span>
      </div>

      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md bg-muted py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-border p-2">
        {filterButtons.map(({ label, value }) => (
          <Button
            key={value}
            variant={filter === value ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Upload zone */}
      <div className="p-2">
        <UploadZone onFilesAdded={handleFilesAdded} />
      </div>

      {/* Media list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredSources.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {sources.length === 0
              ? "No media added yet"
              : "No matching media found"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredSources.map((source) => (
              <MediaItem key={source.id} source={source} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getMediaType(mimeType: string): MediaType | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  return null;
}
