import { createHash } from "node:crypto";

export type BuildAssetKind =
  | "narration"
  | "backdrop"
  | "character"
  | "keyframe"
  | "video"
  | "music";

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
  ratio?: string;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("backdrop", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    quality: opts.quality,
    size: opts.size,
    ratio: opts.ratio,
    ext: "png",
  });
}

export function characterCacheDescriptor(opts: {
  name: string;
  cue: string;
  provider: string;
  quality: "standard" | "hd";
  size: string;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("character", {
    name: opts.name,
    cue: opts.cue,
    provider: opts.provider,
    quality: opts.quality,
    size: opts.size,
    ext: "png",
  });
}

export function keyframeCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  quality: "standard" | "hd";
  size: string;
  ratio?: string;
  /** Character sheet paths used as edit references — changing them re-keys the keyframe. */
  characters?: string[];
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("keyframe", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    quality: opts.quality,
    size: opts.size,
    ratio: opts.ratio,
    characters: opts.characters && opts.characters.length > 0 ? opts.characters : undefined,
    ext: "png",
  });
}

export function imageRatioForSize(size: string | undefined): string {
  switch (size) {
    case "1024x1024":
      return "1:1";
    case "1024x1536":
      return "2:3";
    case "1536x1024":
      return "3:2";
    default:
      return "16:9";
  }
}

export function videoCacheDescriptor(opts: {
  beatId: string;
  cue: string;
  provider: string;
  duration: number | undefined;
  /** Character reference image paths — changing them must invalidate the clip. */
  characters?: string[];
  /**
   * Keyframe still path for image-to-video mode — changing the keyframe must
   * invalidate the clip. Omitted for text/reference-to-video clips.
   */
  keyframe?: string;
}): CacheAssetDescriptor {
  return cacheAssetDescriptor("video", {
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    duration: normalizeVideoDuration(opts.duration),
    ratio: "16:9",
    // Omit when empty so existing (character-less) clips keep their cache key.
    characters: opts.characters && opts.characters.length > 0 ? opts.characters : undefined,
    // Omit when absent so existing (non-keyframe) clips keep their cache key.
    keyframe: opts.keyframe || undefined,
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
