/**
 * MCP tools for the per-scene HTML authoring surface. Mirrors the agent
 * tools in `packages/cli/src/agent/tools/scene.ts` so MCP hosts (Claude
 * Desktop, Cursor, etc.) get the same surface as the in-process agent.
 *
 * Tools: scene_init, scene_add, scene_lint, scene_render
 */

import { resolve } from "node:path";
import { scaffoldSceneProject } from "@vibeframe/cli/commands/_shared/scene-project";
import { runProjectLint, type ProjectLintResult } from "@vibeframe/cli/commands/_shared/scene-lint";
import { executeSceneRender } from "@vibeframe/cli/commands/_shared/scene-render";
import { executeSceneAdd } from "@vibeframe/cli/commands/scene";

const SCENE_PRESETS = ["simple", "announcement", "explainer", "kinetic-type", "product-shot"] as const;

export const sceneTools = [
  {
    name: "scene_init",
    description:
      "Scaffold a new bilingual VibeFrame + Hyperframes scene project. Creates index.html, hyperframes.json, vibe.project.yaml, compositions/, assets/, .gitignore, and a project-local CLAUDE.md. Idempotent: re-running on an existing Hyperframes project merges hyperframes.json instead of overwriting. No API keys required.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dir:      { type: "string",  description: "Project directory (created if missing)." },
        name:     { type: "string",  description: "Project name. Defaults to the directory basename." },
        aspect:   { type: "string",  enum: ["16:9", "9:16", "1:1", "4:5"], description: "Aspect ratio. Default 16:9." },
        duration: { type: "number",  description: "Default root composition duration in seconds. Default 10." },
      },
      required: ["dir"],
    },
  },
  {
    name: "scene_add",
    description:
      "Add a single scene to an existing scene project. Optionally generates narration audio (ElevenLabs) and/or a backdrop image (Gemini/OpenAI), then emits compositions/scene-<id>.html with a paused GSAP timeline and splices a clip reference into the root index.html. Use skipAudio:true and skipImage:true for text-only scenes that need no API calls.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name:          { type: "string",  description: "Scene name. Slugified into the composition id (e.g. 'My Intro' → 'my-intro')." },
        preset:        { type: "string",  enum: [...SCENE_PRESETS], description: "Style preset for the scene HTML. Default 'simple'." },
        narration:     { type: "string",  description: "Narration text. If the value is a path to an existing .txt/.md file, its contents are used. Drives TTS + scene duration." },
        duration:      { type: "number",  description: "Explicit scene duration in seconds. Overrides narration audio duration." },
        visuals:       { type: "string",  description: "Image prompt — generates assets/scene-<id>.png via the configured image provider." },
        headline:      { type: "string",  description: "Visible headline text. Defaults to the humanised scene name." },
        kicker:        { type: "string",  description: "Small label above the headline (used by 'explainer' and 'product-shot' presets)." },
        projectDir:    { type: "string",  description: "Project directory. Defaults to the MCP server's cwd." },
        insertInto:    { type: "string",  description: "Root composition file (relative to projectDir). Default 'index.html'." },
        imageProvider: { type: "string",  enum: ["gemini", "openai"], description: "Image provider for visuals. Default 'gemini'." },
        voice:         { type: "string",  description: "ElevenLabs voice id or name." },
        skipAudio:     { type: "boolean", description: "Skip TTS even if narration is provided." },
        skipImage:     { type: "boolean", description: "Skip image generation even if visuals is provided." },
        force:         { type: "boolean", description: "Overwrite an existing compositions/scene-<id>.html." },
      },
      required: ["name"],
    },
  },
  {
    name: "scene_lint",
    description:
      "Validate every scene file in a project against the public Hyperframes lint rules (in-process, no Chrome required). Returns errors, warnings, and info findings per file. Optional fix:true mechanically repairs `timed_element_missing_clip_class` only — other issues surface with fixHints.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectDir: { type: "string",  description: "Project directory. Defaults to the MCP server's cwd." },
        root:       { type: "string",  description: "Root composition file relative to projectDir. Default 'index.html'." },
        fix:        { type: "boolean", description: "Apply mechanical auto-fixes (currently: missing class=\"clip\")." },
      },
    },
  },
  {
    name: "scene_render",
    description:
      "Render a scene project to MP4/WebM/MOV via the Hyperframes producer. Requires Chrome installed locally. Output defaults to renders/<projectName>-<isoStamp>.<format>.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectDir: { type: "string",  description: "Project directory. Defaults to the MCP server's cwd." },
        root:       { type: "string",  description: "Root composition file relative to projectDir. Default 'index.html'." },
        output:     { type: "string",  description: "Output file path (relative paths resolve against projectDir)." },
        fps:        { type: "number",  enum: [24, 30, 60], description: "Frames per second. Default 30." },
        quality:    { type: "string",  enum: ["draft", "standard", "high"], description: "Quality preset. Default 'standard'." },
        format:     { type: "string",  enum: ["mp4", "webm", "mov"], description: "Container format. Default 'mp4'." },
        workers:    { type: "number",  description: "Capture worker count (1-16). Default 1." },
      },
    },
  },
];

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

export async function handleSceneToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "scene_init": {
      const dir = resolve(process.cwd(), args.dir as string);
      const result = await scaffoldSceneProject({
        dir,
        name: args.name as string | undefined,
        aspect: args.aspect as "16:9" | "9:16" | "1:1" | "4:5" | undefined,
        duration: args.duration as number | undefined,
      });
      return JSON.stringify({
        success: true,
        dir,
        created: result.created,
        merged: result.merged,
        skipped: result.skipped,
      });
    }

    case "scene_add": {
      const projectDir = args.projectDir
        ? resolve(process.cwd(), args.projectDir as string)
        : process.cwd();
      const result = await executeSceneAdd({
        name: args.name as string,
        preset: (args.preset as (typeof SCENE_PRESETS)[number] | undefined) ?? "simple",
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
      if (!result.success) return `scene_add failed: ${result.error}`;
      return JSON.stringify({
        success: true,
        id: result.id,
        preset: result.preset,
        start: result.start,
        duration: result.duration,
        scenePath: result.scenePath,
        rootPath: result.rootPath,
        audioPath: result.audioPath,
        imagePath: result.imagePath,
      });
    }

    case "scene_lint": {
      const projectDir = args.projectDir
        ? resolve(process.cwd(), args.projectDir as string)
        : process.cwd();
      const result = await runProjectLint({
        projectDir,
        rootRel: args.root as string | undefined,
        fix: args.fix as boolean | undefined,
      });
      return JSON.stringify(summariseLint(result));
    }

    case "scene_render": {
      const projectDir = args.projectDir
        ? resolve(process.cwd(), args.projectDir as string)
        : process.cwd();
      const result = await executeSceneRender({
        projectDir,
        root: args.root as string | undefined,
        output: args.output as string | undefined,
        fps: args.fps as 24 | 30 | 60 | undefined,
        quality: args.quality as "draft" | "standard" | "high" | undefined,
        format: args.format as "mp4" | "webm" | "mov" | undefined,
        workers: args.workers as number | undefined,
      });
      if (!result.success) return `scene_render failed: ${result.error}`;
      return JSON.stringify({
        success: true,
        outputPath: result.outputPath,
        durationMs: result.durationMs,
        framesRendered: result.framesRendered,
        totalFrames: result.totalFrames,
        fps: result.fps,
        quality: result.quality,
        format: result.format,
      });
    }

    default:
      throw new Error(`Unknown scene tool: ${name}`);
  }
}
