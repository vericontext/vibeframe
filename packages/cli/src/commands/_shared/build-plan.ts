import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseStoryboard } from "./storyboard-parse.js";
import { readProjectConfig, type LoadedProjectConfig } from "./project-config.js";
import { validateStoryboardMarkdown, type StoryboardValidationIssue } from "./storyboard-edit.js";

export type BuildStage = "assets" | "compose" | "sync" | "render" | "all";
export type BuildPlanStatus = "ready" | "invalid";

export interface BuildPlanBeat {
  id: string;
  heading: string;
  durationSec: number | null;
  cues: Record<string, unknown>;
  assets: {
    narration: AssetPlan | null;
    backdrop: AssetPlan | null;
    video: AssetPlan | null;
    music: AssetPlan | null;
  };
  composition: {
    path: string;
    exists: boolean;
  };
}

export interface AssetPlan {
  cue: string;
  path: string;
  exists: boolean;
  willGenerate: boolean;
  estimatedCostUsd: number;
}

export interface BuildPlanResult {
  schemaVersion: "1";
  kind: "build-plan";
  projectDir: string;
  config: LoadedProjectConfig;
  stage: BuildStage;
  status: BuildPlanStatus;
  currentStage: BuildStage;
  mode: "agent" | "batch" | "auto";
  beat: string | null;
  beats: BuildPlanBeat[];
  missing: string[];
  providers: string[];
  estimatedCostUsd: number;
  summary: BuildPlanSummary;
  nextCommands: string[];
  warnings: string[];
  retryWith: string[];
  validation: {
    ok: boolean;
    issues: StoryboardValidationIssue[];
  };
}

export interface BuildPlanSummary {
  beats: number;
  missing: string[];
  providers: string[];
  estimatedCostUsd: number;
  validationErrors: number;
  validationWarnings: number;
}

export interface CreateBuildPlanOptions {
  projectDir: string;
  stage?: BuildStage;
  beat?: string;
  mode?: "agent" | "batch" | "auto";
  skipNarration?: boolean;
  skipBackdrop?: boolean;
  skipVideo?: boolean;
  skipMusic?: boolean;
  videoProvider?: string;
  musicProvider?: string;
  force?: boolean;
}

const NARRATION_COST_USD = 0.05;
const BACKDROP_COST_USD = 3;
const VIDEO_COST_USD = 5;
const MUSIC_COST_USD = 0.5;
const COMPOSE_COST_USD = 0.06;

export async function createBuildPlan(opts: CreateBuildPlanOptions): Promise<BuildPlanResult> {
  const projectDir = resolve(opts.projectDir);
  const stage = opts.stage ?? "all";
  const config = await readProjectConfig(projectDir);
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const warnings: string[] = [];
  const retryWith: string[] = [];

  if (!existsSync(storyboardPath)) {
    const validation = {
      ok: false,
      issues: [{
        severity: "error" as const,
        code: "STORYBOARD_NOT_FOUND",
        message: `STORYBOARD.md not found at ${storyboardPath}.`,
      }],
    };
    return finalizeBuildPlan({
      projectDir,
      config,
      stage,
      status: "invalid",
      currentStage: stage,
      mode: opts.mode ?? config.config.build.mode,
      beat: opts.beat ?? null,
      beats: [],
      missing: ["storyboard"],
      providers: [],
      estimatedCostUsd: 0,
      warnings: [`STORYBOARD.md not found at ${storyboardPath}.`],
      retryWith: [`vibe init ${projectDir} --from "<brief>" --json`],
      validation,
    });
  }

  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const validation = validateStoryboardMarkdown(storyboardMd);
  const parsed = parseStoryboard(storyboardMd);
  let sourceBeats = parsed.beats;
  if (opts.beat) {
    const selected = sourceBeats.find((beat) => beat.id === opts.beat);
    if (!selected) {
      warnings.push(`Beat "${opts.beat}" not found. Available: ${sourceBeats.map((beat) => beat.id).join(", ")}`);
      retryWith.push(`vibe storyboard list ${projectDir} --json`);
      sourceBeats = [];
    } else {
      sourceBeats = [selected];
    }
  }

  const providers = new Set<string>();
  const missing = new Set<string>();
  let estimatedCostUsd = 0;
  const includeAssets = stage === "all" || stage === "assets";
  const includeCompose = stage === "all" || stage === "compose";
  const resolvedVideoProvider = normalizeVideoProvider(opts.videoProvider ?? config.config.providers.video);
  const resolvedMusicProvider = normalizeMusicProvider(opts.musicProvider ?? config.config.providers.music);

  const beats = sourceBeats.map((beat) => {
    const cue = beat.cues ?? {};
    const narration = typeof cue.narration === "string" && !opts.skipNarration
      ? assetPlan({
          cue: cue.narration,
          path: firstExisting(projectDir, [`assets/narration-${beat.id}.mp3`, `assets/narration-${beat.id}.wav`]) ?? `assets/narration-${beat.id}.mp3`,
          projectDir,
          force: opts.force,
          cost: NARRATION_COST_USD,
          active: includeAssets,
        })
      : null;
    const backdrop = typeof cue.backdrop === "string" && !opts.skipBackdrop
      ? assetPlan({
          cue: cue.backdrop,
          path: `assets/backdrop-${beat.id}.png`,
          projectDir,
          force: opts.force,
          cost: BACKDROP_COST_USD,
          active: includeAssets,
        })
      : null;
    const video = typeof cue.video === "string" && !opts.skipVideo
      ? assetPlan({
          cue: cue.video,
          path: `assets/video-${beat.id}.mp4`,
          projectDir,
          force: opts.force,
          cost: VIDEO_COST_USD,
          active: includeAssets,
        })
      : null;
    const music = typeof cue.music === "string" && !opts.skipMusic
      ? assetPlan({
          cue: cue.music,
          path: `assets/music-${beat.id}.mp3`,
          projectDir,
          force: opts.force,
          cost: MUSIC_COST_USD,
          active: includeAssets,
        })
      : null;
    const compositionPath = `compositions/scene-${beat.id}.html`;
    const compositionExists = existsSync(join(projectDir, compositionPath));

    for (const asset of [narration, backdrop, video, music]) {
      if (!asset) continue;
      if (asset.willGenerate) {
        estimatedCostUsd += asset.estimatedCostUsd;
        missing.add("assets");
      }
    }
    if (narration?.willGenerate) providers.add(config.config.providers.narration ?? "auto-tts");
    if (backdrop?.willGenerate) providers.add(config.config.providers.image ?? "openai");
    if (video?.willGenerate) providers.add(resolvedVideoProvider);
    if (music?.willGenerate) providers.add(resolvedMusicProvider);
    if (!compositionExists) missing.add("compositions");
    if (includeCompose && !compositionExists && (opts.mode ?? config.config.build.mode) !== "agent") {
      estimatedCostUsd += COMPOSE_COST_USD;
      providers.add(config.config.providers.composer ?? "auto-composer");
    }

    return {
      id: beat.id,
      heading: beat.heading,
      durationSec: beat.duration ?? null,
      cues: cue,
      assets: { narration, backdrop, video, music },
      composition: {
        path: compositionPath,
        exists: compositionExists,
      },
    };
  });

  if (!existsSync(join(projectDir, config.config.composition.entry))) {
    missing.add("root-composition");
    if (validation.ok) retryWith.push(`vibe build ${projectDir} --stage sync --json`);
  }
  if (config.legacy) {
    warnings.push(`Using legacy ${config.source}; write ${projectDir}/vibe.config.json to use the TO-BE project contract.`);
  }
  if (!validation.ok) {
    retryWith.push(
      `vibe storyboard validate ${projectDir} --json`,
      `vibe storyboard revise ${projectDir} --from "<request>" --dry-run --json`,
    );
  }

  return finalizeBuildPlan({
    projectDir,
    config,
    stage,
    status: validation.ok ? "ready" : "invalid",
    currentStage: stage,
    mode: opts.mode ?? config.config.build.mode,
    beat: opts.beat ?? null,
    beats,
    missing: [...missing],
    providers: [...providers].filter(Boolean),
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(2)),
    warnings,
    retryWith,
    validation: {
      ok: validation.ok,
      issues: validation.issues,
    },
  });
}

function finalizeBuildPlan(plan: Omit<BuildPlanResult, "schemaVersion" | "kind" | "summary" | "nextCommands">): BuildPlanResult {
  const providers = [...plan.providers].filter(Boolean);
  const missing = [...plan.missing];
  const summary: BuildPlanSummary = {
    beats: plan.beats.length,
    missing,
    providers,
    estimatedCostUsd: Number(plan.estimatedCostUsd.toFixed(2)),
    validationErrors: plan.validation.issues.filter((issue) => issue.severity === "error").length,
    validationWarnings: plan.validation.issues.filter((issue) => issue.severity === "warning").length,
  };
  return {
    schemaVersion: "1",
    kind: "build-plan",
    ...plan,
    providers,
    missing,
    summary,
    nextCommands: nextCommandsForPlan({ ...plan, missing, providers, summary }),
    retryWith: unique(plan.retryWith),
  };
}

function nextCommandsForPlan(plan: Omit<BuildPlanResult, "schemaVersion" | "kind" | "nextCommands">): string[] {
  if (plan.status === "invalid") return unique(plan.retryWith);
  const commands: string[] = [];
  if (plan.missing.includes("assets")) commands.push(`vibe build ${plan.projectDir} --stage assets --json`);
  if (plan.missing.includes("compositions")) commands.push(`vibe build ${plan.projectDir} --stage compose --json`);
  if (plan.missing.includes("root-composition")) commands.push(`vibe build ${plan.projectDir} --stage sync --json`);
  if (commands.length === 0) commands.push(`vibe build ${plan.projectDir} --stage ${plan.stage} --json`);
  return unique(commands);
}

function assetPlan(opts: {
  cue: string;
  path: string;
  projectDir: string;
  cost: number;
  active: boolean;
  force?: boolean;
}): AssetPlan {
  const exists = existsSync(join(opts.projectDir, opts.path));
  const willGenerate = opts.active && (!exists || !!opts.force);
  return {
    cue: opts.cue,
    path: opts.path,
    exists,
    willGenerate,
    estimatedCostUsd: willGenerate ? opts.cost : 0,
  };
}

function firstExisting(projectDir: string, paths: string[]): string | null {
  for (const path of paths) {
    if (existsSync(join(projectDir, path))) return path;
  }
  return null;
}

function normalizeVideoProvider(value: string | null | undefined): string {
  const provider = String(value ?? "seedance").toLowerCase();
  if (provider === "fal") return "seedance";
  if (provider === "seedance" || provider === "grok" || provider === "kling" || provider === "runway" || provider === "veo") {
    return provider;
  }
  return "seedance";
}

function normalizeMusicProvider(value: string | null | undefined): string {
  const provider = String(value ?? "elevenlabs").toLowerCase();
  return provider === "replicate" ? "replicate" : "elevenlabs";
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}
