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
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { stringify as stringifyYaml } from "yaml";

import { extractFrontmatter } from "./frontmatter.js";
import { deriveBeatId } from "./storyboard-parse.js";

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
  const { data, body } = extractFrontmatter(contents);
  const cues: Record<string, unknown> = { ...data };
  delete cues.type;

  const cueBlock =
    Object.keys(cues).length > 0
      ? "```yaml\n" + stringifyYaml(cues, { lineWidth: 0 }).trimEnd() + "\n```\n\n"
      : "";
  const prose = body.trim();
  return `## Beat ${scene.id} - ${humanise(scene.id)}\n\n${cueBlock}${prose}\n`;
}

/**
 * Load a project's storyboard as a single markdown document, whichever
 * layout it uses on disk.
 *
 * For a bundle this concatenates `STORYBOARD.md` (frontmatter + direction
 * prose, with any stray beat headings left alone) and one synthesized
 * section per scene file.
 */
export async function loadStoryboard(projectDir: string): Promise<LoadedStoryboard> {
  const storyboardPath = join(projectDir, STORYBOARD_FILENAME);
  const scenes = await listSceneFiles(projectDir);
  const layout = detectStoryboardLayout(projectDir, scenes.length);

  if (layout === "missing") {
    return { layout, markdown: "", scenes: [], storyboardPath };
  }

  const head = existsSync(storyboardPath) ? await readFile(storyboardPath, "utf-8") : "";

  if (layout === "single") {
    return { layout, markdown: head, scenes: [], storyboardPath };
  }

  const sections = await Promise.all(
    scenes.map(async (scene) => sceneToBeatSection(scene, await readFile(scene.path, "utf-8")))
  );
  const prefix = head.trimEnd();
  return {
    layout,
    markdown: `${prefix}${prefix ? "\n\n" : ""}${sections.join("\n")}`,
    scenes,
    storyboardPath,
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
