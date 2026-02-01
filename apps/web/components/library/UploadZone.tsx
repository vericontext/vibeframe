"use client";

import React, { useCallback, useRef, useState } from "react";
import { cn, UploadIcon } from "@vibeframe/ui";

interface UploadZoneProps {
  onFilesAdded: (files: File[]) => void;
}

const ACCEPTED_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function UploadZone({ onFilesAdded }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        const validFiles = Array.from(files).filter((file) =>
          ACCEPTED_TYPES.includes(file.type)
        );
        if (validFiles.length > 0) {
          onFilesAdded(validFiles);
        }
      }
      // Reset input
      e.target.value = "";
    },
    [onFilesAdded]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files) {
        const validFiles = Array.from(files).filter((file) =>
          ACCEPTED_TYPES.includes(file.type)
        );
        if (validFiles.length > 0) {
          onFilesAdded(validFiles);
        }
      }
    },
    [onFilesAdded]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
      />

      <div
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors",
          isDragOver
            ? "border-primary bg-primary/10"
            : "border-border hover:border-primary/50 hover:bg-muted/50"
        )}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <UploadIcon
          className={cn(
            "h-6 w-6 mb-2",
            isDragOver ? "text-primary" : "text-muted-foreground"
          )}
        />
        <p className="text-xs text-center text-muted-foreground">
          {isDragOver ? (
            "Drop to upload"
          ) : (
            <>
              <span className="text-primary">Click to upload</span>
              <br />
              or drag and drop
            </>
          )}
        </p>
      </div>
    </>
  );
}
