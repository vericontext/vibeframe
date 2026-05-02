import { existsSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { BuildAssetKind } from "./build-cache.js";

export interface AssetReferenceCandidate {
  kind: BuildAssetKind;
  raw: string;
  relPath?: string;
  absPath?: string;
  ext: string;
  exists: boolean;
  withinProject: boolean;
  source: "typed" | "asset";
  error?: string;
}

const EXTENSIONS: Record<BuildAssetKind, readonly string[]> = {
  narration: [".mp3", ".wav", ".m4a"],
  backdrop: [".png", ".jpg", ".jpeg", ".webp"],
  video: [".mp4", ".mov", ".webm"],
  music: [".mp3", ".wav", ".m4a"],
};

export function resolveTypedAssetReference(
  projectDir: string,
  kind: BuildAssetKind,
  value: unknown
): AssetReferenceCandidate | null {
  const raw = stringOrUndefined(value);
  if (!raw || !looksLikeAssetPath(raw)) return null;
  return resolveReference(projectDir, kind, raw, "typed");
}

export function resolveGenericAssetReference(
  projectDir: string,
  value: unknown
): AssetReferenceCandidate | null {
  const raw = stringOrUndefined(value);
  if (!raw || !looksLikeAssetPath(raw)) return null;
  const inferred = inferAssetKind(raw);
  if (!inferred) {
    return resolveReference(
      projectDir,
      "backdrop",
      raw,
      "asset",
      "Unsupported asset reference extension."
    );
  }
  return resolveReference(projectDir, inferred, raw, "asset");
}

export function isReadyAssetReference(
  reference: AssetReferenceCandidate | null | undefined
): reference is AssetReferenceCandidate & { relPath: string; absPath: string } {
  return Boolean(reference && !reference.error && reference.relPath && reference.absPath);
}

function resolveReference(
  projectDir: string,
  kind: BuildAssetKind,
  raw: string,
  source: "typed" | "asset",
  forcedError?: string
): AssetReferenceCandidate {
  const ext = extname(raw).toLowerCase();
  const inferred = inferAssetKind(raw);
  const absPath = isAbsolute(raw) ? resolve(raw) : resolve(projectDir, raw);
  const rel = relative(resolve(projectDir), absPath);
  const withinProject = rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
  const exists = withinProject && existsSync(absPath);
  let error = forcedError;
  if (!error && inferred && inferred !== kind && !isNarrationAudioReference(kind, ext)) {
    error = `Asset reference "${raw}" is a ${inferred} asset, not ${kind}.`;
  }
  if (!error && !EXTENSIONS[kind].includes(ext)) {
    error = `Asset reference "${raw}" is not a supported ${kind} file.`;
  }
  if (!error && !withinProject) {
    error = `Asset reference "${raw}" must stay inside the project directory.`;
  }
  if (!error && !exists) {
    error = `Asset reference "${raw}" does not exist.`;
  }
  return {
    kind,
    raw,
    relPath: withinProject ? rel.split(sep).join("/") : undefined,
    absPath: withinProject ? absPath : undefined,
    ext,
    exists,
    withinProject,
    source,
    ...(error ? { error } : {}),
  };
}

function inferAssetKind(value: string): BuildAssetKind | null {
  const ext = extname(value).toLowerCase();
  if (EXTENSIONS.backdrop.includes(ext)) return "backdrop";
  if (EXTENSIONS.video.includes(ext)) return "video";
  if (EXTENSIONS.narration.includes(ext)) return "music";
  return null;
}

function isNarrationAudioReference(kind: BuildAssetKind, ext: string): boolean {
  return kind === "narration" && EXTENSIONS.narration.includes(ext);
}

function looksLikeAssetPath(value: string): boolean {
  const normalized = value.trim();
  return (
    Boolean(inferAssetKind(normalized)) ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.startsWith("assets/") ||
    normalized.startsWith("media/")
  );
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
