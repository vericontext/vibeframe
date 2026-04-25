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
 *   - lint      [C3, this commit] — in-process Hyperframes lint + --fix
 *   - render    [C4]
 */

import { Command } from "commander";
import { basename, resolve, relative, dirname } from "node:path";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { parse as yamlParse } from "yaml";
import {
  ElevenLabsProvider,
  GeminiProvider,
  OpenAIImageProvider,
} from "@vibeframe/ai-providers";
import {
  scaffoldSceneProject,
  aspectToDims,
  type SceneAspect,
  type VibeProjectConfig,
} from "./_shared/scene-project.js";
import {
  emitSceneHtml,
  insertClipIntoRoot,
  nextSceneStart,
  readRootDims,
  slugifySceneName,
  SCENE_PRESETS,
  type ScenePreset,
} from "./_shared/scene-html-emit.js";
import {
  runProjectLint,
  rootExists,
  type ProjectLintResult,
} from "./_shared/scene-lint.js";
import {
  exitWithError,
  generalError,
  usageError,
  outputResult,
  isJsonMode,
} from "./output.js";
import { getApiKey } from "../utils/api-key.js";
import { getAudioDuration } from "../utils/audio.js";

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

A scene project is bilingual: it works with both \`vibe\` and \`npx hyperframes\`.
Run 'vibe schema scene.<command>' for structured parameter info.`);

sceneCommand
  .command("init")
  .description("Scaffold a new scene project (or safely augment an existing Hyperframes project)")
  .argument("<dir>", "Project directory (created if it doesn't exist)")
  .option("-n, --name <name>", "Project name (defaults to directory basename)")
  .option("-r, --ratio <ratio>", "Aspect ratio: 16:9, 9:16, 1:1, 4:5", "16:9")
  .option("-d, --duration <sec>", "Default root composition duration (seconds)", "10")
  .option("--dry-run", "Preview parameters without writing files")
  .action(async (dir: string, options) => {
    const aspect = validateAspect(options.ratio);
    const duration = validateDuration(options.duration);
    const name = (options.name as string | undefined) ?? basename(dir.replace(/\/+$/, ""));

    if (options.dryRun) {
      outputResult({
        dryRun: true,
        command: "scene init",
        params: { dir, name, aspect, duration },
      });
      return;
    }

    const spinner = isJsonMode() ? null : ora(`Scaffolding scene project at ${dir}...`).start();
    try {
      const result = await scaffoldSceneProject({ dir, name, aspect, duration });

      if (isJsonMode()) {
        outputResult({
          success: true,
          command: "scene init",
          dir,
          name,
          aspect,
          duration,
          created: result.created,
          merged: result.merged,
          skipped: result.skipped,
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
      console.log();
      console.log(chalk.bold.cyan("Next steps"));
      console.log(chalk.dim("─".repeat(60)));
      console.log(`  ${chalk.cyan("vibe scene add")} <name>    ${chalk.dim("# author a scene via AI")}`);
      console.log(`  ${chalk.cyan("vibe scene lint")}          ${chalk.dim("# validate HTML")}`);
      console.log(`  ${chalk.cyan("vibe scene render")}        ${chalk.dim("# render to MP4")}`);
    } catch (error) {
      spinner?.fail("Failed to scaffold scene project");
      const msg = error instanceof Error ? error.message : String(error);
      exitWithError(generalError(`Failed to scaffold: ${msg}`));
    }
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
  .option("-d, --duration <sec>", "Explicit scene duration in seconds (overrides narration audio)")
  .option("--visuals <prompt>", "Image prompt — generates assets/scene-<id>.png via the configured image provider")
  .option("--headline <text>", "Visible headline (defaults to the humanised scene name)")
  .option("--kicker <text>", "Small label above the headline (explainer / product-shot)")
  .option("--insert-into <path>", "Root composition file to update", "index.html")
  .option("--project <dir>", "Project directory", ".")
  .option("--image-provider <name>", "Image provider: gemini, openai", "gemini")
  .option("--voice <id>", "ElevenLabs voice id or name")
  .option("--no-audio", "Skip TTS even when --narration is provided (useful for tests/agent dry runs)")
  .option("--no-image", "Skip image generation even when --visuals is provided")
  .option("--force", "Overwrite an existing compositions/scene-<id>.html")
  .option("--dry-run", "Preview parameters without writing files or calling APIs")
  .action(async (name: string, options) => {
    if (options.style) options.style = validatePreset(options.style);
    if (options.duration !== undefined) options.duration = validateDuration(options.duration);

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
        duration: options.duration,
        visuals: options.visuals,
        headline: options.headline,
        kicker: options.kicker,
        projectDir: options.project,
        insertInto: options.insertInto,
        imageProvider: options.imageProvider,
        voice: options.voice,
        skipAudio: options.audio === false,
        skipImage: options.image === false,
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
  /** ElevenLabs voice id/name. */
  voice?: string;
  /** When true, skip TTS even if narration is provided. */
  skipAudio?: boolean;
  /** When true, skip image generation even if visuals is provided. */
  skipImage?: boolean;
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

  if (narrationText && !opts.skipAudio) {
    const elevenlabsKey = await getApiKey("ELEVENLABS_API_KEY", "ElevenLabs");
    if (!elevenlabsKey) {
      return errResult("ElevenLabs API key required for --narration. Set ELEVENLABS_API_KEY, run 'vibe setup', or pass --no-audio.");
    }
    opts.onProgress?.("Generating narration with ElevenLabs...");
    const elevenlabs = new ElevenLabsProvider();
    await elevenlabs.initialize({ apiKey: elevenlabsKey });
    const tts = await elevenlabs.textToSpeech(narrationText, { voiceId: opts.voice });
    if (!tts.success || !tts.audioBuffer) {
      return errResult(`ElevenLabs TTS failed: ${tts.error ?? "unknown error"}`);
    }
    audioRelPath = `assets/narration-${id}.mp3`;
    audioAbsPath = resolve(projectDir, audioRelPath);
    await mkdir(dirname(audioAbsPath), { recursive: true });
    await writeFile(audioAbsPath, tts.audioBuffer);
    try {
      narrationDuration = await getAudioDuration(audioAbsPath);
    } catch {
      narrationDuration = undefined;
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
  const cfg = await loadVibeProjectConfig(projectDir);
  const fallback = cfg?.defaultSceneDuration ?? 5;
  const duration = opts.duration ?? narrationDuration ?? fallback;

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
  });
  await mkdir(dirname(scenePath), { recursive: true });
  await writeFile(scenePath, sceneHtml, "utf-8");

  // -- Update root index.html ---------------------------------------------
  opts.onProgress?.("Updating root composition...");
  const start = nextSceneStart(rootHtmlBefore);
  const updated = insertClipIntoRoot(rootHtmlBefore, { id, start, duration });
  await writeFile(rootPath, updated, "utf-8");

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
      if (!result.ok) process.exit(1);
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

    if (!result.ok) process.exit(1);
  });

function severityTag(severity: "error" | "warning" | "info"): string {
  if (severity === "error") return chalk.red("✘ error  ");
  if (severity === "warning") return chalk.yellow("⚠ warn   ");
  return chalk.blue("ℹ info   ");
}
