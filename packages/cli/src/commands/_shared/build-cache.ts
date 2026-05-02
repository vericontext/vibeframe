import { createHash } from "node:crypto";

export type BuildAssetKind = "narration" | "backdrop" | "video" | "music";

export interface CacheAssetDescriptor {
  key: string;
  path: string;
  ext: string;
}

export function cacheAssetDescriptor(
  kind: BuildAssetKind,
  parts: Record<string, unknown>
): CacheAssetDescriptor {
  const ext = String(parts.ext ?? "bin");
  const key = createHash("sha256")
    .update(JSON.stringify({ kind, ...parts }))
    .digest("hex");
  return {
    key,
    ext,
    path: `.vibeframe/cache/assets/${kind}-${key}.${ext}`,
  };
}

export function narrationCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  voice?: unknown;
  ext: "mp3" | "wav";
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("narration", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    voice: opts.voice,
    ext: opts.ext,
  });
}

export function backdropCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  quality: "standard" | "hd";
  size: string;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("backdrop", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    quality: opts.quality,
    size: opts.size,
    ext: "png",
  });
}

export function videoCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  duration: number | undefined;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("video", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    duration: normalizeVideoDuration(opts.duration),
    ratio: "16:9",
    ext: "mp4",
  });
}

export function musicCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  duration: number | undefined;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("music", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    duration: normalizeMusicDuration(opts.duration),
    ext: "mp3",
  });
}

export function normalizeVideoDuration(duration: number | undefined): number {
  if (!duration || !Number.isFinite(duration)) return 5;
  return Math.max(1, Math.min(15, Math.round(duration)));
}

export function normalizeMusicDuration(duration: number | undefined): number {
  if (!duration || !Number.isFinite(duration)) return 8;
  return Math.max(1, Math.min(600, Math.round(duration)));
}
