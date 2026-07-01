import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import type { SceneAspect, SceneKind, VibeProjectConfig as LegacyVibeProjectConfig } from "./scene-project.js";

export const VIBE_CONFIG_FILENAME = "vibe.config.json";
export const LEGACY_VIBE_PROJECT_FILENAME = "vibe.project.yaml";

export type CompositionEngine = "hyperframes";
export type ProjectImageProvider = "openai" | "gemini" | "grok" | null;
export type ProjectVideoProvider = "seedance" | "grok" | "kling" | "runway" | "veo" | null;
export type ProjectNarrationProvider = "elevenlabs" | "openai" | "kokoro" | null;
export type ProjectComposerProvider = "claude" | "openai" | "gemini" | null;
export type ProjectQuality = "draft" | "standard" | "high";

export interface VibeProjectConfigV1 {
  schemaVersion: "1";
  name: string;
  aspect: SceneAspect;
  /** Project kind — drives which pipeline stages run + the default composer. */
  kind: SceneKind;
  defaults: {
    sceneDurationSec: number;
    narrationPaddingSec: number;
    fps: 24 | 30 | 60;
    quality: ProjectQuality;
  };
  providers: {
    image: ProjectImageProvider;
    video: ProjectVideoProvider;
    narration: ProjectNarrationProvider;
    music: string | null;
    composer: ProjectComposerProvider;
  };
  build: {
    mode: "agent" | "batch" | "auto";
    stage: "all" | "assets" | "compose" | "sync" | "render";
    maxCostUsd: number | null;
    imageQuality: "standard" | "hd";
    imageSize: "1024x1024" | "1536x1024" | "1024x1536";
  };
  composition: {
    engine: CompositionEngine;
    entry: string;
    compositionsDir: string;
    assetsDir: string;
    rendersDir: string;
  };
}

export interface LoadedProjectConfig {
  config: VibeProjectConfigV1;
  /** `vibe.config.json`, `vibe.project.yaml`, or `default`. */
  source: string;
  path: string | null;
  legacy: boolean;
}

export function defaultProjectConfig(opts: {
  name: string;
  aspect?: SceneAspect;
  kind?: SceneKind;
  sceneDurationSec?: number;
}): VibeProjectConfigV1 {
  return {
    schemaVersion: "1",
    name: opts.name,
    aspect: opts.aspect ?? "16:9",
    kind: opts.kind ?? "cinema", // DEFAULT_SCENE_KIND (literal to avoid an import cycle)
    defaults: {
      sceneDurationSec: opts.sceneDurationSec ?? 5,
      narrationPaddingSec: 0.5,
      fps: 30,
      quality: "standard",
    },
    providers: {
      image: null,
      video: null,
      narration: null,
      music: null,
      composer: null,
    },
    build: {
      mode: "auto",
      stage: "all",
      maxCostUsd: null,
      imageQuality: "hd",
      imageSize: "1536x1024",
    },
    composition: {
      engine: "hyperframes",
      entry: "index.html",
      compositionsDir: "compositions",
      assetsDir: "assets",
      rendersDir: "renders",
    },
  };
}

export function mergeProjectConfig(
  parsed: Partial<VibeProjectConfigV1> | null | undefined,
  fallback: VibeProjectConfigV1,
): VibeProjectConfigV1 {
  if (!parsed || typeof parsed !== "object") return fallback;
  return {
    ...fallback,
    ...parsed,
    schemaVersion: "1",
    defaults: { ...fallback.defaults, ...(parsed.defaults ?? {}) },
    providers: { ...fallback.providers, ...(parsed.providers ?? {}) },
    build: { ...fallback.build, ...(parsed.build ?? {}) },
    composition: { ...fallback.composition, ...(parsed.composition ?? {}) },
  };
}

export function projectConfigJson(opts: {
  name: string;
  aspect?: SceneAspect;
  kind?: SceneKind;
  sceneDurationSec?: number;
}): string {
  return JSON.stringify(defaultProjectConfig(opts), null, 2) + "\n";
}

export async function readProjectConfig(projectDir: string): Promise<LoadedProjectConfig> {
  const dir = resolve(projectDir);
  const canonicalPath = resolve(dir, VIBE_CONFIG_FILENAME);
  const legacyPath = resolve(dir, LEGACY_VIBE_PROJECT_FILENAME);

  if (existsSync(canonicalPath)) {
    try {
      const raw = await readFile(canonicalPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<VibeProjectConfigV1>;
      const name = typeof parsed.name === "string" && parsed.name ? parsed.name : dir.split(/[\\/]/).filter(Boolean).pop() ?? "video";
      const fallback = defaultProjectConfig({
        name,
        aspect: parsed.aspect,
        kind: parsed.kind,
        sceneDurationSec: parsed.defaults?.sceneDurationSec,
      });
      return {
        config: mergeProjectConfig(parsed, fallback),
        source: VIBE_CONFIG_FILENAME,
        path: canonicalPath,
        legacy: false,
      };
    } catch {
      // Fall through to legacy/default. Callers that need validation surface
      // malformed JSON via `vibe plan` warnings instead of failing config load.
    }
  }

  if (existsSync(legacyPath)) {
    try {
      const raw = await readFile(legacyPath, "utf-8");
      const legacy = parseYaml(raw) as Partial<LegacyVibeProjectConfig> | null;
      const name = legacy?.name ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? "video";
      const config = defaultProjectConfig({
        name,
        aspect: legacy?.aspect,
        sceneDurationSec: legacy?.defaultSceneDuration,
      });
      config.providers.image = legacy?.providers?.image ?? null;
      config.providers.narration = legacy?.providers?.tts ?? null;
      config.composition.engine = legacy?.composition?.engine ?? "hyperframes";
      config.composition.entry = legacy?.composition?.entry ?? "index.html";
      // Salvage a real budget cap the user set in the legacy file (previously
      // dropped on load). Ignore the scaffold's `maxUsd: 0` default so we don't
      // turn "no cap" (V1 null) into "cap everything at $0".
      if (typeof legacy?.budget?.maxUsd === "number" && legacy.budget.maxUsd > 0) {
        config.build.maxCostUsd = legacy.budget.maxUsd;
      }
      return {
        config,
        source: LEGACY_VIBE_PROJECT_FILENAME,
        path: legacyPath,
        legacy: true,
      };
    } catch {
      // Fall through to default.
    }
  }

  return {
    config: defaultProjectConfig({
      name: dir.split(/[\\/]/).filter(Boolean).pop() ?? "video",
    }),
    source: "default",
    path: null,
    legacy: false,
  };
}
