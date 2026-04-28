/**
 * @module scene
 *
 * `vibe scene <sub>` — author, lint, and render per-scene HTML projects that
 * target the Hyperframes render backend. A scene project is bilingual: it's
 * also a valid Hyperframes project (hyperframes.json + meta.json +
 * index.html + compositions/). Users and AI agents can hand-author rich per-
 * scene animation instead of relying on flat YAML steps or opaque MP4s.
 *
 * Subcommands land incrementally across MVP 1:
 *   - init      [C1] — scaffold project directory
 *   - add       [C2] — author one scene (template + assets)
 *   - lint      [C3] — in-process Hyperframes lint + --fix
 *   - render    [C4, this commit] — render scene project to MP4/WebM/MOV
 */

import { Command } from "commander";
import { basename, resolve, relative, dirname } from "node:path";
import { mkdir, readFile, writeFile, access, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { parse as yamlParse } from "yaml";
import {
  GeminiProvider,
  OpenAIImageProvider,
  WhisperProvider,
} from "@vibeframe/ai-providers";
import {
  resolveTtsProvider,
  TtsKeyMissingError,
  parseTtsProviderName,
  type TtsProviderName,
} from "./_shared/tts-resolve.js";
import {
  scaffoldSceneProject,
  aspectToDims,
  type SceneAspect,
  type VibeProjectConfig,
} from "./_shared/scene-project.js";
import {
  getVisualStyle,
  listVisualStyles,
  visualStyleNames,
  type VisualStyle,
} from "./_shared/visual-styles.js";
import {
  emitSceneHtml,
  insertClipIntoRoot,
  nextSceneStart,
  readRootDims,
  slugifySceneName,
  SCENE_PRESETS,
  SCENE_OVERLAP_SECONDS,
  type ScenePreset,
} from "./_shared/scene-html-emit.js";
import {
  runProjectLint,
  rootExists,
  type ProjectLintResult,
} from "./_shared/scene-lint.js";
import {
  executeSceneRender,
  type RenderFps,
  type RenderFormat,
  type RenderQuality,
} from "./_shared/scene-render.js";
import {
  executeSceneBuild,
  type SceneBuildProgressEvent,
} from "./_shared/scene-build.js";
import {
  exitWithError,
  generalError,
  usageError,
  outputResult,
  isJsonMode,
} from "./output.js";
import { getApiKey } from "../utils/api-key.js";
import { getAudioDuration } from "../utils/audio.js";
import { detectedAgentHosts } from "../utils/agent-host-detect.js";
import {
  installHyperframesSkill,
  deriveInstallHosts,
  type InstallSkillHost,
} from "./_shared/install-skill.js";
import { getComposePrompts } from "./_shared/compose-prompts.js";

const VALID_ASPECTS: SceneAspect[] = ["16:9", "9:16", "1:1", "4:5"];

function validateAspect(value: string): SceneAspect {
  if (!VALID_ASPECTS.includes(value as SceneAspect)) {
    exitWithError(usageError(`Invalid aspect ratio: ${value}`, `Valid: ${VALID_ASPECTS.join(", ")}`));
  }
  return value as SceneAspect;
}

function validateDuration(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0 || n > 3600) {
    exitWithError(usageError(`Invalid duration: ${value}`, "Duration must be a positive number of seconds (≤3600)"));
  }
  return n;
}

function validatePreset(value: string): ScenePreset {
  if (!SCENE_PRESETS.includes(value as ScenePreset)) {
    exitWithError(usageError(`Invalid style: ${value}`, `Valid: ${SCENE_PRESETS.join(", ")}`));
  }
  return value as ScenePreset;
}

function validateVisualStyle(value: string): VisualStyle {
  const found = getVisualStyle(value);
  if (!found) {
    exitWithError(
      usageError(
        `Unknown visual style: ${value}`,
        `Valid: ${visualStyleNames()}. Browse details with \`vibe scene styles\`.`,
      ),
    );
  }
  // exitWithError aborts; this branch is unreachable but typescript needs it.
  return found as VisualStyle;
}

export const sceneCommand = new Command("scene")
  .description("Author and render per-scene HTML compositions (Hyperframes backend)")
  .addHelpText("after", `
Examples:
  $ vibe scene init my-video                              # Scaffold a new project
  $ vibe scene init my-video -r 9:16 -d 30                # Vertical 30s project
  $ vibe scene add intro --style announcement \\
      --headline "Welcome to VibeFrame"                   # Headline-only scene
  $ vibe scene add overview --narration "VibeFrame turns scripts into video." \\
      --visuals "studio desk, soft lighting"              # AI narration + image
  $ vibe scene lint                                       # Validate every scene against Hyperframes rules
  $ vibe scene lint --fix                                 # Auto-fix mechanical issues (e.g. missing class="clip")
  $ vibe scene lint --json                                # Structured output for agent loops
  $ vibe scene render                                     # Render to renders/<name>-<timestamp>.mp4
  $ vibe scene render -o demo.mp4 --quality high          # Custom output path + quality
  $ vibe scene render --fps 60 --format webm              # 60fps WebM render

A scene project is bilingual: it works with both \`vibe\` and \`npx hyperframes\`.
Run 'vibe schema scene.<command>' for structured parameter info.`);

sceneCommand
  .command("init")
  .description("Scaffold a new scene project (or safely augment an existing Hyperframes project)")
  .argument("<dir>", "Project directory (created if it doesn't exist)")
  .option("-n, --name <name>", "Project name (defaults to directory basename)")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, 1:1, 4:5", "16:9")
  .option("-d, --duration <sec>", "Default root composition duration (seconds)", "10")
  .option("--visual-style <name>", `Seed DESIGN.md from a named style (browse via \`vibe scene styles\`). E.g. "Swiss Pulse"`)
  .option("--dry-run", "Preview parameters without writing files")
  .action(async (dir: string, options) => {
    const aspect = validateAspect(options.ratio);
    const duration = validateDuration(options.duration);
    const name = (options.name as string | undefined) ?? basename(dir.replace(/\/+$/, ""));
    const visualStyle = options.visualStyle
      ? validateVisualStyle(options.visualStyle as string)
      : undefined;

    if (options.dryRun) {
      outputResult({
        dryRun: true,
        command: "scene init",
        params: {
          dir,
          name,
          aspect,
          duration,
          visualStyle: visualStyle?.name ?? null,
        },
      });
      return;
    }

    const spinner = isJsonMode() ? null : ora(`Scaffolding scene project at ${dir}...`).start();
    try {
      const result = await scaffoldSceneProject({ dir, name, aspect, duration, visualStyle });

      // Phase H1: drop the Hyperframes skill into the project so the host
      // agent (Claude Code, Cursor, Codex, Aider, …) can read it directly.
      // This is what unlocks the agentic compose path — without skill
      // files in context, the agent can't reason about composition rules.
      // Only host-specific layouts are written for hosts that the user
      // actually has installed; the universal `SKILL.md` + `references/`
      // are always written so AGENTS.md can `@SKILL.md`-reference them.
      const detectedIds = detectedAgentHosts().map((h) => h.id);
      const skillHosts = deriveInstallHosts(detectedIds);
      const projectAbs = resolve(dir);
      const skillResult = await installHyperframesSkill({
        projectDir: projectAbs,
        hosts: skillHosts,
      });

      if (isJsonMode()) {
        outputResult({
          success: true,
          command: "scene init",
          dir,
          name,
          aspect,
          duration,
          visualStyle: visualStyle?.name ?? null,
          created: result.created,
          merged: result.merged,
          skipped: result.skipped,
          skillFiles: skillResult.files,
          skillBundleVersion: skillResult.bundleVersion,
        });
        return;
      }

      spinner?.succeed(chalk.green(`Scene project ready: ${dir}`));
      console.log();
      console.log(chalk.bold.cyan("Files"));
      console.log(chalk.dim("─".repeat(60)));
      for (const f of result.created) console.log(chalk.green("  +"), f);
      for (const f of result.merged)  console.log(chalk.yellow("  ~"), f, chalk.dim("(merged)"));
      for (const f of result.skipped) console.log(chalk.dim("  ·"), f, chalk.dim("(kept existing)"));

      const skillWritten = skillResult.files.filter((f) => f.status === "wrote");
      const skillSkipped = skillResult.files.filter((f) => f.status === "skipped-exists");
      if (skillWritten.length + skillSkipped.length > 0) {
        console.log();
        console.log(chalk.bold.cyan("Hyperframes skill"));
        console.log(chalk.dim("─".repeat(60)));
        for (const f of skillWritten) console.log(chalk.green("  +"), f.path);
        for (const f of skillSkipped) console.log(chalk.dim("  ·"), f.path, chalk.dim("(kept existing)"));
        console.log(chalk.dim(`  Bundle: ${skillResult.bundleVersion}`));
      }

      console.log();
      console.log(chalk.bold.cyan("Next steps"));
      console.log(chalk.dim("─".repeat(60)));
      if (visualStyle) {
        console.log(`  ${chalk.dim("DESIGN.md seeded with")} ${chalk.bold(visualStyle.name)} ${chalk.dim("— review and customise.")}`);
      } else {
        console.log(`  ${chalk.cyan("vibe scene styles")}        ${chalk.dim("# pick a named style for DESIGN.md")}`);
      }
      console.log(`  ${chalk.dim("Your agent now has Hyperframes rules in")} ${chalk.cyan("SKILL.md")} ${chalk.dim("— ask it to author scene HTML directly.")}`);
      console.log(`  ${chalk.cyan("vibe scene add")} <name>    ${chalk.dim("# fallback: 5-preset emit (no agent)")}`);
      console.log(`  ${chalk.cyan("vibe scene lint")}          ${chalk.dim("# validate HTML")}`);
      console.log(`  ${chalk.cyan("vibe scene render")}        ${chalk.dim("# render to MP4")}`);
    } catch (error) {
      spinner?.fail("Failed to scaffold scene project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to scaffold: ${msg}`));
    }
  });

// ---------------------------------------------------------------------------
// `vibe scene install-skill` — drop the Hyperframes skill into a project
// ---------------------------------------------------------------------------
// Phase H1 — exposed as a separate subcommand for retroactive install on
// existing scene projects (i.e. projects scaffolded before this command
// existed). `vibe scene init` calls the same library function eagerly.

const VALID_INSTALL_SKILL_HOSTS = ["claude-code", "cursor", "auto", "all"] as const;
type InstallSkillHostFlag = (typeof VALID_INSTALL_SKILL_HOSTS)[number];

sceneCommand
  .command("install-skill")
  .description("Install the Hyperframes skill into a scene project so the host agent can read it (Phase H1)")
  .argument("[project-dir]", "Project directory containing STORYBOARD.md / DESIGN.md", ".")
  .option("--host <id>", `Host layout target: ${VALID_INSTALL_SKILL_HOSTS.join(" | ")}`, "auto")
  .option("--force", "Overwrite existing skill files (default: skip-on-exist)")
  .option("--dry-run", "Preview which files would be written without changing anything")
  .action(async (projectDirArg: string, options) => {
    const hostFlag = (options.host as InstallSkillHostFlag) ?? "auto";
    if (!VALID_INSTALL_SKILL_HOSTS.includes(hostFlag)) {
      exitWithError(usageError(`Invalid --host: ${hostFlag}`, `Valid: ${VALID_INSTALL_SKILL_HOSTS.join(", ")}`));
    }

    const projectDir = resolve(projectDirArg);
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
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
    });

    if (isJsonMode()) {
      outputResult({
        success: true,
        command: "scene install-skill",
        projectDir,
        host: hostFlag,
        resolvedHosts: hosts,
        bundleVersion: result.bundleVersion,
        files: result.files,
        dryRun: options.dryRun ?? false,
      });
      return;
    }

    console.log();
    console.log(chalk.bold.cyan("Hyperframes skill install"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.dim(`Project:   ${projectDir}`));
    console.log(chalk.dim(`Host:      ${hostFlag}${hostFlag === "auto" ? ` (resolved → ${hosts.join(", ") || "universal-only"})` : ""}`));
    console.log(chalk.dim(`Bundle:    ${result.bundleVersion}`));
    console.log();

    for (const f of result.files) {
      const icon =
        f.status === "wrote" ? chalk.green("+")
        : f.status === "skipped-exists" ? chalk.dim("·")
        : f.status === "would-write" ? chalk.cyan("~")
        : chalk.dim("·");
      const note =
        f.status === "skipped-exists" ? chalk.dim(" (kept existing — pass --force to overwrite)")
        : f.status === "would-write" ? chalk.dim(" (would write)")
        : f.status === "would-skip-exists" ? chalk.dim(" (would skip — exists)")
        : "";
      console.log(`  ${icon} ${f.path}${note}`);
    }

    if (options.dryRun) {
      console.log();
      console.log(chalk.dim("Dry run — no files written. Re-run without --dry-run to apply."));
    }
  });

// ---------------------------------------------------------------------------
// `vibe scene compose-prompts` — Phase H2 agentic primitive
// ---------------------------------------------------------------------------
// Emit the prompt + skill-bundle reference plan for the host agent to
// author per-beat HTML files itself. No LLM call from the CLI. Pairs
// with `vibe scene install-skill` (H1) — skill files in the project,
// reasoning in the host agent.

sceneCommand
  .command("compose-prompts")
  .description("Emit the per-beat compose plan for the host agent to author HTML itself (Phase H2 — no LLM call)")
  .argument("[project-dir]", "Project directory containing STORYBOARD.md / DESIGN.md", ".")
  .option("--beat <id>", "Restrict the plan to a single beat by id (e.g. 'hook', '1')")
  .action(async (projectDirArg: string, options) => {
    const projectDir = resolve(projectDirArg);
    const result = await getComposePrompts({
      projectDir,
      beatId: options.beat as string | undefined,
    });

    if (!result.success) {
      if (isJsonMode()) {
        outputResult({
          command: "scene compose-prompts",
          ...result,
        });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "compose-prompts failed"));
    }

    if (isJsonMode()) {
      outputResult({
        command: "scene compose-prompts",
        ...result,
      });
      return;
    }

    console.log();
    console.log(chalk.bold.cyan("Scene compose plan"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(chalk.dim(`Project:    ${projectDir}`));
    console.log(chalk.dim(`Skill ref:  ${result.skillReference ?? chalk.yellow("not installed")}`));
    console.log(chalk.dim(`Design ref: ${result.designReference}`));
    console.log(chalk.dim(`Beats:      ${result.beats.length}${options.beat ? " (filtered)" : ""}`));
    console.log(chalk.dim(`Bundle:     ${result.bundleVersion}`));
    console.log();

    if (result.warnings.length > 0) {
      console.log(chalk.yellow("Warnings"));
      console.log(chalk.dim("─".repeat(60)));
      for (const w of result.warnings) console.log(chalk.yellow(`  ⚠ ${w}`));
      console.log();
    }

    console.log(chalk.bold.cyan("Beats"));
    console.log(chalk.dim("─".repeat(60)));
    for (const b of result.beats) {
      const status = b.exists ? chalk.dim("(exists)") : chalk.green("(new)");
      const dur = b.duration !== undefined ? chalk.dim(` ${b.duration}s`) : "";
      console.log(`  ${chalk.bold(b.id)}${dur} → ${b.outputPath} ${status}`);
    }
    console.log();

    console.log(chalk.bold.cyan("Instructions for the host agent"));
    console.log(chalk.dim("─".repeat(60)));
    for (const line of result.instructions) console.log(`  ${line}`);
    console.log();
    console.log(chalk.dim("Re-run with --json to get the full per-beat userPrompt + cues for direct consumption."));
  });

// ---------------------------------------------------------------------------
// `vibe scene styles` — list / show vendored visual identities
// ---------------------------------------------------------------------------

sceneCommand
  .command("styles")
  .description("List vendored visual styles (or show one) for DESIGN.md seeding")
  .argument("[name]", "Style name to inspect (omit to list all)")
  .action((name?: string) => {
    if (!name) {
      const all = listVisualStyles();
      if (isJsonMode()) {
        outputResult({
          success: true,
          command: "scene styles",
          count: all.length,
          styles: all.map((s) => ({
            name: s.name,
            slug: s.slug,
            designer: s.designer,
            mood: s.mood,
            bestFor: s.bestFor,
          })),
        });
        return;
      }
      console.log();
      console.log(chalk.bold.cyan("Visual styles"));
      console.log(chalk.dim("─".repeat(60)));
      for (const s of all) {
        console.log(
          `  ${chalk.bold(s.name.padEnd(18))} ${chalk.dim(s.mood.padEnd(24))} ${chalk.dim(s.bestFor)}`,
        );
      }
      console.log();
      console.log(chalk.dim("Show details: "), chalk.cyan('vibe scene styles "<name>"'));
      console.log(chalk.dim("Seed DESIGN.md:"), chalk.cyan('vibe scene init <dir> --visual-style "<name>"'));
      return;
    }

    const style = getVisualStyle(name);
    if (!style) {
      exitWithError(
        usageError(
          `Unknown visual style: ${name}`,
          `Valid: ${visualStyleNames()}.`,
        ),
      );
      return;
    }

    if (isJsonMode()) {
      outputResult({ success: true, command: "scene styles", style });
      return;
    }

    console.log();
    console.log(chalk.bold.cyan(style.name), chalk.dim(`— ${style.designer}`));
    console.log(chalk.dim("─".repeat(60)));
    console.log(`${chalk.bold("Mood:")}        ${style.mood}`);
    console.log(`${chalk.bold("Best for:")}    ${style.bestFor}`);
    console.log(`${chalk.bold("Palette:")}     ${style.palette.join(", ")}`);
    console.log(chalk.dim("              ") + style.paletteNotes);
    console.log(`${chalk.bold("Typography:")}  ${style.typography}`);
    console.log(`${chalk.bold("Composition:")} ${style.composition}`);
    console.log(`${chalk.bold("Motion:")}      ${style.motion}`);
    console.log(`${chalk.bold("GSAP:")}        ${style.gsapSignature}`);
    console.log(`${chalk.bold("Transition:")}  ${style.transition}`);
    console.log();
    console.log(chalk.bold("Avoid:"));
    for (const a of style.avoid) console.log(`  ${chalk.red("•")} ${a}`);
    console.log();
    console.log(chalk.dim("Seed DESIGN.md:"), chalk.cyan(`vibe scene init <dir> --visual-style "${style.name}"`));
  });

// ---------------------------------------------------------------------------
// `vibe scene add`
// ---------------------------------------------------------------------------

sceneCommand
  .command("add")
  .description("Add a new scene to a project: AI narration + image + per-scene HTML")
  .argument("<name>", "Scene name (slugified into the composition id)")
  .option("--style <preset>", `Style preset: ${SCENE_PRESETS.join(", ")}`, "simple")
  .option("--narration <text>", "Narration text (or path to a .txt file). Drives TTS + scene duration.")
  .option("--narration-file <path>", "Existing narration audio file (.wav/.mp3). Skips TTS — useful with hyperframes tts, Mac say, or other external tools.")
  .option("-d, --duration <sec>", "Explicit scene duration in seconds (overrides narration audio)")
  .option("--visuals <prompt>", "Image prompt — generates assets/scene-<id>.png via the configured image provider")
  .option("--headline <text>", "Visible headline (defaults to the humanised scene name)")
  .option("--kicker <text>", "Small label above the headline (explainer / product-shot)")
  .option("--insert-into <path>", "Root composition file to update", "index.html")
  .option("--project <dir>", "Project directory", ".")
  .option("--image-provider <name>", "Image provider: gemini, openai", "gemini")
  .option("--tts <provider>", "TTS provider: auto, elevenlabs, kokoro (default auto — picks ElevenLabs when key set, else Kokoro local)", "auto")
  .option("--voice <id>", "Voice id (ElevenLabs name/id, or Kokoro id like af_heart, am_michael)")
  .option("--no-audio", "Skip TTS even when --narration is provided (useful for tests/agent dry runs)")
  .option("--no-image", "Skip image generation even when --visuals is provided")
  .option("--no-transcribe", "Skip Whisper word-level transcribe step (no transcript-<id>.json emitted)")
  .option("--transcribe-language <code>", "BCP-47 language code passed to Whisper (e.g. en, ko)")
  .option("--force", "Overwrite an existing compositions/scene-<id>.html")
  .option("--dry-run", "Preview parameters without writing files or calling APIs")
  .action(async (name: string, options) => {
    if (options.style) options.style = validatePreset(options.style);
    if (options.duration !== undefined) options.duration = validateDuration(options.duration);
    let tts: TtsProviderName;
    try {
      tts = parseTtsProviderName(options.tts);
    } catch (error) {
      exitWithError(usageError(error instanceof Error ? error.message : String(error)));
    }

    if (options.dryRun) {
      const id = slugifySceneName(name);
      outputResult({
        dryRun: true,
        command: "scene add",
        params: {
          name,
          id,
          preset: options.style,
          narration: !!options.narration,
          visuals: !!options.visuals,
          duration: options.duration,
          headline: options.headline,
          kicker: options.kicker,
          project: options.project,
          insertInto: options.insertInto,
          imageProvider: options.imageProvider,
          tts,
          audio: options.audio,   // commander sets `audio: false` when --no-audio is passed
          image: options.image,
        },
      });
      return;
    }

    const spinner = isJsonMode() ? null : ora(`Adding scene "${name}"...`).start();

    try {
      const result = await executeSceneAdd({
        name,
        preset: options.style as ScenePreset,
        narration: options.narration,
        narrationFile: options.narrationFile,
        duration: options.duration,
        visuals: options.visuals,
        headline: options.headline,
        kicker: options.kicker,
        projectDir: options.project,
        insertInto: options.insertInto,
        imageProvider: options.imageProvider,
        tts,
        voice: options.voice,
        skipAudio: options.audio === false,
        skipImage: options.image === false,
        skipTranscribe: options.transcribe === false,
        transcribeLanguage: options.transcribeLanguage,
        force: !!options.force,
        onProgress: (msg) => {
          if (spinner) spinner.text = msg;
        },
      });

      if (!result.success) {
        spinner?.fail(`Failed to add scene "${name}"`);
        exitWithError(generalError(result.error ?? "Scene add failed"));
      }

      if (isJsonMode()) {
        outputResult({
          command: "scene add",
          ...result,
        });
        return;
      }

      spinner?.succeed(chalk.green(`Scene added: ${result.id}`));
      console.log();
      console.log(chalk.bold.cyan("Files"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(chalk.green("  +"), result.scenePath);
      if (result.audioPath) console.log(chalk.green("  +"), result.audioPath);
      if (result.imagePath) console.log(chalk.green("  +"), result.imagePath);
      if (result.transcriptPath) console.log(chalk.green("  +"), result.transcriptPath);
      console.log(chalk.yellow("  ~"), result.rootPath, chalk.dim("(updated)"));
      console.log();
      console.log(chalk.bold.cyan("Composition"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  id        ${chalk.bold(result.id)}`);
      console.log(`  preset    ${result.preset}`);
      console.log(`  start     ${result.start.toFixed(2)}s`);
      console.log(`  duration  ${result.duration.toFixed(2)}s`);
      console.log();
      console.log(chalk.bold.cyan("Next steps"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  ${chalk.cyan("vibe scene lint")}      ${chalk.dim("# validate HTML")}`);
      console.log(`  ${chalk.cyan("vibe scene render")}    ${chalk.dim("# render to MP4")}`);
    } catch (error) {
      spinner?.fail(`Failed to add scene "${name}"`);
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(msg));
    }
  });

// ---------------------------------------------------------------------------
// executeSceneAdd — testable orchestration (also targeted by C6 agent tool)
// ---------------------------------------------------------------------------

export interface SceneAddOptions {
  name: string;
  preset: ScenePreset;
  /** Narration text. If the value is an existing file path, its content is used. */
  narration?: string;
  /**
   * Path to an existing narration audio file (.wav/.mp3). When provided,
   * skips TTS entirely and copies the file into the project's `assets/`.
   * Compatible with `npx hyperframes tts`, `say`, or any other external
   * synthesis tool. The transcript is still generated unless
   * `skipTranscribe` is set.
   */
  narrationFile?: string;
  /** Explicit duration in seconds. Overrides narration-derived duration. */
  duration?: number;
  /** Image generation prompt. */
  visuals?: string;
  headline?: string;
  kicker?: string;
  /** Project directory. Defaults to cwd. */
  projectDir?: string;
  /** Filename of the root composition (relative to projectDir). */
  insertInto?: string;
  /** "gemini" | "openai". */
  imageProvider?: string;
  /** TTS provider preference. Defaults to `"auto"` (ElevenLabs if key set, else Kokoro). */
  tts?: TtsProviderName;
  /** Voice id (ElevenLabs name/id, or Kokoro id like `af_heart`). */
  voice?: string;
  /** When true, skip TTS even if narration is provided. */
  skipAudio?: boolean;
  /** When true, skip image generation even if visuals is provided. */
  skipImage?: boolean;
  /**
   * When true, skip the Whisper word-level transcribe step that would
   * otherwise emit `assets/transcript-<id>.json`.
   */
  skipTranscribe?: boolean;
  /** BCP-47 language hint forwarded to Whisper (e.g. `"en"`, `"ko"`). */
  transcribeLanguage?: string;
  /** Overwrite existing compositions/scene-<id>.html. */
  force?: boolean;
  /** Progress sink (CLI spinner / agent stream). */
  onProgress?: (msg: string) => void;
}

export interface SceneAddResult {
  success: boolean;
  id: string;
  preset: ScenePreset;
  start: number;
  duration: number;
  scenePath: string;
  rootPath: string;
  audioPath?: string;
  imagePath?: string;
  /**
   * Project-relative path to `assets/transcript-<id>.json` when Whisper
   * word-level transcribe ran. `undefined` when skipped or when the audio
   * source produced no narration text to transcribe.
   */
  transcriptPath?: string;
  /** Number of word entries emitted into the transcript JSON. */
  transcriptWordCount?: number;
  error?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function loadVibeProjectConfig(projectDir: string): Promise<VibeProjectConfig | null> {
  const cfgPath = resolve(projectDir, "vibe.project.yaml");
  if (!(await pathExists(cfgPath))) return null;
  const raw = await readFile(cfgPath, "utf-8");
  return yamlParse(raw) as VibeProjectConfig;
}

/** Resolve narration text — value may be inline text or a path to a `.txt`/`.md` file. */
async function resolveNarrationText(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  // Treat as a file path only when it actually exists AND looks like one. This
  // avoids accidentally interpreting a sentence with a slash as a path.
  const looksLikePath = /\.[a-z]{2,4}$/i.test(value) || value.includes("/") || value.includes("\\");
  if (looksLikePath && existsSync(value)) {
    return (await readFile(value, "utf-8")).trim();
  }
  return value.trim();
}

/** Map a project aspect to the OpenAI image API size string. */
function openAiSizeForAspect(width: number, height: number): "1024x1024" | "1536x1024" | "1024x1536" {
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

/** Best-effort aspect-ratio string for the image provider. */
function aspectStringFromDims(width: number, height: number): string {
  if (width === height) return "1:1";
  if (width === 1920 && height === 1080) return "16:9";
  if (width === 1080 && height === 1920) return "9:16";
  if (width === 1080 && height === 1350) return "4:5";
  return width > height ? "16:9" : "9:16";
}

export async function executeSceneAdd(opts: SceneAddOptions): Promise<SceneAddResult> {
  const projectDir = resolve(opts.projectDir ?? ".");
  const rootRel = opts.insertInto ?? "index.html";
  const rootPath = resolve(projectDir, rootRel);
  const id = slugifySceneName(opts.name);
  const sceneRel = `compositions/scene-${id}.html`;
  const scenePath = resolve(projectDir, sceneRel);

  // -- Validate project ----------------------------------------------------
  const errResult = (error: string): SceneAddResult => ({
    success: false,
    id,
    preset: opts.preset,
    start: 0,
    duration: 0,
    scenePath,
    rootPath,
    error,
  });

  if (!(await pathExists(rootPath))) {
    return errResult(`Root composition not found: ${rootPath}. Run \`vibe scene init\` first.`);
  }
  if (!opts.force && (await pathExists(scenePath))) {
    return errResult(`Scene already exists: ${sceneRel}. Re-run with --force to overwrite.`);
  }

  // -- Resolve canvas dims (root takes precedence over project config) -----
  const rootHtmlBefore = await readFile(rootPath, "utf-8");
  let dims = readRootDims(rootHtmlBefore);
  if (!dims) {
    const cfg = await loadVibeProjectConfig(projectDir);
    if (cfg?.aspect) dims = aspectToDims(cfg.aspect);
  }
  if (!dims) {
    return errResult("Could not determine canvas dimensions from index.html or vibe.project.yaml.");
  }

  // -- Resolve narration text ---------------------------------------------
  const narrationText = await resolveNarrationText(opts.narration);

  // -- Asset generation: narration audio -----------------------------------
  let audioRelPath: string | undefined;
  let audioAbsPath: string | undefined;
  let narrationDuration: number | undefined;

  if (opts.narrationFile && !opts.skipAudio) {
    // External wav/mp3: skip TTS, copy file into the project's assets/ dir.
    const sourceAbs = resolve(opts.narrationFile);
    if (!(await pathExists(sourceAbs))) {
      return errResult(`Narration file not found: ${sourceAbs}`);
    }
    const ext = (sourceAbs.match(/\.([a-z0-9]+)$/i)?.[1] ?? "wav").toLowerCase();
    if (ext !== "wav" && ext !== "mp3") {
      return errResult(`Unsupported narration file extension: .${ext}. Use .wav or .mp3.`);
    }
    audioRelPath = `assets/narration-${id}.${ext}`;
    audioAbsPath = resolve(projectDir, audioRelPath);
    await mkdir(dirname(audioAbsPath), { recursive: true });
    await copyFile(sourceAbs, audioAbsPath);
    try {
      narrationDuration = await getAudioDuration(audioAbsPath);
    } catch {
      narrationDuration = undefined;
    }
  } else if (narrationText && !opts.skipAudio) {
    let resolution;
    try {
      resolution = await resolveTtsProvider(opts.tts ?? "auto");
    } catch (error) {
      if (error instanceof TtsKeyMissingError) {
        return errResult(error.message);
      }
      throw error;
    }
    opts.onProgress?.(
      resolution.provider === "kokoro"
        ? "Generating narration with Kokoro (local — first run downloads ~330MB)..."
        : "Generating narration with ElevenLabs...",
    );
    const tts = await resolution.call(narrationText, {
      voice: opts.voice,
      onProgress: (event) => {
        if (event.status === "progress" && typeof event.progress === "number") {
          opts.onProgress?.(`Kokoro model: ${event.file ?? ""} ${Math.round(event.progress)}%`);
        }
      },
    });
    if (!tts.success || !tts.audioBuffer) {
      return errResult(`${resolution.provider} TTS failed: ${tts.error ?? "unknown error"}`);
    }
    audioRelPath = `assets/narration-${id}.${resolution.audioExtension}`;
    audioAbsPath = resolve(projectDir, audioRelPath);
    await mkdir(dirname(audioAbsPath), { recursive: true });
    await writeFile(audioAbsPath, tts.audioBuffer);
    try {
      narrationDuration = await getAudioDuration(audioAbsPath);
    } catch {
      narrationDuration = undefined;
    }
  }

  // -- Whisper word-level transcribe --------------------------------------
  // Auto-runs whenever we have audio + an OpenAI key. The transcript JSON
  // mirrors the Hyperframes shape so a future emitSceneHtml (C5) can drive
  // GSAP word-sync from it. Failure is non-fatal — narration still plays,
  // we just lose word-level animation timing.
  let transcriptRelPath: string | undefined;
  let transcriptWordCount: number | undefined;
  let transcriptWords: { text: string; start: number; end: number }[] | undefined;

  if (audioAbsPath && !opts.skipTranscribe) {
    const whisperKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
    if (!whisperKey) {
      opts.onProgress?.(
        "Skipping transcribe (OPENAI_API_KEY not set — narration plays but word-sync unavailable)",
      );
    } else {
      opts.onProgress?.("Transcribing narration (Whisper word-level)...");
      try {
        const whisper = new WhisperProvider();
        await whisper.initialize({ apiKey: whisperKey });
        const audioBytes = await readFile(audioAbsPath);
        const audioBlob = new Blob([new Uint8Array(audioBytes)]);
        const transcript = await whisper.transcribe(audioBlob, undefined, {
          granularity: "word",
          language: opts.transcribeLanguage,
        });
        if (transcript.status === "completed" && transcript.words?.length) {
          transcriptRelPath = `assets/transcript-${id}.json`;
          const transcriptAbs = resolve(projectDir, transcriptRelPath);
          await writeFile(transcriptAbs, JSON.stringify(transcript.words, null, 2), "utf-8");
          transcriptWordCount = transcript.words.length;
          transcriptWords = transcript.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
        } else if (transcript.status === "failed") {
          opts.onProgress?.(`Transcribe failed: ${transcript.error ?? "unknown error"}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        opts.onProgress?.(`Transcribe failed: ${msg}`);
      }
    }
  }

  // -- Asset generation: backdrop image -----------------------------------
  let imageRelPath: string | undefined;
  let imageAbsPath: string | undefined;

  if (opts.visuals && !opts.skipImage) {
    const provider = (opts.imageProvider ?? "gemini").toLowerCase();
    if (provider !== "gemini" && provider !== "openai") {
      return errResult(`Unsupported --image-provider: ${provider}. Valid: gemini, openai.`);
    }
    opts.onProgress?.(`Generating image with ${provider}...`);

    if (provider === "openai") {
      const openaiKey = await getApiKey("OPENAI_API_KEY", "OpenAI");
      if (!openaiKey) {
        return errResult("OpenAI API key required for --visuals --image-provider openai. Set OPENAI_API_KEY or pass --no-image.");
      }
      const openai = new OpenAIImageProvider();
      await openai.initialize({ apiKey: openaiKey });
      const imageResult = await openai.generateImage(opts.visuals, {
        size: openAiSizeForAspect(dims.width, dims.height),
        quality: "standard",
      });
      if (!imageResult.success || !imageResult.images?.[0]) {
        return errResult(`OpenAI image generation failed: ${imageResult.error ?? "unknown error"}`);
      }
      const img = imageResult.images[0];
      imageRelPath = `assets/scene-${id}.png`;
      imageAbsPath = resolve(projectDir, imageRelPath);
      await mkdir(dirname(imageAbsPath), { recursive: true });
      let buffer: Buffer;
      if (img.base64) {
        buffer = Buffer.from(img.base64, "base64");
      } else if (img.url) {
        const response = await fetch(img.url);
        buffer = Buffer.from(await response.arrayBuffer());
      } else {
        return errResult("OpenAI returned no image data");
      }
      await writeFile(imageAbsPath, buffer);
    } else {
      const googleKey = await getApiKey("GOOGLE_API_KEY", "Google");
      if (!googleKey) {
        return errResult("Google API key required for Gemini image generation. Set GOOGLE_API_KEY or pass --no-image.");
      }
      const gemini = new GeminiProvider();
      await gemini.initialize({ apiKey: googleKey });
      const aspectRatio = aspectStringFromDims(dims.width, dims.height) as "1:1" | "16:9" | "9:16" | "4:5";
      const imageResult = await gemini.generateImage(opts.visuals, { aspectRatio });
      if (!imageResult.success || !imageResult.images?.[0]?.base64) {
        return errResult(`Gemini image generation failed: ${imageResult.error ?? "unknown error"}`);
      }
      imageRelPath = `assets/scene-${id}.png`;
      imageAbsPath = resolve(projectDir, imageRelPath);
      await mkdir(dirname(imageAbsPath), { recursive: true });
      const buffer = Buffer.from(imageResult.images[0].base64!, "base64");
      await writeFile(imageAbsPath, buffer);
    }
  }

  // -- Decide scene duration -----------------------------------------------
  // Scene duration must be ≥ narration audio length, otherwise the parent
  // clip's data-duration cuts the audio short. The previous heuristic
  // (`opts.duration ?? narrationDuration ?? fallback`) honored an explicit
  // `--duration` even when shorter than the generated TTS, producing
  // "scene feels rushed / narration cut off". `--duration` is now a
  // *minimum*; when narration audio is longer, extend to fit narration +
  // the SCENE_OVERLAP_SECONDS crossfade tail + a small TTS-tail buffer.
  const cfg = await loadVibeProjectConfig(projectDir);
  const fallback = cfg?.defaultSceneDuration ?? 5;
  const NARRATION_TAIL_BUFFER = 0.5;
  const userDur = opts.duration;
  const audioMinDur = narrationDuration !== undefined
    ? narrationDuration + SCENE_OVERLAP_SECONDS + NARRATION_TAIL_BUFFER
    : undefined;
  let duration: number;
  if (userDur !== undefined && audioMinDur !== undefined) {
    duration = Math.max(userDur, audioMinDur);
  } else if (audioMinDur !== undefined) {
    duration = audioMinDur;
  } else if (userDur !== undefined) {
    duration = userDur;
  } else {
    duration = fallback;
  }
  duration = Number(duration.toFixed(2));

  // -- Emit scene HTML -----------------------------------------------------
  opts.onProgress?.("Emitting scene HTML...");
  const sceneHtml = emitSceneHtml({
    id,
    preset: opts.preset,
    width: dims.width,
    height: dims.height,
    duration,
    headline: opts.headline,
    subhead: narrationText,
    kicker: opts.kicker,
    imagePath: imageRelPath,
    audioPath: audioRelPath,
    transcript: transcriptWords,
  });
  await mkdir(dirname(scenePath), { recursive: true });
  await writeFile(scenePath, sceneHtml, "utf-8");

  // -- Update root index.html ---------------------------------------------
  opts.onProgress?.("Updating root composition...");
  // Each new scene starts SCENE_OVERLAP_SECONDS before the previous scene's
  // end so the two clips overlap in the parent timeline. Inside each scene,
  // the matching scope opacity tweens at boundaries produce a smooth
  // crossfade instead of the hard cut the previous architecture had.
  // Adjacent clips alternate track-index (1, 2, 1, 2, ...) so the
  // Hyperframes `overlapping_clips_same_track` lint rule doesn't flag the
  // deliberate crossfade overlap.
  const start = nextSceneStart(rootHtmlBefore, SCENE_OVERLAP_SECONDS);
  const existingClipCount = (rootHtmlBefore.match(/<div\s+class="clip"/g) || []).length;
  const trackIndex = (existingClipCount % 2) + 1;
  const updated = insertClipIntoRoot(rootHtmlBefore, { id, start, duration, trackIndex });
  await writeFile(rootPath, updated, "utf-8");

  const transcriptAbsPath = transcriptRelPath ? resolve(projectDir, transcriptRelPath) : undefined;

  return {
    success: true,
    id,
    preset: opts.preset,
    start,
    duration,
    scenePath: relative(process.cwd(), scenePath) || scenePath,
    rootPath: relative(process.cwd(), rootPath) || rootPath,
    audioPath: audioAbsPath ? (relative(process.cwd(), audioAbsPath) || audioAbsPath) : undefined,
    imagePath: imageAbsPath ? (relative(process.cwd(), imageAbsPath) || imageAbsPath) : undefined,
    transcriptPath: transcriptAbsPath ? (relative(process.cwd(), transcriptAbsPath) || transcriptAbsPath) : undefined,
    transcriptWordCount,
  };
}

// ---------------------------------------------------------------------------
// `vibe scene lint`
// ---------------------------------------------------------------------------

sceneCommand
  .command("lint")
  .description("Validate scene HTML against Hyperframes rules (in-process, no Chrome required)")
  .argument("[root]", "Root composition file relative to --project", "index.html")
  .option("--project <dir>", "Project directory", ".")
  .option("--fix", "Apply mechanical auto-fixes (currently: missing class=\"clip\")")
  .action(async (root: string, options) => {
    const projectDir = resolve(options.project as string);
    if (!(await rootExists(projectDir, root))) {
      exitWithError(generalError(
        `Root composition not found: ${resolve(projectDir, root)}`,
        "Run `vibe scene init` first, or pass --project <dir>.",
      ));
    }

    const spinner = isJsonMode() ? null : ora("Linting scenes...").start();
    let result: ProjectLintResult;
    try {
      result = await runProjectLint({ projectDir, rootRel: root, fix: !!options.fix });
    } catch (error) {
      spinner?.fail("Lint failed");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Lint failed: ${msg}`));
    }

    if (isJsonMode()) {
      outputResult({
        command: "scene lint",
        ...result,
      });
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (result.ok && result.warningCount === 0 && result.infoCount === 0) {
      spinner?.succeed(chalk.green(`Lint clean — ${result.files.length} file(s) checked`));
    } else if (result.ok) {
      spinner?.warn(chalk.yellow(
        `${result.warningCount} warning(s), ${result.infoCount} info — ${result.errorCount} error(s)`,
      ));
    } else {
      spinner?.fail(chalk.red(
        `${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info`,
      ));
    }

    for (const file of result.files) {
      if (file.findings.length === 0) continue;
      console.log();
      console.log(chalk.bold.cyan(file.file));
      console.log(chalk.dim("─".repeat(60)));
      for (const f of file.findings) {
        const tag = severityTag(f.severity);
        const loc = f.elementId ? chalk.dim(` #${f.elementId}`) : f.selector ? chalk.dim(` ${f.selector}`) : "";
        console.log(`  ${tag} ${chalk.dim(`[${f.code}]`)}${loc}  ${f.message}`);
        if (f.fixHint) console.log(`     ${chalk.dim("→ " + f.fixHint)}`);
      }
    }

    if (result.fixed.length > 0) {
      console.log();
      console.log(chalk.bold.cyan("Auto-fixed"));
      console.log(chalk.dim("─".repeat(60)));
      for (const fx of result.fixed) {
        console.log(`  ${chalk.green("✔")} ${fx.file}  ${chalk.dim(fx.codes.join(", "))}`);
      }
    }

    if (!result.ok) process.exitCode = 1;
  });

function severityTag(severity: "error" | "warning" | "info"): string {
  if (severity === "error") return chalk.red("✘ error  ");
  if (severity === "warning") return chalk.yellow("⚠ warn   ");
  return chalk.blue("ℹ info   ");
}

// ---------------------------------------------------------------------------
// `vibe scene render`
// ---------------------------------------------------------------------------

const VALID_FPS: ReadonlyArray<RenderFps> = [24, 30, 60];
const VALID_QUALITIES: ReadonlyArray<RenderQuality> = ["draft", "standard", "high"];
const VALID_FORMATS: ReadonlyArray<RenderFormat> = ["mp4", "webm", "mov"];

function validateFps(value: string): RenderFps {
  const n = parseInt(value, 10);
  if (!VALID_FPS.includes(n as RenderFps)) {
    exitWithError(usageError(`Invalid --fps: ${value}`, `Valid: ${VALID_FPS.join(", ")}`));
  }
  return n as RenderFps;
}

function validateQuality(value: string): RenderQuality {
  if (!VALID_QUALITIES.includes(value as RenderQuality)) {
    exitWithError(usageError(`Invalid --quality: ${value}`, `Valid: ${VALID_QUALITIES.join(", ")}`));
  }
  return value as RenderQuality;
}

function validateFormat(value: string): RenderFormat {
  if (!VALID_FORMATS.includes(value as RenderFormat)) {
    exitWithError(usageError(`Invalid --format: ${value}`, `Valid: ${VALID_FORMATS.join(", ")}`));
  }
  return value as RenderFormat;
}

function validateWorkers(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 16) {
    exitWithError(usageError(`Invalid --workers: ${value}`, "Must be an integer between 1 and 16"));
  }
  return n;
}

sceneCommand
  .command("render")
  .description("Render a scene project to MP4/WebM/MOV via the Hyperframes producer (requires Chrome)")
  .argument("[root]", "Root composition file relative to --project", "index.html")
  .option("--project <dir>", "Project directory", ".")
  .option("-o, --out <path>", "Output file (default: renders/<name>-<timestamp>.<format>)")
  .option("--fps <n>", `Frames per second: ${VALID_FPS.join("|")}`, "30")
  .option("--quality <q>", `Quality preset: ${VALID_QUALITIES.join("|")}`, "standard")
  .option("--format <f>", `Output container: ${VALID_FORMATS.join("|")}`, "mp4")
  .option("--workers <n>", "Capture workers (1-16, default 1)", "1")
  .option("--dry-run", "Preview parameters without rendering")
  .action(async (root: string, options) => {
    const fps = validateFps(options.fps);
    const quality = validateQuality(options.quality);
    const format = validateFormat(options.format);
    const workers = validateWorkers(options.workers);
    const projectDir = resolve(options.project as string);

    if (options.dryRun) {
      outputResult({
        dryRun: true,
        command: "scene render",
        params: {
          projectDir,
          root,
          output: options.out,
          fps,
          quality,
          format,
          workers,
        },
      });
      return;
    }

    const spinner = isJsonMode() ? null : ora("Rendering scene project...").start();

    const result = await executeSceneRender({
      projectDir,
      root,
      output: options.out,
      fps,
      quality,
      format,
      workers,
      onProgress: (pct, stage) => {
        if (spinner) spinner.text = `Rendering [${Math.round(pct * 100)}%] ${stage}`;
      },
    });

    if (!result.success) {
      spinner?.fail("Render failed");
      if (isJsonMode()) {
        outputResult({ command: "scene render", ...result });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "Render failed"));
    }

    if (isJsonMode()) {
      outputResult({ command: "scene render", ...result });
      return;
    }

    spinner?.succeed(chalk.green(`Render complete: ${result.outputPath}`));
    console.log();
    console.log(chalk.bold.cyan("Render"));
    console.log(chalk.dim("─".repeat(60)));
    console.log(`  output    ${chalk.bold(result.outputPath)}`);
    console.log(`  duration  ${(((result.durationMs ?? 0) / 1000)).toFixed(1)}s`);
    console.log(`  frames    ${result.framesRendered ?? "?"}${result.totalFrames ? ` / ${result.totalFrames}` : ""}`);
    console.log(`  config    ${result.fps}fps · ${result.quality} · ${result.format}`);
    if (result.audioCount && result.audioCount > 0) {
      const muxStatus = result.audioMuxApplied
        ? chalk.green(`✓ ${result.audioCount} track${result.audioCount === 1 ? "" : "s"} muxed`)
        : chalk.yellow(`⚠ ${result.audioCount} track${result.audioCount === 1 ? "" : "s"} skipped`);
      console.log(`  audio     ${muxStatus}`);
      if (result.audioMuxWarning) {
        console.log(chalk.dim(`            ${result.audioMuxWarning}`));
      }
    }
  });

// ── vibe scene build — v0.60 one-shot storyboard → MP4 ──────────────────

sceneCommand
  .command("build")
  .description("One-shot: read STORYBOARD.md cues, dispatch TTS + image-gen per beat, compose, render to MP4 (v0.60)")
  .argument("[project-dir]", "Project directory containing STORYBOARD.md", ".")
  .option("--mode <mode>", "Build mode: agent (host-agent authors HTML) | batch (CLI's internal LLM authors HTML) | auto (agent if any host detected) [Plan H — Phase 3]", "auto")
  .option("--effort <level>", "Compose effort tier (batch mode only): low|medium|high", "medium")
  .option("--composer <provider>", "LLM that composes scene HTML in batch mode: claude|openai|gemini (default: auto-resolve from available API keys, claude > gemini > openai)")
  .option("--skip-narration", "Don't dispatch TTS even when beats declare narration cues")
  .option("--skip-backdrop", "Don't dispatch image-gen even when beats declare backdrop cues")
  .option("--skip-render", "Compose only — don't render to MP4")
  .option("--tts <provider>", "TTS provider: auto|elevenlabs|kokoro (overrides frontmatter)")
  .option("--voice <id>", "Voice id (provider-specific — overrides frontmatter)")
  .option("--image-provider <name>", "Image provider: openai (only one supported in v0.60)")
  .option("--quality <q>", "Image quality: standard|hd", "hd")
  .option("--image-size <s>", "Image size: 1024x1024|1536x1024|1024x1536", "1536x1024")
  .option("--force", "Re-dispatch primitives even when assets already exist")
  .option("--dry-run", "Preview parameters without dispatching")
  .action(async (projectDirArg: string, options) => {
    const projectDir = resolve(projectDirArg);

    if (options.dryRun) {
      outputResult({
        dryRun: true,
        command: "scene build",
        params: {
          projectDir,
          mode: options.mode,
          effort: options.effort,
          composer: options.composer,
          skipNarration: options.skipNarration ?? false,
          skipBackdrop: options.skipBackdrop ?? false,
          skipRender: options.skipRender ?? false,
          ttsProvider: options.tts,
          voice: options.voice,
          imageProvider: options.imageProvider,
          imageQuality: options.quality,
          imageSize: options.imageSize,
          force: options.force ?? false,
        },
      });
      return;
    }

    const validEfforts = ["low", "medium", "high"] as const;
    if (!validEfforts.includes(options.effort)) {
      exitWithError(usageError(`Invalid --effort: ${options.effort}`, `Must be one of: ${validEfforts.join(", ")}`));
    }

    const validComposers = ["claude", "openai", "gemini"] as const;
    if (options.composer !== undefined && !validComposers.includes(options.composer)) {
      exitWithError(usageError(`Invalid --composer: ${options.composer}`, `Must be one of: ${validComposers.join(", ")}`));
    }

    const validModes = ["agent", "batch", "auto"] as const;
    if (options.mode !== undefined && !validModes.includes(options.mode)) {
      exitWithError(usageError(`Invalid --mode: ${options.mode}`, `Must be one of: ${validModes.join(", ")}`));
    }

    const spinner = isJsonMode() ? null : ora("Reading STORYBOARD.md...").start();

    const result = await executeSceneBuild({
      projectDir,
      mode: options.mode as "agent" | "batch" | "auto" | undefined,
      effort: options.effort,
      composer: options.composer,
      skipNarration: options.skipNarration,
      skipBackdrop: options.skipBackdrop,
      skipRender: options.skipRender,
      ttsProvider: options.tts,
      voice: options.voice,
      imageProvider: options.imageProvider,
      imageQuality: options.quality,
      imageSize: options.imageSize,
      force: options.force,
      onProgress: (e: SceneBuildProgressEvent) => {
        if (!spinner) return;
        if (e.type === "phase-start") {
          spinner.text = `Phase: ${e.phase}...`;
        } else if (e.type === "narration-generated") {
          spinner.text = `Narration ${e.beatId} → ${e.path} (${e.provider})`;
        } else if (e.type === "backdrop-generated") {
          spinner.text = `Backdrop ${e.beatId} → ${e.path} (${e.provider})`;
        } else if (e.type === "beat-fresh") {
          spinner.text = `Composed beat ${e.beatId} ($${(e.costUsd ?? 0).toFixed(3)} · ${e.latencyMs ?? 0}ms)`;
        } else if (e.type === "beat-cached") {
          spinner.text = `Composed beat ${e.beatId} (cached)`;
        } else if (e.type === "render-start") {
          spinner.text = "Rendering...";
        } else if (e.type === "render-done") {
          spinner.text = `Rendered: ${e.outputPath}`;
        }
      },
    });

    if (!result.success) {
      spinner?.fail(`Build failed: ${result.error}`);
      if (isJsonMode()) {
        outputResult({ command: "scene build", ...result });
        process.exitCode = 1;
        return;
      }
      exitWithError(generalError(result.error ?? "Build failed"));
    }

    if (isJsonMode()) {
      outputResult({ command: "scene build", ...result });
      return;
    }

    // Phase H3: agent mode may pause with a "needs-author" plan instead
    // of producing an MP4. Render this distinctly so the host agent (and
    // human users) know what to do next.
    if (result.phase === "needs-author") {
      spinner?.info(chalk.cyan("Agent mode — host agent must author scene HTML before rendering"));
      console.log();
      console.log(chalk.bold.cyan("Beats requiring authorship"));
      console.log(chalk.dim("─".repeat(60)));
      const plan = result.composePrompts;
      if (plan) {
        for (const b of plan.beats) {
          const status = b.exists ? chalk.dim("(exists)") : chalk.green("(needs author)");
          const dur = b.duration !== undefined ? chalk.dim(` ${b.duration}s`) : "";
          console.log(`  ${chalk.bold(b.id)}${dur} → ${b.outputPath} ${status}`);
        }
        console.log();
        console.log(chalk.bold.cyan("Instructions"));
        console.log(chalk.dim("─".repeat(60)));
        for (const line of plan.instructions) console.log(`  ${line}`);
        if (plan.warnings.length > 0) {
          console.log();
          for (const w of plan.warnings) console.log(chalk.yellow(`  ⚠ ${w}`));
        }
      }
      console.log();
      console.log(chalk.dim("Once you've authored each beat's HTML, re-run `vibe scene build` to lint + render."));
      console.log(chalk.dim("Or pass `--mode batch` to use the internal LLM compose path instead."));
      return;
    }

    spinner?.succeed(chalk.green(
      result.outputPath
        ? `Build complete: ${result.outputPath}`
        : "Build complete (compose only — render skipped)",
    ));
    console.log();
    console.log(chalk.bold.cyan("Beats"));
    console.log(chalk.dim("─".repeat(60)));
    for (const b of result.beats) {
      const narration = formatPrimitiveStatus(b.narrationStatus, b.narrationPath);
      const backdrop = formatPrimitiveStatus(b.backdropStatus, b.backdropPath);
      console.log(`  ${chalk.bold(b.beatId.padEnd(12))} narration: ${narration}   backdrop: ${backdrop}`);
      if (b.narrationError) console.log(chalk.red(`    ! narration: ${b.narrationError}`));
      if (b.backdropError) console.log(chalk.red(`    ! backdrop: ${b.backdropError}`));
    }
    if (result.composeData) {
      console.log();
      console.log(chalk.bold.cyan("Compose"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  beats     ${result.composeData.beats}`);
      console.log(`  cache     ${result.composeData.cacheHits} hit / ${result.composeData.beats - result.composeData.cacheHits} fresh`);
      console.log(`  cost      $${result.composeData.totalCostUsd.toFixed(4)}`);
    }
    if (result.outputPath) {
      console.log();
      console.log(chalk.bold.cyan("Render"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  output    ${chalk.bold(result.outputPath)}`);
      if (result.renderResult?.audioCount && result.renderResult.audioCount > 0) {
        console.log(`  audio     ${result.renderResult.audioCount} track${result.renderResult.audioCount === 1 ? "" : "s"} muxed`);
      }
    }
    console.log();
    console.log(chalk.dim(`Total: ${(result.totalLatencyMs / 1000).toFixed(1)}s`));
  });

function formatPrimitiveStatus(status: string, path?: string): string {
  switch (status) {
    case "generated": return chalk.green(`✓ ${path}`);
    case "cached":    return chalk.dim(`◇ ${path} (cached)`);
    case "skipped":   return chalk.dim("· skipped");
    case "no-cue":    return chalk.dim("· no cue");
    case "failed":    return chalk.red("✗ failed");
    default:          return status;
  }
}
