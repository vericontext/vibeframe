/**
 * @module manifest/scene
 * @description Scene authoring tools (scene_init/add/lint/render/build/styles).
 */

import { z } from "zod";
import { resolve, relative } from "node:path";
import { defineTool, type AnyTool } from "../define-tool.js";
import {
  listVisualStyles,
  getVisualStyle,
} from "../../commands/_shared/visual-styles.js";
import {
  scaffoldSceneProject,
  type SceneAspect,
} from "../../commands/_shared/scene-project.js";
import { executeSceneAdd } from "../../commands/scene.js";
import {
  runProjectLint,
  type ProjectLintResult,
} from "../../commands/_shared/scene-lint.js";
import {
  executeSceneRender,
  type RenderFps,
  type RenderQuality,
  type RenderFormat,
} from "../../commands/_shared/scene-render.js";
import { executeSceneBuild } from "../../commands/_shared/scene-build.js";
import type { ScenePreset } from "../../commands/_shared/scene-html-emit.js";
import {
  installHyperframesSkill,
  deriveInstallHosts,
  type InstallSkillHost,
} from "../../commands/_shared/install-skill.js";
import { detectedAgentHosts } from "../../utils/agent-host-detect.js";
import { getComposePrompts } from "../../commands/_shared/compose-prompts.js";

const SCENE_PRESETS = [
  "simple",
  "announcement",
  "explainer",
  "kinetic-type",
  "product-shot",
] as const;

const sceneStylesSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      "Style name or slug (e.g. 'Swiss Pulse', 'swiss-pulse'). Omit to list all 8.",
    ),
});

export const sceneStylesTool = defineTool({
  name: "scene_styles",
  category: "scene",
  cost: "free",
  description:
    "List the 8 vendored visual identities available for `scene_init --visual-style` (Swiss Pulse, Data Drift, …) or, when `name` is provided, return the full DESIGN.md hard-gate body for one style. The DESIGN.md content is what the LLM uses as a non-negotiable visual rulebook during compose-scenes-with-skills.",
  schema: sceneStylesSchema,
  async execute(args) {
    if (args.name) {
      const style = getVisualStyle(args.name);
      if (!style) {
        return {
          success: false,
          error: `Unknown visual style "${args.name}". Run scene_styles with no name to list all 8.`,
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
        ...styles.map(
          (s) => `   • ${s.name} (${s.slug}) — ${s.mood}; best for ${s.bestFor}`,
        ),
        ``,
        `Run scene_styles { name: "<slug>" } to fetch the full DESIGN.md hard-gate body for one style.`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_init
// ---------------------------------------------------------------------------

const sceneInitSchema = z.object({
  dir: z.string().describe("Project directory (created if missing)."),
  name: z.string().optional().describe("Project name. Defaults to the directory basename."),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional().describe("Aspect ratio. Default 16:9."),
  duration: z.number().optional().describe("Default root composition duration in seconds. Default 10."),
});

export const sceneInitTool = defineTool({
  name: "scene_init",
  category: "scene",
  cost: "free",
  description:
    "Scaffold a new bilingual VibeFrame + Hyperframes scene project. Creates index.html, hyperframes.json, vibe.project.yaml, compositions/, assets/, .gitignore, and a project-local CLAUDE.md. Idempotent: re-running on an existing Hyperframes project merges hyperframes.json instead of overwriting. No API keys required.",
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
  name: z.string().describe("Scene name. Slugified into the composition id (e.g. 'My Intro' → 'my-intro')."),
  preset: z.enum(SCENE_PRESETS).optional().describe("Style preset for the scene HTML. Default 'simple'."),
  narration: z.string().optional().describe("Narration text. If the value is a path to an existing .txt/.md file, its contents are used. Drives TTS + scene duration."),
  duration: z.number().optional().describe("Explicit scene duration in seconds. Overrides narration audio duration."),
  visuals: z.string().optional().describe("Image prompt — generates assets/scene-<id>.png via the configured image provider."),
  headline: z.string().optional().describe("Visible headline text. Defaults to the humanised scene name."),
  kicker: z.string().optional().describe("Small label above the headline (used by 'explainer' and 'product-shot' presets)."),
  projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
  insertInto: z.string().optional().describe("Root composition file (relative to projectDir). Default 'index.html'."),
  imageProvider: z.enum(["gemini", "openai"]).optional().describe("Image provider for visuals. Default 'gemini'."),
  voice: z.string().optional().describe("ElevenLabs voice id or name."),
  skipAudio: z.boolean().optional().describe("Skip TTS even if narration is provided."),
  skipImage: z.boolean().optional().describe("Skip image generation even if visuals is provided."),
  force: z.boolean().optional().describe("Overwrite an existing compositions/scene-<id>.html."),
});

export const sceneAddTool = defineTool({
  name: "scene_add",
  category: "scene",
  cost: "low",
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
  projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
  root: z.string().optional().describe("Root composition file relative to projectDir. Default 'index.html'."),
  fix: z.boolean().optional().describe("Apply mechanical auto-fixes (currently: missing class=\"clip\")."),
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
// scene_render
// ---------------------------------------------------------------------------

const sceneRenderSchema = z.object({
  projectDir: z.string().optional().describe("Project directory. Defaults to the surface's cwd."),
  root: z.string().optional().describe("Root composition file relative to projectDir. Default 'index.html'."),
  output: z.string().optional().describe("Output file path (relative paths resolve against projectDir)."),
  fps: z.number().optional().describe("Frames per second. Must be 24, 30, or 60. Default 30."),
  quality: z.enum(["draft", "standard", "high"]).optional().describe("Quality preset. Default 'standard'."),
  format: z.enum(["mp4", "webm", "mov"]).optional().describe("Container format. Default 'mp4'."),
  workers: z.number().optional().describe("Capture worker count (1-16). Default 1."),
});

export const sceneRenderTool = defineTool({
  name: "scene_render",
  category: "scene",
  cost: "free",
  description:
    "Render a scene project to MP4/WebM/MOV via the Hyperframes producer. Requires Chrome installed locally. Output defaults to renders/<projectName>-<isoStamp>.<format>.",
  schema: sceneRenderSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await executeSceneRender({
      projectDir,
      root: args.root,
      output: args.output,
      fps: args.fps as RenderFps | undefined,
      quality: args.quality as RenderQuality | undefined,
      format: args.format as RenderFormat | undefined,
      workers: args.workers,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "scene_render failed" };
    }
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        durationMs: result.durationMs,
        framesRendered: result.framesRendered,
        totalFrames: result.totalFrames,
        fps: result.fps,
        quality: result.quality,
        format: result.format,
      },
      humanLines: [
        `✅ Render complete: ${result.outputPath}`,
        `   duration: ${(((result.durationMs ?? 0) / 1000)).toFixed(1)}s`,
        `   frames:   ${result.framesRendered ?? "?"}${result.totalFrames ? ` / ${result.totalFrames}` : ""}`,
        `   config:   ${result.fps}fps · ${result.quality} · ${result.format}`,
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_build
// ---------------------------------------------------------------------------

const sceneBuildSchema = z.object({
  projectDir: z.string().optional().describe("Project directory containing STORYBOARD.md, DESIGN.md, index.html. Defaults to the surface's cwd."),
  effort: z.enum(["low", "medium", "high"]).optional().describe("Compose effort tier passed to compose-scenes-with-skills. Default 'medium'."),
  composer: z.enum(["claude", "openai", "gemini"]).optional().describe("LLM provider that composes the per-beat scene HTML. Default: auto-resolve from available API keys (ANTHROPIC_API_KEY > GOOGLE_API_KEY > OPENAI_API_KEY). All three pass first-shot lint per the v0.70 spike; Claude is fastest, Gemini cheapest."),
  skipNarration: z.boolean().optional().describe("Skip TTS for every beat (use existing audio assets if present)."),
  skipBackdrop: z.boolean().optional().describe("Skip image generation for every beat (use existing PNG assets if present)."),
  skipRender: z.boolean().optional().describe("Stop after compose — produces compositions/*.html but no final MP4."),
  ttsProvider: z.enum(["auto", "elevenlabs", "kokoro"]).optional().describe("TTS provider override. Default 'auto'."),
  voice: z.string().optional().describe("TTS voice id (provider-specific)."),
  imageProvider: z.enum(["openai"]).optional().describe("Image provider for backdrops. Default 'openai' (gpt-image-2)."),
  imageQuality: z.enum(["standard", "hd"]).optional().describe("OpenAI image quality. Default 'standard'."),
  imageSize: z.enum(["1024x1024", "1536x1024", "1024x1536"]).optional().describe("OpenAI image size. Default '1536x1024' (cinematic 16:9-ish)."),
  force: z.boolean().optional().describe("Re-dispatch primitives even when cached assets exist."),
});

export const sceneBuildTool = defineTool({
  name: "scene_build",
  category: "scene",
  cost: "high",
  description:
    "v0.60 one-shot orchestrator: read STORYBOARD.md per-beat YAML cues (narration / backdrop / duration), dispatch TTS + image generation per beat, compose scene HTML via the compose-scenes-with-skills pipeline, then render to MP4. Use this instead of chaining scene_init + scene_add + scene_render manually. Caches by SHA256 of (DESIGN.md + cue body) so re-runs are idempotent and cheap.",
  schema: sceneBuildSchema,
  async execute(args, ctx) {
    const projectDir = args.projectDir
      ? resolve(ctx.workingDirectory, args.projectDir)
      : ctx.workingDirectory;
    const result = await executeSceneBuild({
      projectDir,
      effort: args.effort,
      composer: args.composer,
      skipNarration: args.skipNarration,
      skipBackdrop: args.skipBackdrop,
      skipRender: args.skipRender,
      ttsProvider: args.ttsProvider,
      voice: args.voice,
      imageProvider: args.imageProvider,
      imageQuality: args.imageQuality,
      imageSize: args.imageSize,
      force: args.force,
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "scene_build failed" };
    }
    return {
      success: true,
      data: {
        outputPath: result.outputPath,
        beats: result.beats.map((b) => ({
          beatId: b.beatId,
          narrationStatus: b.narrationStatus,
          narrationPath: b.narrationPath,
          narrationError: b.narrationError,
          backdropStatus: b.backdropStatus,
          backdropPath: b.backdropPath,
          backdropError: b.backdropError,
        })),
        totalLatencyMs: result.totalLatencyMs,
      },
      humanLines: [
        `✅ Scene build complete${result.outputPath ? ` — ${result.outputPath}` : " (skipRender)"}`,
        `   beats: ${result.beats.length}`,
        `   wall-clock: ${(result.totalLatencyMs / 1000).toFixed(1)}s`,
        ...result.beats.map(
          (b) =>
            `   [${b.beatId}] narration=${b.narrationStatus} backdrop=${b.backdropStatus}`,
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// scene_install_skill — Phase H1 agentic-CLI primitive
// ---------------------------------------------------------------------------

const sceneInstallSkillSchema = z.object({
  projectDir: z.string().describe("Project directory containing STORYBOARD.md / DESIGN.md. Required to keep cross-host calls explicit and prevent accidental installs in unintended cwd."),
  host: z.enum(["claude-code", "cursor", "auto", "all"]).optional().describe("Host layout target. 'auto' (default) detects installed agent hosts; 'all' writes every layout; 'claude-code' / 'cursor' force a single host. Codex / Aider read the universal SKILL.md via AGENTS.md so don't need a host-specific layout."),
  force: z.boolean().optional().describe("Overwrite existing skill files. Default: skip-on-exist (preserves user customisations)."),
  dryRun: z.boolean().optional().describe("Report which files would be written without writing them."),
});

export const sceneInstallSkillTool = defineTool({
  name: "scene_install_skill",
  category: "scene",
  cost: "free",
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
  projectDir: z.string().describe("Project directory containing STORYBOARD.md / DESIGN.md. Required to keep cross-host calls explicit."),
  beat: z.string().optional().describe("Restrict the plan to a single beat by id (e.g. 'hook', '1'). Omit to emit every beat in the storyboard."),
});

export const sceneComposePromptsTool = defineTool({
  name: "scene_compose_prompts",
  category: "scene",
  cost: "free",
  description:
    "Emit the per-beat compose plan for the host agent to author scene HTML itself. Reads STORYBOARD.md + DESIGN.md and returns each beat's outputPath + userPrompt + cues + body, plus references to the project's SKILL.md (Hyperframes rules) and DESIGN.md (visual identity). The host agent writes each compositions/scene-<id>.html file directly — VibeFrame makes NO LLM call here. Pairs with scene_install_skill (Phase H1). Phase H2 of the agentic-native composer plan; the internal-LLM batch path (scene_build) remains as a fallback for non-agent contexts.",
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

/** All scene-category manifest entries (type-erased for heterogeneous aggregation). */
export const sceneTools: readonly AnyTool[] = [
  sceneInitTool as unknown as AnyTool,
  sceneAddTool as unknown as AnyTool,
  sceneLintTool as unknown as AnyTool,
  sceneRenderTool as unknown as AnyTool,
  sceneBuildTool as unknown as AnyTool,
  sceneStylesTool as unknown as AnyTool,
  sceneInstallSkillTool as unknown as AnyTool,
  sceneComposePromptsTool as unknown as AnyTool,
];
