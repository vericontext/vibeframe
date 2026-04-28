/**
 * Pipeline executor — maps YAML actions to CLI execute functions.
 */

import { resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { PipelineManifest, PipelineAction, PipelineBudget, StepResult, PipelineResult, BudgetUsage } from "./types.js";
import { resolveStepParams, findUnresolvedRefs } from "./resolver.js";
import { COST_ESTIMATES } from "../commands/output.js";

// ── Action → CLI command mapping (for cost lookup) ──────────────────────

const ACTION_TO_COMMAND: Partial<Record<PipelineAction, string>> = {
  "generate-image": "generate image",
  "generate-video": "generate video",
  "generate-tts": "generate speech",
  "generate-sfx": "generate sound-effect",
  "generate-music": "generate music",
  "generate-storyboard": "generate storyboard",
  "generate-motion": "generate motion",
  "edit-silence-cut": "edit silence-cut",
  "edit-jump-cut": "edit jump-cut",
  "edit-caption": "edit caption",
  "edit-noise-reduce": "edit noise-reduce",
  "edit-fade": "edit fade",
  "edit-translate-srt": "edit translate-srt",
  "edit-text-overlay": "edit text-overlay",
  "edit-grade": "edit grade",
  "edit-speed-ramp": "edit speed-ramp",
  "edit-reframe": "edit reframe",
  "edit-interpolate": "edit interpolate",
  "edit-upscale": "edit upscale-video",
  "edit-image": "edit image",
  "audio-transcribe": "audio transcribe",
  "detect-scenes": "detect scenes",
  "detect-silence": "detect silence",
  "detect-beats": "detect beats",
  "analyze-media": "analyze media",
  "analyze-video": "analyze video",
  "review-video": "analyze review",
  "compose-scenes-with-skills": "compose scenes with skills",
};

function maxCostFor(action: PipelineAction): number {
  const cmd = ACTION_TO_COMMAND[action];
  if (!cmd) return 0;
  return COST_ESTIMATES[cmd]?.max ?? 0;
}

// ── Action Registry ─────────────────────────────────────────────────────

type ActionHandler = (params: Record<string, unknown>, outputDir: string) => Promise<StepResult>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {};

function registerAction(action: PipelineAction, handler: ActionHandler): void {
  ACTION_HANDLERS[action] = handler;
}

/** Helper: get output path from params or generate default */
function getOutput(params: Record<string, unknown>, outputDir: string, defaultName: string): string {
  if (params.output && typeof params.output === "string") {
    return resolve(outputDir, params.output);
  }
  return resolve(outputDir, defaultName);
}

// ── Register all actions (lazy-loaded to avoid circular imports) ─────────

async function ensureActionsRegistered(): Promise<void> {
  if (Object.keys(ACTION_HANDLERS).length > 0) return;

  // Generate
  registerAction("generate-image", async (params, outputDir) => {
    const { executeImageGenerate } = await import("../commands/ai-image.js");
    const output = getOutput(params, outputDir, "image.png");
    const r = await executeImageGenerate({ prompt: params.prompt as string, provider: params.provider as "gemini" | "openai" | "grok" | undefined, output, model: params.model as string | undefined, ratio: params.ratio as string | undefined });
    return { id: "", action: "generate-image", success: r.success, output: r.outputPath, data: { provider: r.provider, model: r.model }, error: r.error };
  });

  registerAction("generate-video", async (params, outputDir) => {
    const { executeVideoGenerate } = await import("../commands/ai-video.js");
    const output = getOutput(params, outputDir, "video.mp4");
    const r = await executeVideoGenerate({ prompt: params.prompt as string, provider: params.provider as "grok" | "kling" | "runway" | "veo" | undefined, image: params.image as string | undefined, duration: params.duration as number | undefined, ratio: params.ratio as string | undefined, output, wait: true });
    return { id: "", action: "generate-video", success: r.success, output: r.outputPath || r.videoUrl, data: { taskId: r.taskId, provider: r.provider, videoUrl: r.videoUrl }, error: r.error };
  });

  registerAction("generate-tts", async (params, outputDir) => {
    const { executeSpeech } = await import("../commands/generate.js");
    const output = getOutput(params, outputDir, "speech.mp3");
    const r = await executeSpeech({ text: params.text as string, voice: params.voice as string | undefined, output });
    return { id: "", action: "generate-tts", success: r.success, output: r.outputPath, data: { characterCount: r.characterCount }, error: r.error };
  });

  registerAction("generate-sfx", async (params, outputDir) => {
    const { executeSoundEffect } = await import("../commands/generate.js");
    const output = getOutput(params, outputDir, "sfx.mp3");
    const r = await executeSoundEffect({ prompt: params.prompt as string, duration: params.duration as number | undefined, output });
    return { id: "", action: "generate-sfx", success: r.success, output: r.outputPath, error: r.error };
  });

  registerAction("generate-music", async (params, outputDir) => {
    const { executeMusic } = await import("../commands/generate.js");
    const output = getOutput(params, outputDir, "music.mp3");
    const r = await executeMusic({ prompt: params.prompt as string, duration: params.duration as number | undefined, provider: params.provider as "elevenlabs" | "replicate" | undefined, instrumental: params.instrumental as boolean | undefined, output });
    return { id: "", action: "generate-music", success: r.success, output: r.outputPath, data: { provider: r.provider, duration: r.duration }, error: r.error };
  });

  registerAction("generate-storyboard", async (params, outputDir) => {
    const { executeStoryboard } = await import("../commands/generate.js");
    const output = getOutput(params, outputDir, "storyboard.yaml");
    const r = await executeStoryboard({ content: params.content as string, duration: params.duration as number | undefined, creativity: params.creativity as "low" | "high" | undefined, output });
    return { id: "", action: "generate-storyboard", success: r.success, output: r.outputPath, data: { segmentCount: r.segmentCount }, error: r.error };
  });

  registerAction("generate-motion", async (params, outputDir) => {
    const { executeMotion } = await import("../commands/ai-motion.js");
    const output = getOutput(params, outputDir, "motion.tsx");
    const r = await executeMotion({ description: params.description as string || params.prompt as string, duration: params.duration as number | undefined, render: params.render as boolean | undefined, video: params.video as string | undefined, output });
    return { id: "", action: "generate-motion", success: r.success, output: r.renderedPath || r.codePath, data: { codePath: r.codePath, renderedPath: r.renderedPath }, error: r.error };
  });

  // Edit
  registerAction("edit-silence-cut", async (params, outputDir) => {
    const { executeSilenceCut } = await import("../commands/ai-edit.js");
    const output = getOutput(params, outputDir, "silence-cut.mp4");
    const r = await executeSilenceCut({ videoPath: params.input as string, outputPath: output, padding: params.padding as number | undefined });
    return { id: "", action: "edit-silence-cut", success: r.success, output: r.outputPath, data: { totalDuration: r.totalDuration, silentDuration: r.silentDuration }, error: r.error };
  });

  registerAction("edit-caption", async (params, outputDir) => {
    const { executeCaption } = await import("../commands/ai-edit.js");
    const output = getOutput(params, outputDir, "captioned.mp4");
    const r = await executeCaption({ videoPath: params.input as string, outputPath: output, language: params.language as string | undefined });
    return { id: "", action: "edit-caption", success: r.success, output: r.outputPath, error: r.error };
  });

  registerAction("edit-noise-reduce", async (params, outputDir) => {
    const { executeNoiseReduce } = await import("../commands/ai-edit.js");
    const output = getOutput(params, outputDir, "denoised.mp4");
    const r = await executeNoiseReduce({ inputPath: params.input as string, outputPath: output, strength: params.strength as "low" | "medium" | "high" | undefined });
    return { id: "", action: "edit-noise-reduce", success: r.success, output: r.outputPath, error: r.error };
  });

  registerAction("edit-fade", async (params, outputDir) => {
    const { executeFade } = await import("../commands/ai-edit.js");
    const output = getOutput(params, outputDir, "faded.mp4");
    const r = await executeFade({ videoPath: params.input as string, outputPath: output, fadeIn: params.fadeIn as number | undefined, fadeOut: params.fadeOut as number | undefined });
    return { id: "", action: "edit-fade", success: r.success, output: r.outputPath, error: r.error };
  });

  registerAction("edit-grade", async (params, outputDir) => {
    const { executeGrade } = await import("../commands/edit-cmd.js");
    const output = getOutput(params, outputDir, "graded.mp4");
    const r = await executeGrade({ videoPath: params.input as string, style: params.style as string | undefined, preset: params.preset as string | undefined, output });
    return { id: "", action: "edit-grade", success: r.success, output: r.outputPath, data: { description: r.description }, error: r.error };
  });

  registerAction("edit-reframe", async (params, outputDir) => {
    const { executeReframe } = await import("../commands/edit-cmd.js");
    const output = getOutput(params, outputDir, "reframed.mp4");
    const r = await executeReframe({ videoPath: params.input as string, aspect: params.aspect as string | undefined, output });
    return { id: "", action: "edit-reframe", success: r.success, output: r.outputPath, error: r.error };
  });

  // Audio
  registerAction("audio-transcribe", async (params, outputDir) => {
    const { executeTranscribe } = await import("../commands/ai-audio.js");
    const output = getOutput(params, outputDir, "transcript.srt");
    const r = await executeTranscribe({ audioPath: params.input as string, language: params.language as string | undefined, output });
    return { id: "", action: "audio-transcribe", success: r.success, output: r.outputPath, data: { text: r.text, segmentCount: r.segments?.length }, error: r.error };
  });

  registerAction("audio-duck", async (params, outputDir) => {
    const { executeDuck } = await import("../commands/ai-audio.js");
    const output = getOutput(params, outputDir, "ducked.mp3");
    const r = await executeDuck({ musicPath: params.music as string, voicePath: params.voice as string, output });
    return { id: "", action: "audio-duck", success: r.success, output: r.outputPath, error: r.error };
  });

  // Detect
  registerAction("detect-scenes", async (params, outputDir) => {
    const { executeDetectScenes } = await import("../commands/detect.js");
    const output = getOutput(params, outputDir, "scenes.json");
    const r = await executeDetectScenes({ videoPath: params.input as string, threshold: params.threshold as number | undefined, outputPath: output });
    return { id: "", action: "detect-scenes", success: r.success, output, data: { scenes: r.scenes, totalDuration: r.totalDuration }, error: r.error };
  });

  registerAction("detect-silence", async (params, _outputDir) => {
    const { executeDetectSilence } = await import("../commands/detect.js");
    const r = await executeDetectSilence({ mediaPath: params.input as string, noise: params.noise as string | undefined, duration: params.duration as string | undefined });
    return { id: "", action: "detect-silence", success: r.success, data: { silences: r.silences }, error: r.error };
  });

  registerAction("detect-beats", async (params, _outputDir) => {
    const { executeDetectBeats } = await import("../commands/detect.js");
    const r = await executeDetectBeats({ audioPath: params.input as string });
    return { id: "", action: "detect-beats", success: r.success, data: { beats: r.beats }, error: r.error };
  });

  // Analyze
  registerAction("analyze-video", async (params, _outputDir) => {
    const { executeGeminiVideo } = await import("../commands/ai-analyze.js");
    const r = await executeGeminiVideo({ source: params.input as string, prompt: params.prompt as string, model: params.model as "flash" | "flash-2.5" | "pro" | undefined });
    return { id: "", action: "analyze-video", success: r.success, data: { response: r.response, model: r.model }, error: r.error };
  });

  // Review
  registerAction("review-video", async (params, _outputDir) => {
    const { executeReview } = await import("../commands/ai-review.js");
    const r = await executeReview({ videoPath: params.input as string, autoApply: params.autoApply as boolean | undefined, model: params.model as "flash" | "flash-2.5" | "pro" | undefined });
    return { id: "", action: "review-video", success: r.success, output: r.outputPath, data: { feedback: r.feedback }, error: r.error };
  });

  // Scene composition (v0.59+)
  registerAction("compose-scenes-with-skills", async (params, outputDir) => {
    const { executeComposeScenesWithSkills } = await import("../commands/_shared/compose-scenes-skills.js");
    const r = await executeComposeScenesWithSkills(
      {
        design: params.design as string | undefined,
        storyboard: params.storyboard as string | undefined,
        project: params.project as string | undefined,
        effort: params.effort as "low" | "medium" | "high" | undefined,
        composer: params.composer as "claude" | "openai" | "gemini" | undefined,
      },
      outputDir,
    );
    return {
      id: "",
      action: "compose-scenes-with-skills",
      success: r.success,
      output: r.outputPath,
      data: r.data as Record<string, unknown> | undefined,
      error: r.error,
    };
  });

  // v0.62: STORYBOARD → MP4 in one action. Reads frontmatter + per-beat
  // cues, dispatches TTS + image-gen per beat, runs compose-scenes-with-
  // skills, then renders. Idempotent — existing assets are reused.
  registerAction("scene-build", async (params, outputDir) => {
    const { executeSceneBuild } = await import("../commands/_shared/scene-build.js");
    const projectRel = (params.project as string | undefined) ?? ".";
    const r = await executeSceneBuild({
      projectDir: resolve(outputDir, projectRel),
      mode: params.mode as "agent" | "batch" | "auto" | undefined,
      effort: params.effort as "low" | "medium" | "high" | undefined,
      composer: params.composer as "claude" | "openai" | "gemini" | undefined,
      skipNarration: params.skipNarration as boolean | undefined,
      skipBackdrop: params.skipBackdrop as boolean | undefined,
      skipRender: params.skipRender as boolean | undefined,
      ttsProvider: params.tts as "auto" | "elevenlabs" | "kokoro" | undefined,
      voice: params.voice as string | undefined,
      imageProvider: params.imageProvider as "openai" | undefined,
      imageQuality: params.quality as "standard" | "hd" | undefined,
      force: params.force as boolean | undefined,
    });
    return {
      id: "",
      action: "scene-build",
      success: r.success,
      output: r.outputPath,
      data: { beats: r.beats, totalLatencyMs: r.totalLatencyMs, composeData: r.composeData ?? null } as Record<string, unknown>,
      error: r.error,
    };
  });

  // v0.62: render-only escape hatch for pipelines that author scene HTML
  // by hand (or via compose-scenes-with-skills) and only need the
  // Hyperframes producer pass + audio mux at the end.
  registerAction("scene-render", async (params, outputDir) => {
    const { executeSceneRender } = await import("../commands/_shared/scene-render.js");
    const projectRel = (params.project as string | undefined) ?? ".";
    const r = await executeSceneRender({
      projectDir: resolve(outputDir, projectRel),
      root: params.root as string | undefined,
      output: params.output as string | undefined,
      fps: params.fps as 24 | 30 | 60 | undefined,
      quality: params.quality as "draft" | "standard" | "high" | undefined,
      format: params.format as "mp4" | "webm" | "mov" | undefined,
      workers: params.workers as number | undefined,
    });
    return {
      id: "",
      action: "scene-render",
      success: r.success,
      output: r.outputPath,
      data: {
        durationMs: r.durationMs,
        framesRendered: r.framesRendered,
        audioCount: r.audioCount,
        audioMuxApplied: r.audioMuxApplied,
      } as Record<string, unknown>,
      error: r.error,
    };
  });
}

// ── Pipeline Loader ─────────────────────────────────────────────────────

export async function loadPipeline(filePath: string): Promise<PipelineManifest> {
  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    throw new Error(`Pipeline file not found: ${absPath}`);
  }

  const content = await readFile(absPath, "utf-8");
  const manifest = yamlParse(content) as PipelineManifest;

  // Validate
  if (!manifest.name) throw new Error("Pipeline missing 'name' field");
  if (!manifest.steps || !Array.isArray(manifest.steps)) throw new Error("Pipeline missing 'steps' array");

  const ids = new Set<string>();
  for (const step of manifest.steps) {
    if (!step.id) throw new Error("Each step must have an 'id' field");
    if (!step.action) throw new Error(`Step '${step.id}' missing 'action' field`);
    if (ids.has(step.id)) throw new Error(`Duplicate step id: '${step.id}'`);
    ids.add(step.id);
  }

  return manifest;
}

// ── Pipeline Executor ───────────────────────────────────────────────────

export interface ExecutePipelineOptions {
  /** Output directory for all step outputs */
  outputDir?: string;
  /** Only validate and show plan, don't execute */
  dryRun?: boolean;
  /** Resume from checkpoint (skip completed steps) */
  resume?: boolean;
  /** Stop on first failure */
  failFast?: boolean;
  /** Override manifest.budget (partial merge) */
  budget?: PipelineBudget;
}

const CHECKPOINT_FILE = ".pipeline-state.yaml";

interface CheckpointState {
  completedSteps: Array<{ id: string; action?: PipelineAction; output?: string; data?: Record<string, unknown> }>;
}

export async function executePipeline(
  manifest: PipelineManifest,
  options: ExecutePipelineOptions = {},
): Promise<PipelineResult> {
  await ensureActionsRegistered();

  const outputDir = resolve(process.cwd(), options.outputDir || `${manifest.name}-output`);
  await mkdir(outputDir, { recursive: true });

  const completedSteps = new Map<string, StepResult>();
  const results: StepResult[] = [];
  const startTime = Date.now();

  // Load checkpoint if resuming
  if (options.resume) {
    const checkpointPath = resolve(outputDir, CHECKPOINT_FILE);
    if (existsSync(checkpointPath)) {
      const checkpointContent = await readFile(checkpointPath, "utf-8");
      const checkpoint = yamlParse(checkpointContent) as CheckpointState;
      for (const cs of checkpoint.completedSteps) {
        completedSteps.set(cs.id, {
          id: cs.id,
          action: cs.action ?? ("generate-image" as PipelineAction), // fallback for checkpoints written before v0.46.2
          success: true,
          output: cs.output,
          data: cs.data,
        });
      }
    }
  }

  // Merge manifest budget with CLI overrides
  const effectiveBudget: PipelineBudget | undefined = (manifest.budget || options.budget)
    ? { ...(manifest.budget ?? {}), ...(options.budget ?? {}) }
    : undefined;

  // Dry-run: validate and show plan
  if (options.dryRun) {
    const plan: Array<{ id: string; action: string; estimatedCost?: string; unresolvedRefs?: string[] }> = [];
    const availableIds = new Set<string>();
    let totalMaxCost = 0;

    for (const step of manifest.steps) {
      const handler = ACTION_HANDLERS[step.action];
      const unresolvedRefs = findUnresolvedRefs(step as unknown as Record<string, unknown>, availableIds);
      const max = maxCostFor(step.action);
      totalMaxCost += max;

      plan.push({
        id: step.id,
        action: step.action,
        estimatedCost: max > 0 ? `≤$${max.toFixed(2)}` : undefined,
        unresolvedRefs: unresolvedRefs.length > 0 ? unresolvedRefs : undefined,
      });

      if (!handler) {
        plan[plan.length - 1].estimatedCost = "UNKNOWN ACTION";
      }

      availableIds.add(step.id);
    }

    const budgetWarnings: string[] = [];
    if (effectiveBudget?.costUsd !== undefined && totalMaxCost > effectiveBudget.costUsd) {
      budgetWarnings.push(`Upper-bound cost estimate ($${totalMaxCost.toFixed(2)}) exceeds budget.costUsd ($${effectiveBudget.costUsd.toFixed(2)})`);
    }

    return {
      success: true,
      name: manifest.name,
      steps: plan.map(p => ({ id: p.id, action: p.action as PipelineAction, success: true, data: p as unknown as Record<string, unknown> })),
      completedSteps: 0,
      totalSteps: manifest.steps.length,
      outputDir,
      budget: effectiveBudget ? {
        estimatedCostUsd: totalMaxCost,
        tokensUsed: 0,
        toolErrors: 0,
        ...(budgetWarnings.length > 0 ? { abortedBy: "costUsd" as const } : {}),
      } : undefined,
    };
  }

  // Budget tracking — seed from already-completed steps so resume enforces
  // pipeline-wide budget (not just this-run budget).
  const budgetUsage: BudgetUsage = { estimatedCostUsd: 0, tokensUsed: 0, toolErrors: 0 };
  for (const cs of completedSteps.values()) {
    budgetUsage.estimatedCostUsd += maxCostFor(cs.action);
  }

  // Execute steps
  for (const step of manifest.steps) {
    // Skip if already completed (resume mode)
    if (completedSteps.has(step.id)) {
      results.push(completedSteps.get(step.id)!);
      continue;
    }

    // Budget pre-check: cost ceiling
    if (effectiveBudget?.costUsd !== undefined) {
      const projected = budgetUsage.estimatedCostUsd + maxCostFor(step.action);
      if (projected > effectiveBudget.costUsd) {
        budgetUsage.abortedBy = "costUsd";
        return {
          success: false,
          name: manifest.name,
          steps: results,
          completedSteps: completedSteps.size,
          totalSteps: manifest.steps.length,
          totalDuration: Date.now() - startTime,
          outputDir,
          error: `Budget exceeded: projected $${projected.toFixed(2)} > budget.costUsd $${effectiveBudget.costUsd.toFixed(2)} (stopped before step '${step.id}')`,
          budget: budgetUsage,
        };
      }
    }

    const handler = ACTION_HANDLERS[step.action];
    if (!handler) {
      const result: StepResult = { id: step.id, action: step.action, success: false, error: `Unknown action: ${step.action}` };
      results.push(result);
      budgetUsage.toolErrors += 1;
      if (options.failFast) {
        return { success: false, name: manifest.name, steps: results, completedSteps: completedSteps.size, totalSteps: manifest.steps.length, outputDir, error: result.error, budget: effectiveBudget ? budgetUsage : undefined };
      }
      continue;
    }

    // Resolve variable references
    const resolvedParams = resolveStepParams(step as unknown as Record<string, unknown>, completedSteps);

    // Execute step
    const stepStart = Date.now();
    let result: StepResult;

    try {
      result = await handler(resolvedParams, outputDir);
      result.id = step.id;
      result.duration = Date.now() - stepStart;
    } catch (err) {
      result = {
        id: step.id,
        action: step.action,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - stepStart,
      };
    }

    results.push(result);

    if (result.success) {
      completedSteps.set(step.id, result);
      budgetUsage.estimatedCostUsd += maxCostFor(step.action);

      // Save checkpoint
      const checkpoint: CheckpointState = {
        completedSteps: Array.from(completedSteps.values()).map(s => ({
          id: s.id,
          action: s.action,
          output: s.output,
          data: s.data,
        })),
      };
      await writeFile(
        resolve(outputDir, CHECKPOINT_FILE),
        yamlStringify(checkpoint, { indent: 2 }),
        "utf-8",
      );
    } else {
      budgetUsage.toolErrors += 1;

      // Abort if maxToolErrors exceeded
      if (effectiveBudget?.maxToolErrors !== undefined && budgetUsage.toolErrors > effectiveBudget.maxToolErrors) {
        budgetUsage.abortedBy = "maxToolErrors";
        return {
          success: false,
          name: manifest.name,
          steps: results,
          completedSteps: completedSteps.size,
          totalSteps: manifest.steps.length,
          totalDuration: Date.now() - startTime,
          outputDir,
          error: `Budget exceeded: ${budgetUsage.toolErrors} failed steps > budget.maxToolErrors ${effectiveBudget.maxToolErrors}`,
          budget: budgetUsage,
        };
      }

      if (options.failFast) {
        return {
          success: false,
          name: manifest.name,
          steps: results,
          completedSteps: completedSteps.size,
          totalSteps: manifest.steps.length,
          totalDuration: Date.now() - startTime,
          outputDir,
          error: result.error,
          budget: effectiveBudget ? budgetUsage : undefined,
        };
      }
    }
  }

  const allSuccess = results.every(r => r.success);

  return {
    success: allSuccess,
    name: manifest.name,
    steps: results,
    completedSteps: completedSteps.size,
    totalSteps: manifest.steps.length,
    totalDuration: Date.now() - startTime,
    outputDir,
    budget: effectiveBudget ? budgetUsage : undefined,
  };
}
