/**
 * @module scene
 * @description Agent tools for the per-scene HTML authoring surface
 * (`vibe scene init/add/lint/render`). Each tool wraps the corresponding
 * `executeXxx` from `commands/scene.ts` (or `_shared/scene-*.ts`) so the LLM
 * agent can author and ship Hyperframes-style scene projects in natural
 * language. Mirrored as MCP tools in `packages/mcp-server/src/tools/scene.ts`.
 *
 * ## Tools: scene_init, scene_add, scene_lint, scene_render
 * ## Cost tier: Low (image+TTS for `scene_add` if narration/visuals supplied,
 *                   otherwise free; `scene_render` is local Chrome/FFmpeg).
 */

import { resolve, relative } from "node:path";
import type { ToolRegistry, ToolHandler } from "./index.js";
import type { ToolDefinition, ToolResult } from "../types.js";
import {
  scaffoldSceneProject,
  type SceneAspect,
} from "../../commands/_shared/scene-project.js";
import {
  executeSceneAdd,
  type SceneAddResult,
} from "../../commands/scene.js";
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
import {
  listVisualStyles,
  getVisualStyle,
} from "../../commands/_shared/visual-styles.js";
import type { ScenePreset } from "../../commands/_shared/scene-html-emit.js";

const SCENE_PRESETS = [
  "simple",
  "announcement",
  "explainer",
  "kinetic-type",
  "product-shot",
] as const;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const sceneInitDef: ToolDefinition = {
  name: "scene_init",
  description:
    "Scaffold a new bilingual VibeFrame + Hyperframes scene project. Creates index.html, hyperframes.json, vibe.project.yaml, compositions/, assets/, .gitignore, and a project-local CLAUDE.md. Idempotent: safe to run on a directory that already has hyperframes.json (the config is merged, not overwritten). No API keys required.",
  parameters: {
    type: "object",
    properties: {
      dir:      { type: "string",  description: "Project directory (created if missing). Relative paths resolve against the agent's working directory." },
      name:     { type: "string",  description: "Project name. Defaults to the directory basename." },
      aspect:   { type: "string",  description: "Aspect ratio for the canvas. Default 16:9.", enum: ["16:9", "9:16", "1:1", "4:5"] },
      duration: { type: "number",  description: "Default root composition duration in seconds. Default 10." },
    },
    required: ["dir"],
  },
};

const sceneAddDef: ToolDefinition = {
  name: "scene_add",
  description:
    "Add a single scene to an existing scene project. Optionally generates narration audio (ElevenLabs) and/or a backdrop image (Gemini/OpenAI), then emits compositions/scene-<id>.html with a paused GSAP timeline and splices a clip reference into the root index.html. Use `skipAudio: true` and `skipImage: true` for text-only scenes that need no API calls.",
  parameters: {
    type: "object",
    properties: {
      name:          { type: "string",  description: "Scene name. Slugified into the composition id (e.g. 'My Intro' → 'my-intro')." },
      preset:        { type: "string",  description: `Style preset for the scene HTML. Default 'simple'.`, enum: [...SCENE_PRESETS] },
      narration:     { type: "string",  description: "Narration text. If the value is a path to an existing .txt/.md file, its contents are used. Drives TTS + scene duration." },
      duration:      { type: "number",  description: "Explicit scene duration in seconds. Overrides narration audio duration." },
      visuals:       { type: "string",  description: "Image prompt — generates assets/scene-<id>.png via the configured image provider." },
      headline:      { type: "string",  description: "Visible headline text. Defaults to the humanised scene name." },
      kicker:        { type: "string",  description: "Small label above the headline (used by 'explainer' and 'product-shot' presets)." },
      projectDir:    { type: "string",  description: "Project directory. Defaults to the agent's working directory." },
      insertInto:    { type: "string",  description: "Root composition file (relative to projectDir). Default 'index.html'." },
      imageProvider: { type: "string",  description: "Image provider for --visuals. Default 'gemini'.", enum: ["gemini", "openai"] },
      voice:         { type: "string",  description: "ElevenLabs voice id or name." },
      skipAudio:     { type: "boolean", description: "Skip TTS even if narration is provided. Useful for offline / agent dry runs." },
      skipImage:     { type: "boolean", description: "Skip image generation even if visuals is provided." },
      force:         { type: "boolean", description: "Overwrite an existing compositions/scene-<id>.html." },
    },
    required: ["name"],
  },
};

const sceneLintDef: ToolDefinition = {
  name: "scene_lint",
  description:
    "Validate every scene file in a project against the public Hyperframes lint rules (in-process, no Chrome required). Returns errors, warnings, and info findings per file. Optional `fix: true` mechanically repairs `timed_element_missing_clip_class` only — other issues surface with fixHints for the agent to apply.",
  parameters: {
    type: "object",
    properties: {
      projectDir: { type: "string",  description: "Project directory. Defaults to the agent's working directory." },
      root:       { type: "string",  description: "Root composition file relative to projectDir. Default 'index.html'." },
      fix:        { type: "boolean", description: "Apply mechanical auto-fixes (currently: missing class=\"clip\")." },
    },
    required: [],
  },
};

const sceneRenderDef: ToolDefinition = {
  name: "scene_render",
  description:
    "Render a scene project to MP4/WebM/MOV via the Hyperframes producer. Requires Chrome installed locally. Output defaults to renders/<projectName>-<isoStamp>.<format>. Costly only in CPU/GPU (no API keys).",
  parameters: {
    type: "object",
    properties: {
      projectDir: { type: "string",  description: "Project directory. Defaults to the agent's working directory." },
      root:       { type: "string",  description: "Root composition file relative to projectDir. Default 'index.html'." },
      output:     { type: "string",  description: "Output file path (relative paths resolve against projectDir)." },
      fps:        { type: "number",  description: "Frames per second. Must be 24, 30, or 60. Default 30." },
      quality:    { type: "string",  description: "Quality preset. Default 'standard'.", enum: ["draft", "standard", "high"] },
      format:     { type: "string",  description: "Container format. Default 'mp4'.", enum: ["mp4", "webm", "mov"] },
      workers:    { type: "number",  description: "Capture worker count (1-16). Default 1." },
    },
    required: [],
  },
};

const sceneBuildDef: ToolDefinition = {
  name: "scene_build",
  description:
    "v0.60 one-shot orchestrator: read STORYBOARD.md per-beat YAML cues (narration / backdrop / duration), dispatch TTS + image generation per beat, compose scene HTML via the compose-scenes-with-skills pipeline, then render to MP4. Use this instead of chaining scene_init + scene_add + scene_render manually. Caches by SHA256 of (DESIGN.md + cue body) so re-runs are idempotent and cheap.",
  parameters: {
    type: "object",
    properties: {
      projectDir:    { type: "string",  description: "Project directory containing STORYBOARD.md, DESIGN.md, index.html. Defaults to the agent's working directory." },
      effort:        { type: "string",  description: "Compose effort tier passed to compose-scenes-with-skills. Default 'medium'.", enum: ["low", "medium", "high"] },
      skipNarration: { type: "boolean", description: "Skip TTS for every beat (use existing audio assets if present)." },
      skipBackdrop:  { type: "boolean", description: "Skip image generation for every beat (use existing PNG assets if present)." },
      skipRender:    { type: "boolean", description: "Stop after compose — produces compositions/*.html but no final MP4." },
      ttsProvider:   { type: "string",  description: "TTS provider override. Default 'auto'.", enum: ["auto", "elevenlabs", "kokoro"] },
      voice:         { type: "string",  description: "TTS voice id (provider-specific)." },
      imageProvider: { type: "string",  description: "Image provider for backdrops. Default 'openai' (gpt-image-2).", enum: ["openai"] },
      imageQuality:  { type: "string",  description: "OpenAI image quality. Default 'standard'.", enum: ["standard", "hd"] },
      imageSize:     { type: "string",  description: "OpenAI image size. Default '1536x1024' (cinematic 16:9-ish)." },
      force:         { type: "boolean", description: "Re-dispatch primitives even when cached assets exist." },
    },
    required: [],
  },
};

const sceneStylesDef: ToolDefinition = {
  name: "scene_styles",
  description:
    "List the 8 vendored visual identities available for `scene_init --visual-style` (Swiss Pulse, Data Drift, …) or, when `name` is provided, return the full DESIGN.md hard-gate body for one style. The DESIGN.md content is what the LLM uses as a non-negotiable visual rulebook during compose-scenes-with-skills.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Style name or slug (e.g. 'Swiss Pulse', 'swiss-pulse'). Omit to list all 8." },
    },
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const sceneInitHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const dir = resolve(context.workingDirectory, args.dir as string);
  try {
    const result = await scaffoldSceneProject({
      dir,
      name: args.name as string | undefined,
      aspect: args.aspect as SceneAspect | undefined,
      duration: args.duration as number | undefined,
    });
    const lines: string[] = [
      `✅ Scene project scaffolded at ${relative(context.workingDirectory, dir) || dir}`,
      `   created: ${result.created.length} file(s)`,
      `   merged:  ${result.merged.length} file(s)`,
      `   skipped: ${result.skipped.length} file(s) (already existed)`,
      ``,
      `Next: scene_add { name: "intro", preset: "announcement", headline: "..." }`,
    ];
    return { toolCallId: "", success: true, output: lines.join("\n") };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `scene_init failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const sceneAddHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectDir = args.projectDir
    ? resolve(context.workingDirectory, args.projectDir as string)
    : context.workingDirectory;

  const result: SceneAddResult = await executeSceneAdd({
    name: args.name as string,
    preset: (args.preset as ScenePreset | undefined) ?? "simple",
    narration: args.narration as string | undefined,
    duration: args.duration as number | undefined,
    visuals: args.visuals as string | undefined,
    headline: args.headline as string | undefined,
    kicker: args.kicker as string | undefined,
    projectDir,
    insertInto: args.insertInto as string | undefined,
    imageProvider: args.imageProvider as string | undefined,
    voice: args.voice as string | undefined,
    skipAudio: args.skipAudio as boolean | undefined,
    skipImage: args.skipImage as boolean | undefined,
    force: args.force as boolean | undefined,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error ?? "scene_add failed",
    };
  }

  const lines: string[] = [
    `✅ Added scene "${result.id}" (preset=${result.preset})`,
    `   start:    ${result.start.toFixed(2)}s`,
    `   duration: ${result.duration.toFixed(2)}s`,
    `   scene:    ${result.scenePath}`,
    `   root:     ${result.rootPath}`,
  ];
  if (result.audioPath) lines.push(`   audio:    ${result.audioPath}`);
  if (result.imagePath) lines.push(`   image:    ${result.imagePath}`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

function summariseLint(result: ProjectLintResult): string[] {
  const lines: string[] = [
    `${result.ok ? "✅" : "❌"} Lint ${result.ok ? "clean" : "failed"} — ` +
      `${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
  ];
  for (const file of result.files) {
    if (file.findings.length === 0) continue;
    lines.push(``, `${file.file}`);
    for (const f of file.findings) {
      lines.push(`  [${f.severity}] ${f.code} — ${f.message}`);
      if (f.fixHint) lines.push(`     → ${f.fixHint}`);
    }
  }
  if (result.fixed.length > 0) {
    lines.push(``, `Auto-fixed:`);
    for (const fx of result.fixed) {
      lines.push(`  ${fx.file}: ${fx.codes.join(", ")}`);
    }
  }
  return lines;
}

const sceneLintHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectDir = args.projectDir
    ? resolve(context.workingDirectory, args.projectDir as string)
    : context.workingDirectory;
  try {
    const result = await runProjectLint({
      projectDir,
      rootRel: args.root as string | undefined,
      fix: args.fix as boolean | undefined,
    });
    return {
      toolCallId: "",
      success: result.ok,
      output: summariseLint(result).join("\n"),
      error: result.ok ? undefined : `${result.errorCount} lint error(s)`,
    };
  } catch (error) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: `scene_lint failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const sceneRenderHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectDir = args.projectDir
    ? resolve(context.workingDirectory, args.projectDir as string)
    : context.workingDirectory;

  const result = await executeSceneRender({
    projectDir,
    root: args.root as string | undefined,
    output: args.output as string | undefined,
    fps: args.fps as RenderFps | undefined,
    quality: args.quality as RenderQuality | undefined,
    format: args.format as RenderFormat | undefined,
    workers: args.workers as number | undefined,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error ?? "scene_render failed",
    };
  }

  const lines: string[] = [
    `✅ Render complete: ${result.outputPath}`,
    `   duration: ${(((result.durationMs ?? 0) / 1000)).toFixed(1)}s`,
    `   frames:   ${result.framesRendered ?? "?"}${result.totalFrames ? ` / ${result.totalFrames}` : ""}`,
    `   config:   ${result.fps}fps · ${result.quality} · ${result.format}`,
  ];
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

const sceneBuildHandler: ToolHandler = async (args, context): Promise<ToolResult> => {
  const projectDir = args.projectDir
    ? resolve(context.workingDirectory, args.projectDir as string)
    : context.workingDirectory;

  const result = await executeSceneBuild({
    projectDir,
    effort: args.effort as "low" | "medium" | "high" | undefined,
    skipNarration: args.skipNarration as boolean | undefined,
    skipBackdrop: args.skipBackdrop as boolean | undefined,
    skipRender: args.skipRender as boolean | undefined,
    ttsProvider: args.ttsProvider as "auto" | "elevenlabs" | "kokoro" | undefined,
    voice: args.voice as string | undefined,
    imageProvider: args.imageProvider as "openai" | undefined,
    imageQuality: args.imageQuality as "standard" | "hd" | undefined,
    imageSize: args.imageSize as
      | "1024x1024"
      | "1536x1024"
      | "1024x1536"
      | undefined,
    force: args.force as boolean | undefined,
  });

  if (!result.success) {
    return {
      toolCallId: "",
      success: false,
      output: "",
      error: result.error ?? "scene_build failed",
    };
  }

  const lines: string[] = [
    `✅ Scene build complete${result.outputPath ? ` — ${result.outputPath}` : " (skipRender)"}`,
    `   beats: ${result.beats.length}`,
    `   wall-clock: ${(result.totalLatencyMs / 1000).toFixed(1)}s`,
  ];
  for (const b of result.beats) {
    lines.push(
      `   [${b.beatId}] narration=${b.narrationStatus} backdrop=${b.backdropStatus}`,
    );
  }
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

const sceneStylesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  const query = args.name as string | undefined;
  if (query) {
    const style = getVisualStyle(query);
    if (!style) {
      return {
        toolCallId: "",
        success: false,
        output: "",
        error: `Unknown visual style "${query}". Run scene_styles with no name to list all 8.`,
      };
    }
    const lines: string[] = [
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
    ];
    return { toolCallId: "", success: true, output: lines.join("\n") };
  }

  const styles = listVisualStyles();
  const lines: string[] = [`📚 ${styles.length} vendored visual identities:`];
  for (const s of styles) {
    lines.push(`   • ${s.name} (${s.slug}) — ${s.mood}; best for ${s.bestFor}`);
  }
  lines.push(``, `Run scene_styles { name: "<slug>" } to fetch the full DESIGN.md hard-gate body for one style.`);
  return { toolCallId: "", success: true, output: lines.join("\n") };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

import { MIGRATED } from "../../tools/define-tool.js";

export function registerSceneTools(registry: ToolRegistry): void {
  // During the v0.65 migration each entry is registered only if the manifest
  // has not yet taken it over. After C6 (legacy collapse) this entire file
  // and function disappear.
  if (!MIGRATED.has(sceneInitDef.name))   registry.register(sceneInitDef, sceneInitHandler);
  if (!MIGRATED.has(sceneAddDef.name))    registry.register(sceneAddDef, sceneAddHandler);
  if (!MIGRATED.has(sceneLintDef.name))   registry.register(sceneLintDef, sceneLintHandler);
  if (!MIGRATED.has(sceneRenderDef.name)) registry.register(sceneRenderDef, sceneRenderHandler);
  if (!MIGRATED.has(sceneBuildDef.name))  registry.register(sceneBuildDef, sceneBuildHandler);
  if (!MIGRATED.has(sceneStylesDef.name)) registry.register(sceneStylesDef, sceneStylesHandler);
}

// Exported for tests so the same defs can be inspected without instantiating
// a registry.
export const sceneToolDefinitions: ReadonlyArray<ToolDefinition> = [
  sceneInitDef,
  sceneAddDef,
  sceneLintDef,
  sceneRenderDef,
  sceneBuildDef,
  sceneStylesDef,
];
