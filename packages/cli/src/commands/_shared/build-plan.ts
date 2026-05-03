import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

import { getApiKeyFromConfig } from "../../config/index.js";
import { PROVIDER_ENV_VARS } from "../../config/schema.js";
import {
  isReadyAssetReference,
  resolveGenericAssetReference,
  resolveTypedAssetReference,
  type AssetReferenceCandidate,
} from "./build-asset-reference.js";
import {
  backdropCacheDescriptor,
  type BuildAssetKind,
  type CacheAssetDescriptor,
  imageRatioForSize,
  musicCacheDescriptor,
  narrationCacheDescriptor,
  videoCacheDescriptor,
} from "./build-cache.js";
import {
  assetFreshnessFromMetadata,
  assetMetadataPath,
  type AssetFreshness,
} from "./build-asset-metadata.js";
import { composerEnvVar, isComposerProvider, type ComposerProvider } from "./composer-resolve.js";
import { parseStoryboard, type ParsedStoryboard } from "./storyboard-parse.js";
import { readProjectConfig, type LoadedProjectConfig } from "./project-config.js";
import { validateStoryboardMarkdown, type StoryboardValidationIssue } from "./storyboard-edit.js";

export type BuildStage = "assets" | "compose" | "sync" | "render" | "all";
export type BuildPlanStatus = "ready" | "invalid";
export type AssetPlanReason =
  | "canonical-exists"
  | "canonical-stale"
  | "canonical-unknown"
  | "content-cache-hit"
  | "force"
  | "missing"
  | "referenced-asset"
  | "invalid-reference"
  | "stage-skipped";
export type ProviderResolutionKind = BuildAssetKind | "composer";
export type ProviderResolutionSource = "cli" | "storyboard" | "project-config" | "default" | "auto";

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
  kind: BuildAssetKind;
  cue: string;
  provider: string;
  path: string;
  cachePath?: string;
  cacheKey?: string;
  metadataPath?: string;
  freshness?: AssetFreshness;
  sourcePath?: string;
  referenceError?: string;
  exists: boolean;
  canonicalExists: boolean;
  cacheHit: boolean;
  willCopyFromCache: boolean;
  willGenerate: boolean;
  estimatedCostUsd: number;
  reason: AssetPlanReason;
}

export interface ProviderResolution {
  kind: ProviderResolutionKind;
  requested: string | null;
  resolved: string;
  source: ProviderResolutionSource;
  requiresKey: boolean;
  configured: boolean;
  configKey?: string;
  missingKey?: string;
  retryWith: string[];
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
  providerResolution: ProviderResolution[];
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
  ttsProvider?: string;
  voice?: string;
  imageProvider?: string;
  imageQuality?: "standard" | "hd";
  imageSize?: string;
  videoProvider?: string;
  musicProvider?: string;
  composer?: string;
  force?: boolean;
}

const BACKDROP_COST_USD = 3;
const VIDEO_COST_USD = 5;
const MUSIC_COST_USD = 0.5;
const ELEVENLABS_NARRATION_COST_USD = 0.05;
const COMPOSE_COST_USD = 0.06;
const SUPPORTED_BUILD_IMAGE_PROVIDERS = ["openai", "gemini", "grok"] as const;

export async function createBuildPlan(opts: CreateBuildPlanOptions): Promise<BuildPlanResult> {
  const projectDir = resolve(opts.projectDir);
  loadPlanEnv(projectDir);
  const stage = opts.stage ?? "all";
  const config = await readProjectConfig(projectDir);
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const warnings: string[] = [];
  const retryWith: string[] = [];
  const providerResolution: ProviderResolution[] = [];

  if (!existsSync(storyboardPath)) {
    const validation = {
      ok: false,
      issues: [
        {
          severity: "error" as const,
          code: "STORYBOARD_NOT_FOUND",
          message: `STORYBOARD.md not found at ${storyboardPath}.`,
        },
      ],
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
      providerResolution,
      estimatedCostUsd: 0,
      warnings: [`STORYBOARD.md not found at ${storyboardPath}.`],
      retryWith: [`vibe init ${projectDir} --from "<brief>" --json`],
      validation,
    });
  }

  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const validation = validateStoryboardMarkdown(storyboardMd);
  const validationIssues: StoryboardValidationIssue[] = [...validation.issues];
  const parsed = parseStoryboard(storyboardMd);
  let sourceBeats = parsed.beats;
  if (opts.beat) {
    const selected = sourceBeats.find((beat) => beat.id === opts.beat);
    if (!selected) {
      warnings.push(
        `Beat "${opts.beat}" not found. Available: ${sourceBeats.map((beat) => beat.id).join(", ")}`
      );
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
  const mode = opts.mode ?? config.config.build.mode;
  const imageQuality = opts.imageQuality ?? config.config.build.imageQuality ?? "hd";
  const imageSize = opts.imageSize ?? config.config.build.imageSize ?? "1536x1024";
  const imageRatio = imageRatioForSize(imageSize);
  const needsComposer =
    includeCompose &&
    mode !== "agent" &&
    sourceBeats.some((beat) => !existsSync(join(projectDir, `compositions/scene-${beat.id}.html`)));
  const resolved = await resolvePlanProviders({
    projectDir,
    config,
    parsed,
    opts,
    needsComposer,
  });

  const warnedProviderKinds = new Set<string>();
  const noteProviderNeed = (resolution: ProviderResolution, commandContext: string) => {
    if (resolution.configured) return;
    const key = `${resolution.kind}:${resolution.resolved}`;
    if (warnedProviderKinds.has(key)) return;
    warnedProviderKinds.add(key);
    const missingKey = resolution.missingKey ? ` (${resolution.missingKey})` : "";
    warnings.push(
      `${commandContext} will need ${resolution.resolved}${missingKey}, but no key/config is available.`
    );
    retryWith.push(...resolution.retryWith);
  };

  const beats = sourceBeats.map((beat) => {
    const cue = beat.cues ?? {};
    const voice = stringOrUndefined(cue.voice) ?? resolved.voice;
    const narrationText = stringOrUndefined(cue.narration);
    const backdropPrompt = stringOrUndefined(cue.backdrop);
    const videoPrompt = stringOrUndefined(cue.video);
    const musicPrompt = stringOrUndefined(cue.music);
    const genericReference = resolveGenericAssetReference(projectDir, cue.asset);
    const narrationReference = resolveTypedAssetReference(projectDir, "narration", cue.narration);
    const backdropReference =
      resolveTypedAssetReference(projectDir, "backdrop", cue.backdrop) ??
      (!backdropPrompt && genericReference?.kind === "backdrop" ? genericReference : null);
    const videoReference =
      resolveTypedAssetReference(projectDir, "video", cue.video) ??
      (!videoPrompt && genericReference?.kind === "video" ? genericReference : null);
    const musicReference =
      resolveTypedAssetReference(projectDir, "music", cue.music) ??
      (!musicPrompt && genericReference?.kind === "music" ? genericReference : null);
    const narrationCue = narrationText ?? narrationReference?.raw;
    const backdropCue = backdropPrompt ?? backdropReference?.raw;
    const videoCue = videoPrompt ?? videoReference?.raw;
    const musicCue = musicPrompt ?? musicReference?.raw;
    const narrationCost =
      resolved.narration.resolved === "elevenlabs" ? ELEVENLABS_NARRATION_COST_USD : 0;
    const narrationCache =
      narrationText && !narrationReference
        ? narrationCacheDescriptor({
            beatId: beat.id,
            cue: narrationText,
            provider: resolved.narration.resolved,
            voice,
            ext: resolved.narration.resolved === "elevenlabs" ? "mp3" : "wav",
          })
        : null;
    const backdropCache =
      backdropPrompt && !backdropReference
        ? backdropCacheDescriptor({
            beatId: beat.id,
            cue: backdropPrompt,
            provider: resolved.image.resolved,
            quality: imageQuality,
            size: imageSize,
            ratio: imageRatio,
          })
        : null;
    const videoCache =
      videoPrompt && !videoReference
        ? videoCacheDescriptor({
            beatId: beat.id,
            cue: videoPrompt,
            provider: resolved.video.resolved,
            duration: beat.duration,
          })
        : null;
    const musicCache =
      musicPrompt && !musicReference
        ? musicCacheDescriptor({
            beatId: beat.id,
            cue: musicPrompt,
            provider: resolved.music.resolved,
            duration: beat.duration,
          })
        : null;

    const narration =
      narrationCue && !opts.skipNarration
        ? assetPlan({
            kind: "narration",
            beatId: beat.id,
            cue: narrationCue,
            provider: resolved.narration.resolved,
            path:
              firstExisting(projectDir, [
                `assets/narration-${beat.id}.mp3`,
                `assets/narration-${beat.id}.wav`,
              ]) ?? `assets/narration-${beat.id}.${narrationCache?.ext ?? "mp3"}`,
            cache: narrationCache,
            reference: narrationReference,
            projectDir,
            force: opts.force,
            cost: narrationCost,
            active: includeAssets,
          })
        : null;
    const backdrop =
      backdropCue && !opts.skipBackdrop
        ? assetPlan({
            kind: "backdrop",
            beatId: beat.id,
            cue: backdropCue,
            provider: resolved.image.resolved,
            path: `assets/backdrop-${beat.id}.png`,
            cache: backdropCache,
            reference: backdropReference,
            projectDir,
            force: opts.force,
            cost: BACKDROP_COST_USD,
            active: includeAssets,
          })
        : null;
    const video =
      videoCue && !opts.skipVideo
        ? assetPlan({
            kind: "video",
            beatId: beat.id,
            cue: videoCue,
            provider: resolved.video.resolved,
            path: `assets/video-${beat.id}.mp4`,
            cache: videoCache,
            reference: videoReference,
            projectDir,
            force: opts.force,
            cost: VIDEO_COST_USD,
            active: includeAssets,
          })
        : null;
    const music =
      musicCue && !opts.skipMusic
        ? assetPlan({
            kind: "music",
            beatId: beat.id,
            cue: musicCue,
            provider: resolved.music.resolved,
            path: `assets/music-${beat.id}.mp3`,
            cache: musicCache,
            reference: musicReference,
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
      if (asset.referenceError) {
        missing.add("assets");
        warnings.push(asset.referenceError);
        retryWith.push(
          `vibe storyboard set ${projectDir} ${beat.id} ${asset.kind} "<prompt-or-project-asset-path>" --json`
        );
        continue;
      }
      if (asset.willGenerate || asset.willCopyFromCache) {
        estimatedCostUsd += asset.estimatedCostUsd;
        missing.add("assets");
        providers.add(asset.provider);
      }
      if (asset.reason === "canonical-unknown") {
        warnings.push(
          `${asset.kind} asset for beat "${beat.id}" exists without freshness metadata; use --force if the cue changed.`
        );
        retryWith.push(`vibe build ${projectDir} --beat ${beat.id} --stage assets --force --json`);
      }
    }
    if (narration?.willGenerate) noteProviderNeed(resolved.narration, "Narration");
    if (backdrop?.willGenerate && isSupportedBuildImageProvider(resolved.image.resolved))
      noteProviderNeed(resolved.image, "Backdrop generation");
    if (video?.willGenerate) noteProviderNeed(resolved.video, "Video generation");
    if (music?.willGenerate) noteProviderNeed(resolved.music, "Music generation");
    if (!compositionExists) missing.add("compositions");
    if (includeCompose && !compositionExists && mode !== "agent") {
      estimatedCostUsd += COMPOSE_COST_USD;
      providers.add(resolved.composer?.resolved ?? "auto-composer");
      if (resolved.composer) noteProviderNeed(resolved.composer, "Composition");
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
  providerResolution.push(...providerResolutionsForPlan(resolved, beats, opts, includeAssets));

  if (
    includeAssets &&
    !opts.skipBackdrop &&
    !isSupportedBuildImageProvider(resolved.image.resolved)
  ) {
    const unsupportedBackdropBeats = beats.filter((beat) =>
      isBuildGeneratedBackdropPlan(beat.assets.backdrop)
    );
    for (const beat of unsupportedBackdropBeats) {
      validationIssues.push({
        severity: "error",
        code: "UNSUPPORTED_BUILD_IMAGE_PROVIDER",
        beatId: beat.id,
        message:
          `Build backdrop generation supports openai, gemini, and grok. Beat "${beat.id}" ` +
          `resolves image provider "${resolved.image.resolved}"; rerun with one of those or ` +
          "replace the backdrop cue with a project asset path.",
      });
    }
    if (unsupportedBackdropBeats.length > 0) {
      const beatFlag = opts.beat ? ` --beat ${opts.beat}` : "";
      retryWith.push(
        `vibe build ${projectDir}${beatFlag} --stage assets --image-provider openai --json`
      );
    }
  }
  const validationOk = !validationIssues.some((issue) => issue.severity === "error");

  if (!existsSync(join(projectDir, config.config.composition.entry))) {
    missing.add("root-composition");
    if (validationOk) retryWith.push(`vibe build ${projectDir} --stage sync --json`);
  }
  if (config.legacy) {
    warnings.push(
      `Using legacy ${config.source}; write ${projectDir}/vibe.config.json to use the TO-BE project contract.`
    );
  }
  if (!validation.ok) {
    retryWith.push(
      `vibe storyboard validate ${projectDir} --json`,
      `vibe storyboard revise ${projectDir} --from "<request>" --dry-run --json`
    );
  }

  if (validationOk && includeAssets && !opts.skipBackdrop) {
    const generatedBackdrops = beats
      .map((beat) => beat.assets.backdrop)
      .filter((asset): asset is AssetPlan => Boolean(asset?.willGenerate));
    if (generatedBackdrops.length > 0) {
      const cost = generatedBackdrops.reduce((sum, asset) => sum + asset.estimatedCostUsd, 0);
      const beatFlag = opts.beat ? ` --beat ${opts.beat}` : "";
      const skipCommand = `vibe build ${projectDir}${beatFlag} --stage ${stage} --skip-backdrop --json`;
      warnings.push(
        `Backdrop image generation will run for ${generatedBackdrops.length} beat(s), estimated $${cost.toFixed(2)}. Use --skip-backdrop for HTML/CSS-derived visuals: ${skipCommand}`
      );
      retryWith.push(skipCommand);
    }
  }

  return finalizeBuildPlan({
    projectDir,
    config,
    stage,
    status: validationOk ? "ready" : "invalid",
    currentStage: stage,
    mode,
    beat: opts.beat ?? null,
    beats,
    missing: [...missing],
    providers: [...providers].filter(Boolean),
    providerResolution,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(2)),
    warnings,
    retryWith,
    validation: {
      ok: validationOk,
      issues: validationIssues,
    },
  });
}

function finalizeBuildPlan(
  plan: Omit<BuildPlanResult, "schemaVersion" | "kind" | "summary" | "nextCommands">
): BuildPlanResult {
  const providers = [...plan.providers].filter(Boolean);
  const missing = [...plan.missing];
  const summary: BuildPlanSummary = {
    beats: plan.beats.length,
    missing,
    providers,
    estimatedCostUsd: Number(plan.estimatedCostUsd.toFixed(2)),
    validationErrors: plan.validation.issues.filter((issue) => issue.severity === "error").length,
    validationWarnings: plan.validation.issues.filter((issue) => issue.severity === "warning")
      .length,
  };
  return {
    schemaVersion: "1",
    kind: "build-plan",
    ...plan,
    providers,
    missing,
    providerResolution: plan.providerResolution,
    summary,
    nextCommands: nextCommandsForPlan({ ...plan, missing, providers, summary }),
    retryWith: unique(plan.retryWith),
  };
}

function isBuildGeneratedBackdropPlan(asset: AssetPlan | null): boolean {
  if (!asset || asset.kind !== "backdrop") return false;
  return !["referenced-asset", "invalid-reference", "stage-skipped"].includes(asset.reason);
}

function isSupportedBuildImageProvider(provider: string): boolean {
  return SUPPORTED_BUILD_IMAGE_PROVIDERS.includes(
    provider as (typeof SUPPORTED_BUILD_IMAGE_PROVIDERS)[number]
  );
}

function nextCommandsForPlan(
  plan: Omit<BuildPlanResult, "schemaVersion" | "kind" | "nextCommands">
): string[] {
  if (plan.status === "invalid") return unique(plan.retryWith);
  const commands: string[] = [];
  if (plan.missing.includes("assets"))
    commands.push(`vibe build ${plan.projectDir} --stage assets --json`);
  if (plan.missing.includes("compositions"))
    commands.push(`vibe build ${plan.projectDir} --stage compose --json`);
  if (plan.missing.includes("root-composition"))
    commands.push(`vibe build ${plan.projectDir} --stage sync --json`);
  if (commands.length === 0)
    commands.push(`vibe build ${plan.projectDir} --stage ${plan.stage} --json`);
  return unique(commands);
}

function assetPlan(opts: {
  kind: BuildAssetKind;
  beatId: string;
  cue: string;
  provider: string;
  path: string;
  cache: CacheAssetDescriptor | null;
  reference?: AssetReferenceCandidate | null;
  projectDir: string;
  cost: number;
  active: boolean;
  force?: boolean;
}): AssetPlan {
  if (!opts.active) {
    return {
      kind: opts.kind,
      cue: opts.cue,
      provider: opts.provider,
      path: opts.path,
      cachePath: opts.cache?.path,
      cacheKey: opts.cache?.key,
      metadataPath: assetMetadataPath(opts.kind, opts.beatId),
      exists: false,
      canonicalExists: false,
      cacheHit: false,
      willCopyFromCache: false,
      willGenerate: false,
      estimatedCostUsd: 0,
      reason: "stage-skipped",
    };
  }

  if (opts.reference) {
    const ready = isReadyAssetReference(opts.reference);
    const sourcePath = opts.reference.relPath ?? opts.reference.raw;
    return {
      kind: opts.kind,
      cue: opts.cue,
      provider: "local",
      path: ready ? sourcePath : opts.path,
      sourcePath,
      referenceError: opts.reference.error,
      freshness: ready ? "referenced" : undefined,
      exists: ready,
      canonicalExists: false,
      cacheHit: false,
      willCopyFromCache: false,
      willGenerate: false,
      estimatedCostUsd: 0,
      reason: ready ? "referenced-asset" : "invalid-reference",
    };
  }

  const canonicalExists = existsSync(join(opts.projectDir, opts.path));
  const cacheHit = opts.cache ? existsSync(join(opts.projectDir, opts.cache.path)) : false;
  const freshness = assetFreshnessFromMetadata({
    projectDir: opts.projectDir,
    kind: opts.kind,
    beatId: opts.beatId,
    expectedCacheKey: opts.cache?.key,
    canonicalExists,
  });
  const force = !!opts.force;
  const canonicalUsable = canonicalExists && freshness !== "stale";
  const needsAssetRefresh = !canonicalUsable;
  const willCopyFromCache = !force && needsAssetRefresh && cacheHit;
  const willGenerate = force || (needsAssetRefresh && !cacheHit);
  const reason: AssetPlanReason = force
    ? "force"
    : canonicalExists && freshness === "stale"
      ? "canonical-stale"
      : canonicalExists && freshness === "unknown"
        ? "canonical-unknown"
        : canonicalExists
          ? "canonical-exists"
          : cacheHit
            ? "content-cache-hit"
            : "missing";
  return {
    kind: opts.kind,
    cue: opts.cue,
    provider: opts.provider,
    path: opts.path,
    cachePath: opts.cache?.path,
    cacheKey: opts.cache?.key,
    metadataPath: assetMetadataPath(opts.kind, opts.beatId),
    freshness,
    exists: canonicalExists,
    canonicalExists,
    cacheHit,
    willCopyFromCache,
    willGenerate,
    estimatedCostUsd: willGenerate ? opts.cost : 0,
    reason,
  };
}

function providerResolutionsForPlan(
  resolved: ResolvedBuildProviders,
  beats: BuildPlanBeat[],
  opts: CreateBuildPlanOptions,
  includeAssets: boolean
): ProviderResolution[] {
  const needsProvider = (kind: BuildAssetKind) =>
    beats.some((beat) => {
      const asset = beat.assets[kind];
      return (
        asset &&
        asset.reason !== "referenced-asset" &&
        asset.reason !== "invalid-reference" &&
        asset.reason !== "stage-skipped"
      );
    });
  return [
    includeAssets && !opts.skipNarration && needsProvider("narration") ? resolved.narration : null,
    includeAssets && !opts.skipBackdrop && needsProvider("backdrop") ? resolved.image : null,
    includeAssets && !opts.skipVideo && needsProvider("video") ? resolved.video : null,
    includeAssets && !opts.skipMusic && needsProvider("music") ? resolved.music : null,
    resolved.composer ?? null,
  ].filter((resolution): resolution is ProviderResolution => Boolean(resolution));
}

interface ResolvedBuildProviders {
  narration: ProviderResolution;
  image: ProviderResolution;
  video: ProviderResolution;
  music: ProviderResolution;
  composer?: ProviderResolution;
  voice?: string;
}

async function resolvePlanProviders(opts: {
  projectDir: string;
  config: LoadedProjectConfig;
  parsed: ParsedStoryboard;
  opts: CreateBuildPlanOptions;
  needsComposer: boolean;
}): Promise<ResolvedBuildProviders> {
  const frontmatterProviders = opts.parsed.frontmatter?.providers as
    | Record<string, unknown>
    | undefined;
  const narrationInput = providerInput({
    cli: opts.opts.ttsProvider,
    storyboard: stringOrUndefined(frontmatterProviders?.tts),
    projectConfig: opts.config.config.providers.narration,
    fallback: "auto",
  });
  const imageInput = providerInput({
    cli: opts.opts.imageProvider,
    storyboard: stringOrUndefined(frontmatterProviders?.image),
    projectConfig: opts.config.config.providers.image,
    fallback: "openai",
  });
  const videoInput = providerInput({
    cli: opts.opts.videoProvider,
    storyboard: stringOrUndefined(frontmatterProviders?.video),
    projectConfig: opts.config.config.providers.video,
    fallback: "seedance",
  });
  const musicInput = providerInput({
    cli: opts.opts.musicProvider,
    storyboard: stringOrUndefined(frontmatterProviders?.music),
    projectConfig: opts.config.config.providers.music,
    fallback: "elevenlabs",
  });
  const composerInput = providerInput({
    cli: opts.opts.composer,
    storyboard: stringOrUndefined(frontmatterProviders?.composer),
    projectConfig: opts.config.config.providers.composer,
    fallback: "auto",
  });

  const narration = await resolveNarrationProvider(narrationInput, opts.projectDir);
  const image = await keyedProviderResolution(
    {
      kind: "backdrop",
      input: {
        ...imageInput,
        value: normalizeImageProvider(imageInput.value),
      },
      configKey: imageConfigKey(normalizeImageProvider(imageInput.value)),
    },
    opts.projectDir
  );
  const videoProvider = normalizeVideoProvider(videoInput.value);
  const video = await keyedProviderResolution(
    {
      kind: "video",
      input: {
        ...videoInput,
        value: videoProvider,
      },
      configKey: videoConfigKey(videoProvider),
    },
    opts.projectDir
  );
  const musicProvider = normalizeMusicProvider(musicInput.value);
  const music = await keyedProviderResolution(
    {
      kind: "music",
      input: {
        ...musicInput,
        value: musicProvider,
      },
      configKey: musicProvider,
    },
    opts.projectDir
  );
  const composer = opts.needsComposer
    ? await resolveComposerProvider(composerInput, opts.projectDir)
    : undefined;
  return {
    narration,
    image,
    video,
    music,
    composer,
    voice: opts.opts.voice ?? stringOrUndefined(opts.parsed.frontmatter?.voice),
  };
}

interface ProviderInput {
  value: string;
  requested: string | null;
  source: ProviderResolutionSource;
}

function providerInput(opts: {
  cli?: string | null;
  storyboard?: string | null;
  projectConfig?: string | null;
  fallback: string;
}): ProviderInput {
  const cli = stringOrUndefined(opts.cli);
  if (cli) return { value: cli, requested: cli, source: "cli" };
  const storyboard = stringOrUndefined(opts.storyboard);
  if (storyboard) return { value: storyboard, requested: storyboard, source: "storyboard" };
  const projectConfig = stringOrUndefined(opts.projectConfig);
  if (projectConfig)
    return { value: projectConfig, requested: projectConfig, source: "project-config" };
  return {
    value: opts.fallback,
    requested: null,
    source: opts.fallback === "auto" ? "auto" : "default",
  };
}

async function resolveNarrationProvider(
  input: ProviderInput,
  projectDir: string
): Promise<ProviderResolution> {
  const requested = input.value.toLowerCase();
  const hasElevenLabs = Boolean(await getApiKeyFromConfig("elevenlabs", { cwd: projectDir }));
  const resolved =
    requested === "elevenlabs"
      ? "elevenlabs"
      : requested === "kokoro"
        ? "kokoro"
        : hasElevenLabs
          ? "elevenlabs"
          : "kokoro";
  return {
    kind: "narration",
    requested: input.requested,
    resolved,
    source: input.source,
    requiresKey: resolved === "elevenlabs",
    configured: resolved !== "elevenlabs" || hasElevenLabs,
    ...(resolved === "elevenlabs" ? { configKey: "elevenlabs" } : {}),
    ...(resolved === "elevenlabs" && !hasElevenLabs
      ? { missingKey: providerEnvVar("elevenlabs") }
      : {}),
    retryWith: resolved === "elevenlabs" && !hasElevenLabs ? ["vibe setup --full"] : [],
  };
}

async function keyedProviderResolution(
  opts: {
    kind: ProviderResolutionKind;
    input: ProviderInput;
    configKey: string;
  },
  projectDir: string
): Promise<ProviderResolution> {
  const configured = Boolean(await getApiKeyFromConfig(opts.configKey, { cwd: projectDir }));
  return {
    kind: opts.kind,
    requested: opts.input.requested,
    resolved: opts.input.value,
    source: opts.input.source,
    requiresKey: true,
    configured,
    configKey: opts.configKey,
    ...(!configured ? { missingKey: providerEnvVar(opts.configKey) } : {}),
    retryWith: configured ? [] : ["vibe setup --full"],
  };
}

async function resolveComposerProvider(
  input: ProviderInput,
  projectDir: string
): Promise<ProviderResolution> {
  const requested = input.value.toLowerCase();
  const explicit = isComposerProvider(requested) ? requested : undefined;
  const resolved = explicit ?? (await firstConfiguredComposer(projectDir)) ?? "claude";
  const configKey = composerConfigKey(resolved);
  const configured = Boolean(await getApiKeyFromConfig(configKey, { cwd: projectDir }));
  return {
    kind: "composer",
    requested: input.requested,
    resolved,
    source: explicit ? input.source : "auto",
    requiresKey: true,
    configured,
    configKey,
    ...(!configured ? { missingKey: composerEnvVar(resolved) } : {}),
    retryWith: configured ? [] : ["vibe setup --full"],
  };
}

async function firstConfiguredComposer(projectDir: string): Promise<ComposerProvider | null> {
  for (const provider of ["claude", "gemini", "openai"] as const) {
    if (await getApiKeyFromConfig(composerConfigKey(provider), { cwd: projectDir }))
      return provider;
  }
  return null;
}

function firstExisting(projectDir: string, paths: string[]): string | null {
  for (const path of paths) {
    if (existsSync(join(projectDir, path))) return path;
  }
  return null;
}

function normalizeImageProvider(value: string | null | undefined): string {
  const provider = String(value ?? "openai").toLowerCase();
  return provider || "openai";
}

function normalizeVideoProvider(value: string | null | undefined): string {
  const provider = String(value ?? "seedance").toLowerCase();
  if (provider === "fal") return "seedance";
  if (
    provider === "seedance" ||
    provider === "grok" ||
    provider === "kling" ||
    provider === "runway" ||
    provider === "veo"
  ) {
    return provider;
  }
  return "seedance";
}

function normalizeMusicProvider(value: string | null | undefined): string {
  const provider = String(value ?? "elevenlabs").toLowerCase();
  return provider === "replicate" ? "replicate" : "elevenlabs";
}

function imageConfigKey(provider: string): string {
  if (provider === "grok") return "xai";
  if (provider === "gemini") return "google";
  return "openai";
}

function videoConfigKey(provider: string): string {
  return provider === "seedance"
    ? "fal"
    : provider === "grok"
      ? "xai"
      : provider === "veo"
        ? "google"
        : provider;
}

function composerConfigKey(provider: ComposerProvider): string {
  return provider === "claude" ? "anthropic" : provider === "gemini" ? "google" : "openai";
}

function providerEnvVar(configKey: string): string {
  return PROVIDER_ENV_VARS[configKey] ?? `${configKey.toUpperCase()}_API_KEY`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function loadPlanEnv(projectDir: string): void {
  loadDotenv({ path: join(projectDir, ".env"), quiet: true });
  loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      loadDotenv({ path: join(dir, ".env"), quiet: true });
      return;
    }
    dir = dirname(dir);
  }
}
