/**
 * @module manifest/scene
 * @description Scene authoring tools (init/add/lint/render/build/styles).
 */

import { z } from "zod";
import { resolve, relative } from "node:path";
import { defineTool, type AnyTool, type ToolExecuteResult } from "../define-tool.js";
import { runWithMcpPromotion, type LocalJobUpdate } from "../_shared/long-poll.js";
import { applyElicitationAnswers, planBuildElicitation } from "../_shared/elicit.js";
import { listVisualStyles, getVisualStyle } from "../../commands/_shared/visual-styles.js";
import { scaffoldSceneProject, type SceneAspect } from "../../commands/_shared/scene-project.js";
import { executeSceneAdd } from "../../commands/scene.js";
import { runProjectLint, type ProjectLintResult } from "../../commands/_shared/scene-lint.js";
import {
  executeSceneRender,
  type RenderFps,
  type RenderQuality,
  type RenderFormat,
} from "../../commands/_shared/scene-render.js";
import {
  executeSceneBuild,
  type SceneBuildProgressEvent,
} from "../../commands/_shared/scene-build.js";
import type { ScenePreset } from "../../commands/_shared/scene-html-emit.js";
import {
  installHyperframesSkill,
  deriveInstallHosts,
  type InstallSkillHost,
} from "../../commands/_shared/install-skill.js";
import { detectedAgentHosts } from "../../utils/agent-host-detect.js";
import { getComposePrompts } from "../../commands/_shared/compose-prompts.js";
import { executeSceneRepair } from "../../commands/_shared/scene-repair.js";
import { executeSceneSubmit } from "../../commands/_shared/scene-submit.js";

const SCENE_PRESETS = [
  "simple",
  "announcement",
  "explainer",
  "kinetic-type",
  "product-shot",
] as const;

const PROJECT_DIR_DESCRIPTION =
  "Project directory. Defaults to the surface's cwd; in MCP hosts, relative paths resolve under the configured server workspace.";

const INIT_DIR_DESCRIPTION =
  "Project directory to create. Prefer a project name or workspace-relative path; in MCP hosts, relative paths resolve under the configured server workspace. Do not use /tmp or /home/claude unless the user explicitly asks.";

const sceneStylesSchema = z.object({
  name: z
    .string()
    .optional()
    .describe("Style name or slug (e.g. 'Swiss Pulse', 'swiss-pulse'). Omit to list all 8."),
});

export const sceneStylesTool = defineTool({
  name: "scene_list_styles",
  category: "scene",
  cost: "free",
  title: "List Visual Styles",
  annotations: { readOnly: true, openWorld: false },
  description:
    "List the 8 vendored visual identities available for `init --visual-style` (Swiss Pulse, Data Drift, …) or, when `name` is provided, return the full DESIGN.md hard-gate body for one style. The DESIGN.md content is what the LLM uses as a non-negotiable visual rulebook during compose-scenes-with-skills.",
  schema: sceneStylesSchema,
  async execute(args) {
    if (args.name) {
      const style = getVisualStyle(args.name);
      if (!style) {
        return {
          success: false,
          error: `Unknown visual style "${args.name}". Run scene_list_styles with no name to list all 8.`,
        };
      }
      return {
        success: true,
        data: { style },
        humanLines: [
          `🎨 ${style.name} (${style.slug})`,
          `   designer: ${style.designer}`,
          `   mood:     ${style.mood}`,
          `   bestFor:  ${style.bestFor}`,
          `   palette:  ${style.palette.join(", ")} — ${style.paletteNotes}`,
          `   typography: ${style.typography}`,
          `   composition: ${style.composition}`,
          `   motion:      ${style.motion}`,
          `   transition:  ${style.transition}`,
          `   gsap:        ${style.gsapSignature}`,
          `   avoid:       ${style.avoid.join(" · ")}`,
        ],
      };
    }

    const styles = listVisualStyles();
    return {
      success: true,
      data: {
        count: styles.length,
        styles: styles.map((s) => ({
          slug: s.slug,
          name: s.name,
          designer: s.designer,
          mood: s.mood,
          bestFor: s.bestFor,
        })),
      },
      humanLines: [
        `📚 ${styles.length} vendored visual identities:`,
        ...styles.map((s) => `   • ${s.name} (${s.slug}) — ${s.mood}; best for ${s.bestFor}`),
        ``,
        `Run scene_list_styles { name: "<slug>" } to fetch the full DESIGN.md hard-gate body for one style.`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const sceneInitSchema = z.object({
  dir: z.string().describe(INIT_DIR_DESCRIPTION),
  name: z.string().optional().describe("Project name. Defaults to the directory basename."),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional().describe("Aspect ratio. Default 16:9."),
  duration: z
    .number()
    .optional()
    .describe("Default root composition duration in seconds. Default 10."),
});

export const sceneInitTool = defineTool({
  name: "init",
  category: "scene",
  cost: "free",
  title: "Initialize Video Project",
  annotations: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
  description:
    "Scaffold a new VibeFrame video scene project. Supports minimal, agent, and full profiles; full includes the current HTML render backend metadata. Idempotent: re-running keeps user-authored files and merges backend config instead of overwriting. No API keys required.",
  schema: sceneInitSchema,
  async execute(args, ctx) {
    const dir = resolve(ctx.workingDirectory, args.dir);
    const result = await scaffoldSceneProject({
      dir,
      name: args.name,
      aspect: args.aspect as SceneAspect | undefined,
      duration: args.duration,
    });
    const displayDir = relative(ctx.workingDirectory, dir) || dir;
    return {
      success: true,
      data: {
        dir,
        created: result.created,
        merged: result.merged,
        skipped: result.skipped,
      },
      humanLines: [
        `✅ Scene project scaffolded at ${displayDir}`,
        `   created: ${result.created.length} file(s)`,
        `   merged:  ${result.merged.length} file(s)`,
        `   skipped: ${result.skipped.length} file(s) (already existed)`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_add
// ---------------------------------------------------------------------------

const sceneAddSchema = z.object({
  name: z
    .string()
    .describe("Scene name. Slugified into the composition id (e.g. 'My Intro' → 'my-intro')."),
  preset: z
    .enum(SCENE_PRESETS)
    .optional()
    .describe("Style preset for the scene HTML. Default 'simple'."),
  narration: z
    .string()
    .optional()
    .describe(
      "Narration text. If the value is a path to an existing .txt/.md file, its contents are used. Drives TTS + scene duration."
    ),
  duration: z
    .number()
    .optional()
    .describe("Explicit scene duration in seconds. Overrides narration audio duration."),
  visuals: z
    .string()
    .optional()
    .describe("Image prompt — generates assets/scene-<id>.png via the configured image provider."),
  headline: z
    .string()
    .optional()
    .describe("Visible headline text. Defaults to the humanised scene name."),
  kicker: z
    .string()
    .optional()
    .describe("Small label above the headline (used by 'explainer' and 'product-shot' presets)."),
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
  insertInto: z
    .string()
    .optional()
    .describe("Root composition file (relative to projectDir). Default 'index.html'."),
  imageProvider: z
    .enum(["gemini", "openai"])
    .optional()
    .describe("Image provider for visuals. Default 'gemini'."),
  voice: z.string().optional().describe("ElevenLabs voice id or name."),
  skipAudio: z.boolean().optional().describe("Skip TTS even if narration is provided."),
  skipImage: z.boolean().optional().describe("Skip image generation even if visuals is provided."),
  force: z.boolean().optional().describe("Overwrite an existing compositions/scene-<id>.html."),
});

export const sceneAddTool = defineTool({
  name: "scene_add",
  category: "scene",
  cost: "low",
  title: "Add Scene from Preset",
  annotations: { readOnly: false, openWorld: true },
  description:
    "Add a single scene to an existing scene project. Optionally generates narration audio (ElevenLabs) and/or a backdrop image (Gemini/OpenAI), then emits compositions/scene-<id>.html with a paused GSAP timeline and splices a clip reference into the root index.html. Use skipAudio:true and skipImage:true for text-only scenes that need no API calls.",
  schema: sceneAddSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await executeSceneAdd({
      name: args.name,
      preset: (args.preset as ScenePreset | undefined) ?? "simple",
      narration: args.narration,
      duration: args.duration,
      visuals: args.visuals,
      headline: args.headline,
      kicker: args.kicker,
      projectDir,
      insertInto: args.insertInto,
      imageProvider: args.imageProvider,
      voice: args.voice,
      skipAudio: args.skipAudio,
      skipImage: args.skipImage,
      force: args.force,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "scene_add failed" };
    }
    const lines = [
      `✅ Added scene "${result.id}" (preset=${result.preset})`,
      `   start:    ${result.start.toFixed(2)}s`,
      `   duration: ${result.duration.toFixed(2)}s`,
      `   scene:    ${result.scenePath}`,
      `   root:     ${result.rootPath}`,
    ];
    if (result.audioPath) lines.push(`   audio:    ${result.audioPath}`);
    if (result.imagePath) lines.push(`   image:    ${result.imagePath}`);
    return {
      success: true,
      data: {
        id: result.id,
        preset: result.preset,
        start: result.start,
        duration: result.duration,
        scenePath: result.scenePath,
        rootPath: result.rootPath,
        audioPath: result.audioPath,
        imagePath: result.imagePath,
      },
      humanLines: lines,
    };
  },
});

// ---------------------------------------------------------------------------
// scene_lint
// ---------------------------------------------------------------------------

const sceneLintSchema = z.object({
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
  root: z
    .string()
    .optional()
    .describe("Root composition file relative to projectDir. Default 'index.html'."),
  fix: z
    .boolean()
    .optional()
    .describe('Apply mechanical auto-fixes (currently: missing class="clip").'),
});

function summariseLint(result: ProjectLintResult): Record<string, unknown> {
  return {
    ok: result.ok,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    infoCount: result.infoCount,
    files: result.files.map((f) => ({
      file: f.file,
      isSubComposition: f.isSubComposition,
      findings: f.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        fixHint: finding.fixHint,
        elementId: finding.elementId,
        selector: finding.selector,
      })),
    })),
    fixed: result.fixed,
  };
}

export const sceneLintTool = defineTool({
  name: "scene_lint",
  category: "scene",
  cost: "free",
  title: "Lint Scene Compositions",
  annotations: { readOnly: false, idempotent: true, openWorld: false },
  description:
    "Validate every scene file in a project against the public Hyperframes lint rules (in-process, no Chrome required). Returns errors, warnings, and info findings per file. Optional fix:true mechanically repairs `timed_element_missing_clip_class` only — other issues surface with fixHints.",
  schema: sceneLintSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await runProjectLint({
      projectDir,
      rootRel: args.root,
      fix: args.fix,
    });
    const lines: string[] = [
      `${result.ok ? "✅" : "❌"} Lint ${result.ok ? "clean" : "failed"} — ${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
    ];
    for (const file of result.files) {
      if (file.findings.length === 0) continue;
      lines.push(``, file.file);
      for (const f of file.findings) {
        lines.push(`  [${f.severity}] ${f.code} — ${f.message}`);
        if (f.fixHint) lines.push(`     → ${f.fixHint}`);
      }
    }
    return {
      success: result.ok,
      data: summariseLint(result),
      humanLines: lines,
      error: result.ok ? undefined : `${result.errorCount} lint error(s)`,
    };
  },
});

// ---------------------------------------------------------------------------
// scene_repair
// ---------------------------------------------------------------------------

const sceneRepairSchema = z.object({
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
  root: z
    .string()
    .optional()
    .describe("Root composition file relative to projectDir. Default 'index.html'."),
  dryRun: z.boolean().optional().describe("Preview deterministic repairs without writing files."),
});

export const sceneRepairTool = defineTool({
  name: "scene_repair",
  category: "scene",
  cost: "free",
  title: "Repair Scene Compositions",
  annotations: { readOnly: false, idempotent: true, openWorld: false },
  description:
    "Apply deterministic mechanical scene repairs. Currently uses the safe lint auto-fix allow-list and never performs semantic creative rewrites.",
  schema: sceneRepairSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await executeSceneRepair({
      projectDir,
      rootRel: args.root,
      dryRun: args.dryRun,
    });
    return {
      success: result.status !== "fail",
      data: result as unknown as Record<string, unknown>,
      error:
        result.status === "fail"
          ? `${result.remainingIssues.filter((issue) => issue.severity === "error").length} remaining scene repair error(s)`
          : undefined,
      humanLines: [
        `${result.status === "pass" ? "✅" : result.status === "warn" ? "⚠️" : "❌"} Scene repair ${result.status}`,
        `fixed: ${result.fixed.length}; wouldFix: ${result.wouldFix.length}; remaining: ${result.remainingIssues.length}`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

const sceneRenderSchema = z.object({
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
  root: z
    .string()
    .optional()
    .describe("Root composition file relative to projectDir. Default 'index.html'."),
  beat: z.string().optional().describe("Render only one storyboard beat using a temporary root."),
  output: z
    .string()
    .optional()
    .describe("Output file path (relative paths resolve against projectDir)."),
  fps: z.number().optional().describe("Frames per second. Must be 24, 30, or 60. Default 30."),
  quality: z
    .enum(["draft", "standard", "high"])
    .optional()
    .describe("Quality preset. Default 'standard'."),
  format: z.enum(["mp4", "webm", "mov"]).optional().describe("Container format. Default 'mp4'."),
  workers: z.number().optional().describe("Capture worker count (1-16). Default 1."),
  openAfterRender: z
    .boolean()
    .optional()
    .describe("Open the rendered video in the OS default app after render. Default false."),
  revealInFinder: z
    .boolean()
    .optional()
    .describe("Reveal the rendered video in Finder/file manager after render. Default false."),
});

function mapRenderResultToToolResult(
  result: Awaited<ReturnType<typeof executeSceneRender>>,
  projectDir: string
): ToolExecuteResult {
  if (!result.success) {
    return { success: false, error: result.error ?? "render failed" };
  }
  return {
    success: true,
    data: {
      outputPath: result.outputPath,
      absoluteOutputPath: result.absoluteOutputPath,
      openCommand: result.openCommand,
      revealCommand: result.revealCommand,
      opened: result.opened,
      revealed: result.revealed,
      openError: result.openError,
      revealError: result.revealError,
      beat: result.beat,
      root: result.root,
      reportPath: result.reportPath,
      durationMs: result.durationMs,
      framesRendered: result.framesRendered,
      totalFrames: result.totalFrames,
      fps: result.fps,
      quality: result.quality,
      format: result.format,
      audioCount: result.audioCount,
      audioMuxApplied: result.audioMuxApplied,
      audioMuxWarning: result.audioMuxWarning,
      ...(result.autoSyncApplied ? { autoSyncApplied: true } : {}),
      ...(result.autoSyncWarning ? { autoSyncWarning: result.autoSyncWarning } : {}),
    },
    humanLines: [
      `✅ Render complete: ${result.absoluteOutputPath ?? result.outputPath}`,
      ...(result.autoSyncApplied
        ? [`   auto-sync: narration-synced durations were re-applied before render`]
        : []),
      `   duration: ${((result.durationMs ?? 0) / 1000).toFixed(1)}s`,
      `   frames:   ${result.framesRendered ?? "?"}${result.totalFrames ? ` / ${result.totalFrames}` : ""}`,
      `   config:   ${result.fps}fps · ${result.quality} · ${result.format}`,
      `   audio:    ${result.audioCount && result.audioCount > 0 ? `${result.audioCount} track${result.audioCount === 1 ? "" : "s"} muxed` : "silent"}`,
      ...(result.openCommand ? [`   open:     ${result.openCommand}`] : []),
      ...(result.revealCommand ? [`   reveal:   ${result.revealCommand}`] : []),
      `   inspect:  vibe inspect render ${projectDir} --cheap --json`,
      ...(result.opened ? [`   opened:   yes`] : []),
      ...(result.revealed ? [`   revealed: yes`] : []),
      ...(result.openError ? [`   open warning: ${result.openError}`] : []),
      ...(result.revealError ? [`   reveal warning: ${result.revealError}`] : []),
    ],
  };
}

export const sceneRenderTool = defineTool({
  name: "render",
  category: "scene",
  cost: "free",
  title: "Render Video to MP4",
  annotations: { readOnly: false, openWorld: false },
  description:
    "Render a scene project to MP4/WebM/MOV via the Hyperframes producer. Requires Chrome installed locally. Output defaults to renders/<projectName>-<isoStamp>.<format>. Long runs: over MCP, calls exceeding ~45s return immediately with { promoted: true, jobId, status: 'running' } — poll status_job every 15-30s until completed/failed instead of re-invoking render. Emits MCP progress notifications when the client supplies a progressToken.",
  schema: sceneRenderSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const runRender = (report: (update: LocalJobUpdate) => void) =>
      executeSceneRender({
        projectDir,
        root: args.root,
        beatId: args.beat,
        output: args.output,
        fps: args.fps as RenderFps | undefined,
        quality: args.quality as RenderQuality | undefined,
        format: args.format as RenderFormat | undefined,
        workers: args.workers,
        openAfterRender: args.openAfterRender,
        revealInFinder: args.revealInFinder,
        onProgress: (pct, stage) => {
          const progress = Math.round(pct * 100);
          ctx.onProgress?.({ progress, total: 100, message: stage });
          report({ progress, stage: "render", message: stage });
        },
      }).then((result) => mapRenderResultToToolResult(result, projectDir));
    if (ctx.surface !== "mcp") {
      return runRender(() => undefined);
    }
    return runWithMcpPromotion(runRender, {
      jobType: "render",
      projectDir,
      command: `vibe render ${projectDir}`,
    });
  },
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

const sceneBuildSchema = z.object({
  projectDir: z
    .string()
    .optional()
    .describe(
      "Project directory containing STORYBOARD.md, DESIGN.md, index.html. Defaults to the surface's cwd; in MCP hosts, relative paths resolve under the configured server workspace."
    ),
  stage: z
    .enum(["assets", "compose", "sync", "render", "all"])
    .optional()
    .describe("Build stage to run. Default all."),
  beat: z.string().optional().describe("Restrict asset/compose work to one beat id."),
  mode: z
    .enum(["agent", "batch", "auto"])
    .optional()
    .describe(
      "Build mode dispatch [Plan H — Phase 3]. 'agent' = the calling host agent authors per-beat HTML itself (no internal LLM call); on missing compositions/scene-*.html files, returns a needs-author plan with prompts for the agent to consume. 'batch' = current internal-LLM compose path (Claude/OpenAI/Gemini). 'auto' (default) = agent if any agent host is detected, else batch. Override via VIBE_BUILD_MODE env var."
    ),
  effort: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Compose effort tier (batch mode only) passed to compose-scenes-with-skills. Default 'medium'."
    ),
  composer: z
    .enum(["claude", "openai", "gemini"])
    .optional()
    .describe(
      "LLM provider that composes the per-beat scene HTML in batch mode. Default: auto-resolve from available API keys (ANTHROPIC_API_KEY > GOOGLE_API_KEY > OPENAI_API_KEY). All three pass first-shot lint per the v0.70 spike; Claude is fastest, Gemini cheapest. Ignored in agent mode."
    ),
  skipNarration: z
    .boolean()
    .optional()
    .describe("Skip TTS for every beat (use existing audio assets if present)."),
  skipBackdrop: z
    .boolean()
    .optional()
    .describe("Skip image generation for every beat (use existing PNG assets if present)."),
  skipVideo: z
    .boolean()
    .optional()
    .describe("Skip video generation for every beat (use existing MP4 assets if present)."),
  skipMusic: z
    .boolean()
    .optional()
    .describe("Skip music generation for every beat (use existing audio assets if present)."),
  skipRender: z
    .boolean()
    .optional()
    .describe("Stop after compose — produces compositions/*.html but no final MP4."),
  ttsProvider: z
    .enum(["auto", "elevenlabs", "kokoro"])
    .optional()
    .describe("TTS provider override. Default 'auto'."),
  voice: z.string().optional().describe("TTS voice id (provider-specific)."),
  imageProvider: z
    .enum(["openai"])
    .optional()
    .describe("Image provider for backdrops. Default 'openai' (gpt-image-2)."),
  videoProvider: z
    .enum(["seedance", "grok", "kling", "runway", "veo"])
    .optional()
    .describe("Video provider for per-beat video cues. Default seedance."),
  musicProvider: z
    .enum(["elevenlabs", "replicate"])
    .optional()
    .describe("Music provider for per-beat music cues. Default elevenlabs."),
  imageQuality: z
    .enum(["standard", "hd"])
    .optional()
    .describe("OpenAI image quality. Default 'standard'."),
  imageSize: z
    .enum(["1024x1024", "1536x1024", "1024x1536"])
    .optional()
    .describe("OpenAI image size. Default '1536x1024' (cinematic 16:9-ish)."),
  maxCostUsd: z
    .number()
    .optional()
    .describe("Fail before provider spend when estimated cost exceeds this USD cap."),
  force: z.boolean().optional().describe("Re-dispatch primitives even when cached assets exist."),
});

function mapBuildResultToToolResult(
  result: Awaited<ReturnType<typeof executeSceneBuild>>
): ToolExecuteResult {
  if (!result.success) {
    return {
      success: false,
      data: result as unknown as Record<string, unknown>,
      error: result.error ?? "build failed",
      humanLines: [
        result.code
          ? `${result.code}: ${result.error ?? "build failed"}`
          : (result.error ?? "build failed"),
        ...(result.retryWith?.length ? [`Retry: ${result.retryWith.join(" | ")}`] : []),
      ],
    };
  }
  return {
    success: true,
    data: {
      phase: result.phase,
      mode: result.mode,
      selectedStage: result.selectedStage,
      outputPath: result.outputPath,
      reportPath: result.reportPath,
      estimatedCostUsd: result.estimatedCostUsd,
      costUsd: result.costUsd,
      stageReports: result.stageReports,
      sceneRepair: result.sceneRepair,
      jobs: result.jobs,
      beats: result.beats.map((b) => ({
        beatId: b.beatId,
        narrationStatus: b.narrationStatus,
        narrationPath: b.narrationPath,
        narrationError: b.narrationError,
        backdropStatus: b.backdropStatus,
        backdropPath: b.backdropPath,
        backdropError: b.backdropError,
        videoStatus: b.videoStatus,
        videoPath: b.videoPath,
        videoJobId: b.videoJobId,
        videoError: b.videoError,
        musicStatus: b.musicStatus,
        musicPath: b.musicPath,
        musicJobId: b.musicJobId,
        musicError: b.musicError,
      })),
      composePrompts: result.composePrompts,
      totalLatencyMs: result.totalLatencyMs,
    },
    humanLines: [
      result.phase === "needs-author"
        ? `Agent mode — ${result.composePrompts?.beats.filter((b) => !b.exists).length ?? 0} beat(s) need to be authored by the host agent. See data.composePrompts for the plan. If you cannot write files (e.g. Claude Desktop), author each beat's HTML and submit it with scene_submit.`
        : result.phase === "pending-jobs"
          ? `Build paused for ${result.jobs?.length ?? 0} async job(s). Poll with status_project/status_job, then rerun build.`
          : `Scene build complete${result.outputPath ? ` — ${result.outputPath}` : " (skipRender)"}`,
      `   beats: ${result.beats.length}`,
      `   wall-clock: ${(result.totalLatencyMs / 1000).toFixed(1)}s`,
      ...result.beats.map(
        (b) =>
          `   [${b.beatId}] narration=${b.narrationStatus} backdrop=${b.backdropStatus} video=${b.videoStatus} music=${b.musicStatus}`
      ),
    ],
  };
}

function buildEventToUpdate(event: SceneBuildProgressEvent): LocalJobUpdate {
  if (event.type === "phase-start") {
    return { stage: event.phase, message: `${event.phase} started` };
  }
  if (event.type === "render-start") return { stage: "render", message: "render started" };
  if (event.type === "render-done") return { stage: "render", message: "render done" };
  const beatId = "beatId" in event ? event.beatId : undefined;
  return { message: beatId ? `${event.type} ${beatId}` : event.type };
}

export const sceneBuildTool = defineTool({
  name: "build",
  category: "scene",
  cost: "high",
  title: "Build Video from Storyboard",
  annotations: { readOnly: false, openWorld: true },
  description:
    "v0.60 one-shot orchestrator: read STORYBOARD.md per-beat YAML cues (narration / backdrop / duration), dispatch TTS + image generation per beat, compose scene HTML via the compose-scenes-with-skills pipeline, then render to MP4. Use this instead of chaining init + scene_add + render manually. Caches by SHA256 of (DESIGN.md + cue body) so re-runs are idempotent and cheap. Long runs: over MCP, calls exceeding ~45s return immediately with { promoted: true, jobId, status: 'running' } — poll status_job every 15-30s until completed/failed instead of re-invoking build. Emits MCP progress notifications when the client supplies a progressToken. When the MCP host supports elicitation, unspecified asset choices (narration provider, backdrop images, cost cap) are confirmed with the user via a form before the build starts.",
  schema: sceneBuildSchema,
  async execute(args, ctx) {
    let warnings: string[] | undefined;
    if (ctx.surface === "mcp" && ctx.elicit) {
      const form = planBuildElicitation(args);
      if (form) {
        // Errors and timeouts fall back to today's defaults so a flaky or
        // headless client can never brick a build; an explicit decline or
        // cancel aborts before any provider spend.
        const outcome = await ctx.elicit(form).catch(() => null);
        if (outcome === null) {
          warnings = ["Asset-choice elicitation failed or timed out; proceeding with defaults."];
        } else if (outcome.action === "accept") {
          args = applyElicitationAnswers(args, outcome.content);
        } else {
          return {
            success: false,
            error: "Build cancelled — the user declined the asset choices.",
            data: {
              cancelled: true,
              retryWith: [
                `build { projectDir: "${args.projectDir ?? "."}", ttsProvider: "kokoro", skipBackdrop: true }`,
              ],
            },
          };
        }
      }
    }
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const runBuild = (report: (update: LocalJobUpdate) => void) =>
      executeSceneBuild({
        projectDir,
        stage: args.stage,
        beatId: args.beat,
        mode: args.mode,
        effort: args.effort,
        composer: args.composer,
        skipNarration: args.skipNarration,
        skipBackdrop: args.skipBackdrop,
        skipVideo: args.skipVideo,
        skipMusic: args.skipMusic,
        skipRender: args.skipRender,
        ttsProvider: args.ttsProvider,
        voice: args.voice,
        imageProvider: args.imageProvider,
        videoProvider: args.videoProvider,
        musicProvider: args.musicProvider,
        imageQuality: args.imageQuality,
        imageSize: args.imageSize,
        maxCostUsd: args.maxCostUsd,
        force: args.force,
        onProgress: (event) => {
          const update = buildEventToUpdate(event);
          ctx.onProgress?.({ message: update.message ?? update.stage });
          report(update);
        },
      })
        .then(mapBuildResultToToolResult)
        .then((result) =>
          warnings === undefined
            ? result
            : { ...result, data: { ...result.data, elicitationWarnings: warnings } }
        );
    if (ctx.surface !== "mcp") {
      return runBuild(() => undefined);
    }
    return runWithMcpPromotion(runBuild, {
      jobType: "build",
      projectDir,
      command: `vibe build ${projectDir}`,
    });
  },
});

// ---------------------------------------------------------------------------
// scene_install_skill — Phase H1 agentic-CLI primitive
// ---------------------------------------------------------------------------

const sceneInstallSkillSchema = z.object({
  projectDir: z
    .string()
    .describe(
      "Project directory containing STORYBOARD.md / DESIGN.md. Required to keep cross-host calls explicit; in MCP hosts, relative paths resolve under the configured server workspace."
    ),
  host: z
    .enum(["claude-code", "cursor", "auto", "all"])
    .optional()
    .describe(
      "Host layout target. 'auto' (default) detects installed agent hosts; 'all' writes every layout; 'claude-code' / 'cursor' force a single host. Codex / Aider read the universal SKILL.md via AGENTS.md so don't need a host-specific layout."
    ),
  force: z
    .boolean()
    .optional()
    .describe(
      "Overwrite existing skill files. Default: skip-on-exist (preserves user customisations)."
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe("Report which files would be written without writing them."),
});

export const sceneInstallSkillTool = defineTool({
  name: "scene_install_skill",
  category: "scene",
  cost: "free",
  title: "Install Hyperframes Skill",
  annotations: { readOnly: false, idempotent: true, openWorld: false },
  description:
    "Install the vendored Hyperframes skill bundle into a scene project so the host agent (Claude Code, Cursor, Codex, Aider) can read framework rules + house style directly. Writes a universal SKILL.md + references/ at the project root, plus per-host layouts (.claude/skills/hyperframes/ for Claude Code, .cursor/rules/hyperframes.mdc for Cursor) when those hosts are detected. Phase H1 of the agentic-native composer plan — once installed, the host agent itself can author scene HTML using the rules instead of relying on vibe's internal LLM call.",
  schema: sceneInstallSkillSchema,
  async execute(args, ctx) {
    const projectDir = resolve(ctx.workingDirectory, args.projectDir);

    const hostFlag = args.host ?? "auto";
    const hosts: InstallSkillHost[] = (() => {
      if (hostFlag === "all") return ["all"];
      if (hostFlag === "auto") {
        return deriveInstallHosts(detectedAgentHosts().map((h) => h.id));
      }
      return [hostFlag];
    })();

    const result = await installHyperframesSkill({
      projectDir,
      hosts,
      force: args.force ?? false,
      dryRun: args.dryRun ?? false,
    });

    return {
      success: true,
      data: {
        projectDir: relative(ctx.workingDirectory, projectDir) || ".",
        host: hostFlag,
        resolvedHosts: hosts,
        bundleVersion: result.bundleVersion,
        files: result.files,
        dryRun: args.dryRun ?? false,
      },
      humanLines: [
        `Installed Hyperframes skill (${result.bundleVersion}) — ${result.files.filter((f) => f.status === "wrote" || f.status === "would-write").length} file(s) ${args.dryRun ? "would be written" : "written"}.`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_compose_prompts — Phase H2 agentic primitive
// ---------------------------------------------------------------------------

const sceneComposePromptsSchema = z.object({
  projectDir: z
    .string()
    .describe(
      "Project directory containing STORYBOARD.md / DESIGN.md. Required to keep cross-host calls explicit; in MCP hosts, relative paths resolve under the configured server workspace."
    ),
  beat: z
    .string()
    .optional()
    .describe(
      "Restrict the plan to a single beat by id (e.g. 'hook', '1'). Omit to emit every beat in the storyboard."
    ),
});

export const sceneComposePromptsTool = defineTool({
  name: "scene_compose_prompts",
  category: "scene",
  cost: "free",
  title: "Get Scene Authoring Prompts",
  annotations: { readOnly: true, openWorld: false },
  description:
    "Emit the per-beat compose plan for the host agent to author scene HTML itself. Reads STORYBOARD.md + DESIGN.md and returns each beat's outputPath + userPrompt + cues + body, plus references to the project's SKILL.md (Hyperframes rules) and DESIGN.md (visual identity). The host agent writes each compositions/scene-<id>.html file directly — VibeFrame makes NO LLM call here. Hosts that cannot write files (e.g. Claude Desktop) submit each authored beat with scene_submit instead. Pairs with scene_install_skill (Phase H1). Phase H2 of the agentic-native composer plan; the internal-LLM batch path (build) remains as a fallback for non-agent contexts.",
  schema: sceneComposePromptsSchema,
  async execute(args, ctx) {
    const projectDir = resolve(ctx.workingDirectory, args.projectDir);
    const result = await getComposePrompts({
      projectDir,
      beatId: args.beat,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "compose-prompts failed" };
    }
    return {
      success: true,
      data: {
        projectDir: relative(ctx.workingDirectory, result.projectDir) || ".",
        designReference: result.designReference,
        storyboardReference: result.storyboardReference,
        skillReference: result.skillReference,
        compositionsDir: result.compositionsDir,
        beats: result.beats,
        instructions: result.instructions,
        bundleVersion: result.bundleVersion,
        warnings: result.warnings,
      },
      humanLines: [
        `Compose plan ready: ${result.beats.length} beat(s)${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ""}.`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_submit — agent-mode compose for hosts that cannot write files
// ---------------------------------------------------------------------------

const sceneSubmitSchema = z.object({
  projectDir: z.string().optional().describe(PROJECT_DIR_DESCRIPTION),
  beat: z.string().describe("Beat id from STORYBOARD.md (e.g. 'hook')."),
  html: z
    .string()
    .describe(
      "The complete scene HTML for this beat — a bare <template id=\"scene-<id>-template\"> fragment exactly as described by the beat's compose prompt. A ```html fence around it is accepted."
    ),
  validateOnly: z
    .boolean()
    .optional()
    .describe("Lint the HTML without writing the file. Default false."),
});

export const sceneSubmitTool = defineTool({
  name: "scene_submit",
  category: "scene",
  cost: "free",
  title: "Submit Scene HTML",
  annotations: { readOnly: false, idempotent: true, openWorld: false },
  description:
    "Submit host-authored Hyperframes scene HTML for one beat. Validates with the same lint as the batch composer and writes compositions/scene-<id>.html on pass; on lint errors it returns the findings WITHOUT writing so you can fix and resubmit. This completes agent-mode compose for hosts that cannot write files (e.g. Claude Desktop): build (mode agent) → needs-author plan → author each beat from its composePrompts userPrompt → scene_submit per beat → build (stage sync) → render. No internal LLM call — the submitting agent is the composer.",
  schema: sceneSubmitSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await executeSceneSubmit({
      projectDir,
      beatId: args.beat,
      html: args.html,
      validateOnly: args.validateOnly,
    });
    return {
      success: result.success,
      data: result as unknown as Record<string, unknown>,
      error: result.success ? undefined : (result.error ?? "scene submit failed"),
      humanLines: [
        result.success
          ? `${result.written ? "✅ Scene written" : "✅ Scene valid (not written)"}: ${result.scenePath}`
          : `❌ Scene submit failed: ${result.error}`,
        `   lint: ${result.lint.errorCount} error(s), ${result.lint.warningCount} warning(s)` +
          (result.mechanicalFixes.length > 0
            ? `; auto-fixed: ${result.mechanicalFixes.join(", ")}`
            : ""),
        ...result.warnings.map((w) => `   ⚠️ ${w}`),
      ],
    };
  },
});

/** All scene-category manifest entries (type-erased for heterogeneous aggregation). */
export const sceneTools: readonly AnyTool[] = [
  sceneInitTool as unknown as AnyTool,
  sceneAddTool as unknown as AnyTool,
  sceneLintTool as unknown as AnyTool,
  sceneRepairTool as unknown as AnyTool,
  sceneRenderTool as unknown as AnyTool,
  sceneBuildTool as unknown as AnyTool,
  sceneStylesTool as unknown as AnyTool,
  sceneInstallSkillTool as unknown as AnyTool,
  sceneComposePromptsTool as unknown as AnyTool,
  sceneSubmitTool as unknown as AnyTool,
];
