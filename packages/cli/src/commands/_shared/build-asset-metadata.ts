import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BuildAssetKind } from "./build-cache.js";

export type AssetFreshness = "fresh" | "stale" | "unknown" | "referenced";

export interface BuildAssetMetadata {
  schemaVersion: "1";
  kind: BuildAssetKind;
  beatId: string;
  cue: string;
  provider: string;
  options?: Record<string, unknown>;
  cacheKey: string;
  canonicalPath: string;
  cachePath?: string;
  /** The take whose output is in this slot, when one recorded it. */
  takeId?: string;
  /**
   * Set by `vibe take promote`: the storyboard cue the slot was promoted
   * under. The build keeps a promoted take while the beat's cue is still
   * this text; editing the cue or `--force` regenerates the slot.
   */
  promotedCue?: string;
  updatedAt: string;
}

export function assetMetadataPath(kind: BuildAssetKind, beatId: string): string {
  return `.vibeframe/assets/${kind}-${beatId}.json`;
}

export function readAssetMetadata(
  projectDir: string,
  kind: BuildAssetKind,
  beatId: string
): BuildAssetMetadata | null {
  const path = join(projectDir, assetMetadataPath(kind, beatId));
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<BuildAssetMetadata>;
    if (
      parsed.schemaVersion !== "1" ||
      parsed.kind !== kind ||
      parsed.beatId !== beatId ||
      typeof parsed.cacheKey !== "string"
    ) {
      return null;
    }
    return parsed as BuildAssetMetadata;
  } catch {
    return null;
  }
}

/**
 * The storyboard cue a build slot depends on: the text whose edit makes the
 * slot stale. A video slot follows its `video:` cue, else its `keyframe:` cue
 * (which then doubles as the motion prompt).
 */
export function slotCue(cues: object | undefined, kind: BuildAssetKind): string | undefined {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  const fields = (cues ?? {}) as Record<string, unknown>;
  if (kind === "video") return text(fields.video) ?? text(fields.keyframe);
  return text(fields[kind]);
}

/** True when `vibe take promote` filled this slot and the beat's cue is still the one it was promoted under. */
export function isPromotedSlot(metadata: BuildAssetMetadata | null, cue: string | undefined): boolean {
  return metadata?.promotedCue !== undefined && cue !== undefined && metadata.promotedCue === cue;
}

export function assetFreshnessFromMetadata(opts: {
  projectDir: string;
  kind: BuildAssetKind;
  beatId: string;
  expectedCacheKey?: string;
  canonicalExists: boolean;
  /** The beat's cue for this slot (see `slotCue`), which a promoted take is held to. */
  cue?: string;
}): AssetFreshness | undefined {
  if (!opts.canonicalExists) return undefined;
  const metadata = readAssetMetadata(opts.projectDir, opts.kind, opts.beatId);
  if (metadata?.promotedCue !== undefined) return isPromotedSlot(metadata, opts.cue) ? "fresh" : "stale";
  if (!opts.expectedCacheKey) return "unknown";
  if (!metadata) return "unknown";
  return metadata.cacheKey === opts.expectedCacheKey ? "fresh" : "stale";
}

export function isFreshCanonicalAsset(opts: {
  projectDir: string;
  kind: BuildAssetKind;
  beatId: string;
  cue: string;
  provider?: string;
  options?: Record<string, unknown>;
  cacheKey?: string;
}): boolean {
  const metadata = readAssetMetadata(opts.projectDir, opts.kind, opts.beatId);
  if (!metadata) return false;
  if (opts.cacheKey) return metadata.cacheKey === opts.cacheKey;
  if (metadata.cue !== opts.cue) return false;
  if (opts.provider && metadata.provider !== opts.provider) return false;
  if (!opts.options) return true;
  return Object.entries(opts.options).every(([key, value]) => metadata.options?.[key] === value);
}

export async function writeAssetMetadata(opts: {
  projectDir: string;
  kind: BuildAssetKind;
  beatId: string;
  cue: string;
  provider: string;
  options?: Record<string, unknown>;
  cacheKey: string;
  canonicalPath: string;
  cachePath?: string;
  takeId?: string;
  promotedCue?: string;
}): Promise<void> {
  const rel = assetMetadataPath(opts.kind, opts.beatId);
  const abs = join(opts.projectDir, rel);
  const metadata: BuildAssetMetadata = {
    schemaVersion: "1",
    kind: opts.kind,
    beatId: opts.beatId,
    cue: opts.cue,
    provider: opts.provider,
    options: opts.options,
    cacheKey: opts.cacheKey,
    canonicalPath: opts.canonicalPath,
    cachePath: opts.cachePath,
    ...(opts.takeId ? { takeId: opts.takeId } : {}),
    ...(opts.promotedCue !== undefined ? { promotedCue: opts.promotedCue } : {}),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(metadata, null, 2) + "\n", "utf-8");
}
