/**
 * @module _shared/storyboard-source
 *
 * Resolves where a project's storyboard actually lives and hands back one
 * markdown document either way.
 *
 * Two on-disk layouts are supported:
 *
 * **bundle** (preferred) - `STORYBOARD.md` holds project frontmatter and
 * direction prose, and `scenes/NN-<id>.md` holds one scene per file with its
 * cues in real document frontmatter:
 *
 * ```text
 * launch/
 *   STORYBOARD.md        --- type/title/duration/aspect/providers/characters ---
 *   scenes/
 *     01-hook.md         --- duration/narration/backdrop/... ---  + body
 *     02-proof.md
 * ```
 *
 * **single** (legacy) - one `STORYBOARD.md` with `## Beat <id> - <title>`
 * headings, each carrying a leading ```yaml cue block.
 *
 * The bundle layout exists because `---` frontmatter is a *document* level
 * construct. Used mid-document it is not frontmatter at all: the opening
 * `---` is a horizontal rule and the closing one turns the lines above it
 * into a setext heading. One scene per file is the only way per-scene cues
 * can be written as frontmatter and still render correctly.
 *
 * A bundle is assembled back into the single-document shape in memory, so
 * every existing consumer of `parseStoryboard()` keeps working unchanged.
 * That is deliberate: the on-disk format users edit is decoupled from the
 * in-memory representation the build already understands.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { extractFrontmatter } from "./frontmatter.js";
import {
  deriveBeatId,
  parseStoryboard,
  STORYBOARD_CUE_KEYS,
  type Beat,
  type BeatCues,
  type StoryboardCueKey,
} from "./storyboard-parse.js";
import { normalizeCueValue } from "./storyboard-edit.js";

/** Directory, relative to the project root, that holds one file per scene. */
export const SCENES_DIRNAME = "scenes";

/** The project-level document, present in both layouts. */
export const STORYBOARD_FILENAME = "STORYBOARD.md";

export type StoryboardLayout = "bundle" | "single" | "missing";

export interface SceneFile {
  /** Beat id derived from the filename, with any ordering prefix stripped. */
  id: string;
  /** Absolute path to the scene file. */
  path: string;
  /** Filename, e.g. `01-hook.md`. */
  filename: string;
  /** Numeric ordering prefix when present (`01-hook.md` -> 1). */
  order: number | null;
}

export interface LoadedStoryboard {
  layout: StoryboardLayout;
  /** One markdown document in the legacy single-file shape. */
  markdown: string;
  /** Scene files, in play order. Empty for the single layout. */
  scenes: SceneFile[];
  /** Absolute path of the project-level document. */
  storyboardPath: string;
  /**
   * Beat ids found as `## Beat ...` headings inside STORYBOARD.md while the
   * project is a bundle. Those headings are ignored - `scenes/` is the only
   * source of scenes - and reported so validation can say so out loud.
   * Always empty for the single layout.
   */
  strayBeatIds: string[];
}

/** `01-hook.md` -> { order: 1, id: "hook" }; `hook.md` -> { order: null, id: "hook" }. */
const ORDER_PREFIX_RE = /^(\d+)[-_.]\s*(.+)$/;

function sceneFileFrom(dir: string, filename: string): SceneFile {
  const stem = filename.replace(/\.mdx?$/i, "");
  const match = stem.match(ORDER_PREFIX_RE);
  const order = match ? Number.parseInt(match[1], 10) : null;
  const idSource = match ? match[2] : stem;
  return { id: deriveBeatId(idSource), path: join(dir, filename), filename, order };
}

/**
 * Scene files in play order: numeric prefix first (ascending), then any
 * unprefixed files in filename order. Mixing the two is legal but a lint
 * elsewhere should discourage it.
 */
export async function listSceneFiles(projectDir: string): Promise<SceneFile[]> {
  const dir = join(projectDir, SCENES_DIRNAME);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.mdx?$/i.test(e.name) && !e.name.startsWith("_"))
    .map((e) => sceneFileFrom(dir, e.name));
  return files.sort((a, b) => {
    if (a.order !== null && b.order !== null) return a.order - b.order;
    if (a.order !== null) return -1;
    if (b.order !== null) return 1;
    return a.filename.localeCompare(b.filename);
  });
}

export function detectStoryboardLayout(projectDir: string, sceneCount: number): StoryboardLayout {
  if (sceneCount > 0) return "bundle";
  if (existsSync(join(projectDir, STORYBOARD_FILENAME))) return "single";
  return "missing";
}

/** Title-case a beat id for the synthesized heading: `hook` -> `Hook`. */
function humanise(id: string): string {
  return (
    id
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Scene"
  );
}

/**
 * Turn one scene file into the `## Beat <id> - <Title>` + cue-block section
 * the single-document parser expects.
 *
 * `type:` is dropped: it is OKF bookkeeping identifying the file as a scene,
 * not a cue, and passing it through would trip the unknown-cue warning.
 * A `title:` in scene frontmatter is a lower-third cue, so the heading uses
 * the humanised id and `title` stays in the cue block where it belongs.
 */
export function sceneToBeatSection(scene: SceneFile, contents: string): string {
  // `data` is null for a scene file with no frontmatter, which is legal:
  // a scene can be prose-only and inherit every default.
  const { data, body } = extractFrontmatter(contents);
  const cues: Record<string, unknown> = { ...(data ?? {}) };
  delete cues.type;

  const cueBlock =
    Object.keys(cues).length > 0
      ? "```yaml\n" + stringifyYaml(cues, { lineWidth: 0 }).trimEnd() + "\n```\n\n"
      : "";
  const prose = body.trim();
  return `## Beat ${scene.id} - ${humanise(scene.id)}\n\n${cueBlock}${prose}\n`;
}

/** Everything from the first `## ` heading onward. */
const FIRST_HEADING_RE = /^## .*/m;

/**
 * Load a project's storyboard as a single markdown document, whichever
 * layout it uses on disk.
 *
 * For a bundle, STORYBOARD.md contributes only its frontmatter and direction
 * prose. Anything from its first `## ` heading onward is dropped and its beat
 * ids returned in `strayBeatIds`.
 *
 * Concatenating instead would merge two sets of scenes into one timeline: a
 * project that has both would silently render the STORYBOARD.md beats *and*
 * the scene files, in that order. `scenes/` is the layout the project opted
 * into, so it is the only source of scenes, and the leftovers are surfaced as
 * a validation error rather than quietly obeyed or quietly discarded.
 */
export async function loadStoryboard(projectDir: string): Promise<LoadedStoryboard> {
  const storyboardPath = join(projectDir, STORYBOARD_FILENAME);
  const scenes = await listSceneFiles(projectDir);
  const layout = detectStoryboardLayout(projectDir, scenes.length);

  if (layout === "missing") {
    return { layout, markdown: "", scenes: [], storyboardPath, strayBeatIds: [] };
  }

  const head = existsSync(storyboardPath) ? await readFile(storyboardPath, "utf-8") : "";

  if (layout === "single") {
    return { layout, markdown: head, scenes: [], storyboardPath, strayBeatIds: [] };
  }

  const headingAt = head.search(FIRST_HEADING_RE);
  const strayBeatIds =
    headingAt === -1 ? [] : parseStoryboard(head.slice(headingAt)).beats.map((b) => b.id);
  const preamble = headingAt === -1 ? head : head.slice(0, headingAt);

  const sections = await Promise.all(
    scenes.map(async (scene) => sceneToBeatSection(scene, await readFile(scene.path, "utf-8")))
  );
  const prefix = preamble.trimEnd();
  return {
    layout,
    markdown: `${prefix}${prefix ? "\n\n" : ""}${sections.join("\n")}`,
    scenes,
    storyboardPath,
    strayBeatIds,
  };
}

/** Convenience for the many call sites that only want the markdown. */
export async function loadStoryboardMarkdown(projectDir: string): Promise<string> {
  return (await loadStoryboard(projectDir)).markdown;
}

/** `01-hook.md` for order 1 and id `hook`. Two digits until a project needs three. */
export function sceneFilename(order: number, id: string): string {
  const width = order >= 100 ? 3 : 2;
  return `${String(order).padStart(width, "0")}-${basename(id)}.md`;
}

// ── Migration: single document -> scenes/ bundle ─────────────────────────

export interface MigrationPlanFile {
  /** Path relative to the project root, e.g. `scenes/01-hook.md`. */
  path: string;
  contents: string;
}

export interface MigrationPlan {
  /** Files to create, in play order. */
  scenes: MigrationPlanFile[];
  /** What STORYBOARD.md becomes: frontmatter + direction prose, no beats. */
  storyboard: MigrationPlanFile;
  /** Beat ids in the order they will play. */
  beatIds: string[];
}

/**
 * Render one beat as a standalone scene document.
 *
 * Cues become real frontmatter, which is the whole point of the bundle
 * layout. `type: Scene` is added so the file is a valid OKF document; the
 * loader strips it again on the way back in.
 */
export function beatToSceneFile(beat: Beat, order: number): MigrationPlanFile {
  const cues: Record<string, unknown> = { type: "Scene", ...(beat.cues ?? {}) };
  // `duration` is derivable from a `### Beat duration` subsection too, so
  // carry the resolved value rather than losing it with the subsection.
  if (cues.duration === undefined && beat.duration !== undefined) {
    cues.duration = beat.duration;
  }
  const front = stringifyYaml(cues, { lineWidth: 0 }).trimEnd();
  const body = beat.body.trim();
  return {
    path: `${SCENES_DIRNAME}/${sceneFilename(order, beat.id)}`,
    contents: `---\n${front}\n---\n\n${body}\n`,
  };
}

/**
 * Plan the conversion of a single-document storyboard into a bundle.
 *
 * Pure: returns the files to write without touching disk, so the command can
 * offer `--dry-run` and so the whole shape is testable.
 */
export function planMigration(markdown: string): MigrationPlan {
  const parsed = parseStoryboard(markdown);
  // `data` is null when the document has no frontmatter at all.
  const data = extractFrontmatter(markdown).data ?? {};

  const scenes = parsed.beats.map((beat, index) => beatToSceneFile(beat, index + 1));

  const frontBlock =
    Object.keys(data).length > 0
      ? `---\n${stringifyYaml(data, { lineWidth: 0 }).trimEnd()}\n---\n\n`
      : "";
  const prose = parsed.global.trim();
  const note =
    "Scenes live in `scenes/`, one file per scene, and play in filename order.";
  const storyboardBody = [prose, note].filter(Boolean).join("\n\n");

  return {
    scenes,
    storyboard: {
      path: STORYBOARD_FILENAME,
      contents: `${frontBlock}${storyboardBody}\n`,
    },
    beatIds: parsed.beats.map((beat) => beat.id),
  };
}

// ── Writing into a scenes/ bundle ────────────────────────────────────────

/** Locate one scene file by beat id. */
async function requireScene(projectDir: string, beatId: string): Promise<SceneFile> {
  const scenes = await listSceneFiles(projectDir);
  const scene = scenes.find((s) => s.id === beatId);
  if (!scene) {
    const known = scenes.map((s) => s.id).join(", ") || "(none)";
    throw new Error(`Scene "${beatId}" not found. Scenes in this project: ${known}.`);
  }
  return scene;
}

/**
 * Set or unset one cue in a scene file, rewriting only that file's
 * frontmatter and leaving its body untouched.
 *
 * Key validation and value coercion come from the same helpers the
 * single-document writer uses, so `duration: "abc"` is rejected identically
 * in both layouts.
 */
export async function setSceneCue(
  projectDir: string,
  opts: { beatId: string; key: string; value?: unknown; unset?: boolean }
): Promise<{ path: string; cues: BeatCues }> {
  if (!STORYBOARD_CUE_KEYS.includes(opts.key as StoryboardCueKey)) {
    throw new Error(
      `Unsupported cue "${opts.key}". Supported cues: ${STORYBOARD_CUE_KEYS.join(", ")}.`
    );
  }
  const scene = await requireScene(projectDir, opts.beatId);
  const raw = await readFile(scene.path, "utf-8");
  const { data, body } = extractFrontmatter(raw);
  const front: Record<string, unknown> = { ...(data ?? {}) };

  if (opts.unset) {
    delete front[opts.key];
  } else {
    front[opts.key] = normalizeCueValue(opts.key, opts.value);
  }
  // `type` stays first so the file keeps reading as an OKF Scene document.
  const ordered: Record<string, unknown> = {};
  if (front.type !== undefined) ordered.type = front.type;
  for (const [k, v] of Object.entries(front)) if (k !== "type") ordered[k] = v;

  const next = `---\n${stringifyYaml(ordered, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trim()}\n`;
  await writeFile(scene.path, next, "utf-8");

  const cues = { ...ordered };
  delete cues.type;
  // The file may still hold keys outside the vocabulary from a hand edit.
  // Surfacing those is `vibe storyboard validate`'s job, not this writer's.
  return { path: scene.path, cues: cues as BeatCues };
}

/**
 * Reorder scenes by renumbering their filename prefixes.
 *
 * Renames go through a temporary name first. Renaming `02 -> 01` while an
 * `01` still exists would clobber it, and no ordering of direct renames is
 * safe for an arbitrary permutation.
 */
export async function moveScene(
  projectDir: string,
  opts: { beatId: string; afterBeatId: string }
): Promise<string[]> {
  const scenes = await listSceneFiles(projectDir);
  const from = scenes.findIndex((s) => s.id === opts.beatId);
  if (from === -1) throw new Error(`Scene "${opts.beatId}" not found.`);
  const after = scenes.findIndex((s) => s.id === opts.afterBeatId);
  if (after === -1) throw new Error(`Scene "${opts.afterBeatId}" not found.`);
  if (opts.beatId === opts.afterBeatId) return scenes.map((s) => s.id);

  const ordered = [...scenes];
  const [moving] = ordered.splice(from, 1);
  ordered.splice(from < after ? after : after + 1, 0, moving);

  const dir = join(projectDir, SCENES_DIRNAME);
  const staged = ordered.map((scene, index) => ({
    scene,
    temp: join(dir, `.vibe-move-${index}-${scene.filename}`),
    final: join(dir, sceneFilename(index + 1, scene.id)),
  }));

  for (const { scene, temp } of staged) await rename(scene.path, temp);
  for (const { temp, final } of staged) await rename(temp, final);

  return ordered.map((s) => s.id);
}

/**
 * Write a migration plan to disk.
 *
 * Scene files land before STORYBOARD.md is rewritten, so a failure part way
 * through leaves the original single-file storyboard as the source of truth
 * rather than a half-emptied document. Shared by `storyboard migrate` and by
 * `vibe init`, which scaffolds straight into the bundle layout.
 */
export async function writeMigration(projectDir: string, plan: MigrationPlan): Promise<void> {
  await mkdir(join(projectDir, SCENES_DIRNAME), { recursive: true });
  for (const file of plan.scenes) {
    await writeFile(join(projectDir, file.path), file.contents, "utf-8");
  }
  await writeFile(join(projectDir, plan.storyboard.path), plan.storyboard.contents, "utf-8");
}

/**
 * Scaffold a bundle from a single-document storyboard string.
 *
 * `vibe init` builds its starter (and its `--from` draft) as one markdown
 * document, then hands it here rather than writing it out. That keeps one
 * generator for the content and one converter for the layout, instead of a
 * second scaffolder that could drift from the first.
 */
export async function writeStoryboardAsBundle(
  projectDir: string,
  markdown: string
): Promise<MigrationPlan> {
  const plan = planMigration(markdown);
  await writeMigration(projectDir, plan);
  return plan;
}

/**
 * Validation issues for beat headings left in STORYBOARD.md after a project
 * became a bundle.
 *
 * An error, not a warning: the headings look like scenes and are not being
 * rendered, so the project on disk does not describe the video that comes
 * out. Anything less than an error lets that gap sit unnoticed.
 */
export function strayBeatIssues(strayBeatIds: string[]): Array<{
  severity: "error";
  code: "STRAY_BEATS_IN_STORYBOARD";
  message: string;
  beatId: string;
}> {
  return strayBeatIds.map((beatId) => ({
    severity: "error" as const,
    code: "STRAY_BEATS_IN_STORYBOARD" as const,
    beatId,
    message:
      `STORYBOARD.md still contains a "## Beat ${beatId}" section, but this project ` +
      `uses scenes/. That heading is ignored. Move it to scenes/ as its own file, ` +
      `or delete it from STORYBOARD.md.`,
  }));
}
