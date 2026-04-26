/**
 * @module _shared/storyboard-parse
 *
 * Parses a STORYBOARD.md document into the shape `compose-scenes-with-skills`
 * (v0.59+) needs: a `global` direction block (everything before the first
 * `## Beat …` heading) plus an array of `beats`.
 *
 * The format follows Hyperframes' step-4-storyboard.md convention — see
 * `tests/v059-preflight/fixtures/STORYBOARD.md` for an exemplar — but stays
 * forgiving on small variations (em-dash vs hyphen vs colon between
 * "Beat N" and the title; explicit "Beat" prefix optional).
 *
 * v0.60 adds optional YAML cue extraction so a `vibe scene build` driver can
 * dispatch TTS / image-gen / duration without separate flags:
 *   - **Project frontmatter** — `---\n…yaml…\n---` at the top of the file
 *     (standard markdown frontmatter). Holds project-wide defaults like
 *     providers, voice, default duration. Stripped from `global`.
 *   - **Per-beat cues** — the FIRST ```yaml fenced block inside a beat body,
 *     parsed into `Beat.cues`. Stripped from `body` so the LLM prompt
 *     stays free of machine-only metadata.
 * Both are back-compat: storyboards without frontmatter or yaml blocks
 * parse exactly as before.
 *
 * Pure function. No I/O.
 */

import { parse as parseYaml } from "yaml";

export interface ParsedStoryboard {
  /**
   * Markdown content before the first `## …` heading. Holds project-wide
   * direction (format, audio, style basis). Trimmed; may be empty.
   * **Project frontmatter (`---\n…\n---`) is stripped from this field.**
   */
  global: string;
  /** One entry per `## …` heading. Order matches the document. */
  beats: Beat[];
  /**
   * Project-level YAML frontmatter parsed from the top of the document, if
   * present. Holds defaults the `vibe scene build` driver applies to every
   * beat unless overridden by a per-beat cue. Undefined when no frontmatter
   * was present.
   */
  frontmatter?: ProjectFrontmatter;
}

/**
 * Project-level cues from the document's top frontmatter. All fields are
 * optional — the driver (or user) supplies CLI-flag fallbacks.
 *
 * Index signature stays open so projects can stash custom keys (e.g. brand
 * colour palette overrides) without TypeScript pushback.
 */
export interface ProjectFrontmatter {
  /** Slug for the project — informational, not used by the parser. */
  project?: string;
  /**
   * Per-primitive provider preferences. Keys match the CLI's `--tts`,
   * `--image-provider`, `--music-provider` flags.
   */
  providers?: {
    tts?: string;
    image?: string;
    music?: string;
  };
  /** Default voice id for TTS (provider-specific — see `--voice` flag). */
  voice?: string;
  /** Default beat duration in seconds when a beat omits both cue and `### Beat duration`. */
  defaultDuration?: number;
  /** Visual identity preset hint (informational; e.g. "Swiss Pulse"). */
  style?: string;
  [key: string]: unknown;
}

/**
 * Per-beat cues extracted from the first ```yaml fenced block inside a beat
 * body. The driver passes these to TTS / image / compose calls so the
 * storyboard alone is enough source for `vibe scene build`.
 */
export interface BeatCues {
  /** Narration text for this beat (drives TTS + scene `<audio>` element). */
  narration?: string;
  /** Image prompt for the backdrop generation (drives T2I). */
  backdrop?: string;
  /** Beat duration in seconds — overrides `### Beat duration` subsection if both present. */
  duration?: number;
  /** Voice override for this beat (overrides project frontmatter `voice`). */
  voice?: string;
  [key: string]: unknown;
}

export interface Beat {
  /**
   * Stable id for the beat. Derivation order:
   *   1. `## Beat <ID> [— or - or :] [Title]` → "<ID>" (lowercased, slugified
   *      if non-alphanumeric — e.g. "1", "hook", "scene-2").
   *   2. `## <Title>` (no Beat prefix) → slug(<Title>).
   * Always non-empty, kebab-case-or-numeric.
   */
  id: string;
  /** The full original heading line (without the leading `## `). */
  heading: string;
  /**
   * Markdown body of the beat, including any nested `### …` subsections.
   * Trimmed. Excludes the `## …` line itself. **The leading ```yaml cue
   * block (if present) is stripped** so this field stays clean for LLM
   * prompts.
   */
  body: string;
  /**
   * Beat duration in seconds, derived from (in priority order):
   *   1. `cues.duration` (per-beat YAML)
   *   2. `### Beat duration` subsection
   * Undefined when neither is present.
   */
  duration?: number;
  /**
   * Per-beat cues parsed from the first ```yaml block inside the body.
   * Undefined when no yaml block was present.
   */
  cues?: BeatCues;
}

const HEADING_RE = /^##\s+(.+?)\s*$/gm;
// "Beat <id> <sep> <title>" — separator MUST have whitespace on both sides so
// hyphens inside the id (e.g. "scene-2") aren't consumed as the separator.
const BEAT_PREFIX_RE = /^Beat\s+(.+?)\s+(?:—|:|-)\s+(.+)$/i;
const DURATION_SUBSECTION_RE = /###\s+Beat\s+duration\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i;
// Capture optional minus so a "-3" body doesn't sneak in as 3.
const DURATION_VALUE_RE = /(-?\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?/i;
// Top-of-file YAML frontmatter, standard markdown convention. Closing fence
// must start at column 0 to avoid eating fenced ```yaml inside a beat.
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
// First ```yaml fenced block inside a beat body. Anchored to the start of the
// body so we only treat a leading cue block as machine metadata; ```yaml
// blocks deeper in the body are left as illustrative content.
const BEAT_CUES_RE = /^\s*```ya?ml\s*\n([\s\S]*?)\n```\s*(?:\n|$)/;

/**
 * Parse a STORYBOARD.md document into structured beats.
 *
 * Empty input → `{ global: "", beats: [] }`.
 * Input with no `##` headings → `{ global: <whole doc>, beats: [] }`.
 */
export function parseStoryboard(md: string): ParsedStoryboard {
  const normalized = md.replace(/\r\n/g, "\n");

  // Strip + parse top frontmatter (if present) before any heading scan,
  // so a heading-shaped line inside the frontmatter wouldn't fool the
  // beat splitter.
  const { frontmatter, remaining } = extractProjectFrontmatter(normalized);
  const text = remaining;

  // Find every `## …` heading position. We re-iterate the regex because
  // `String.matchAll` doesn't return offsets in older Node versions
  // we still target.
  const headings: Array<{ start: number; end: number; line: string }> = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(text)) !== null) {
    headings.push({
      start: m.index,
      end: m.index + m[0].length,
      line: m[1].trim(),
    });
  }

  if (headings.length === 0) {
    return {
      global: text.trim(),
      beats: [],
      ...(frontmatter ? { frontmatter } : {}),
    };
  }

  const global = text.slice(0, headings[0].start).trim();

  const beats: Beat[] = headings.map((h, i) => {
    const bodyStart = h.end;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].start : text.length;
    const rawBody = text.slice(bodyStart, bodyEnd).trim();
    const { cues, body } = extractBeatCues(rawBody);
    const id = deriveBeatId(h.line);
    // Cue duration wins over the `### Beat duration` subsection — it's the
    // explicit machine-readable hint, while the subsection is prose for the
    // composer LLM.
    const duration = cues?.duration ?? parseBeatDuration(body);
    return {
      id,
      heading: h.line,
      body,
      ...(duration !== undefined ? { duration } : {}),
      ...(cues ? { cues } : {}),
    };
  });

  return {
    global,
    beats,
    ...(frontmatter ? { frontmatter } : {}),
  };
}

/**
 * Strip a leading `---\n…\n---` YAML frontmatter block and return the parsed
 * value. Returns `{ frontmatter: undefined, remaining: input }` when there's
 * no frontmatter, when the YAML doesn't parse, or when the parsed root isn't
 * an object — graceful degradation, since the downstream caller can always
 * fall back on CLI flags.
 */
export function extractProjectFrontmatter(md: string): {
  frontmatter: ProjectFrontmatter | undefined;
  remaining: string;
} {
  const match = md.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: undefined, remaining: md };
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch {
    return { frontmatter: undefined, remaining: md };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { frontmatter: undefined, remaining: md };
  }
  return {
    frontmatter: parsed as ProjectFrontmatter,
    remaining: md.slice(match[0].length),
  };
}

/**
 * Pull a leading ```yaml cue block off a beat body and return both the parsed
 * cues and the remaining body (cues stripped). Mirrors
 * `extractProjectFrontmatter`'s "swallow only when valid" behaviour.
 */
export function extractBeatCues(body: string): {
  cues: BeatCues | undefined;
  body: string;
} {
  const match = body.match(BEAT_CUES_RE);
  if (!match) return { cues: undefined, body };
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1]);
  } catch {
    return { cues: undefined, body };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { cues: undefined, body };
  }
  return {
    cues: parsed as BeatCues,
    body: body.slice(match[0].length).trim(),
  };
}

/**
 * Derive a stable id from a `## …` heading line (the part after `## `).
 *
 * Examples:
 *   "Beat 1 — Hook"       → "1"
 *   "Beat hook : Intro"   → "hook"
 *   "Beat 2 - Core"       → "2"
 *   "Hook"                → "hook"
 *   "Hook (3 seconds)"    → "hook"
 */
export function deriveBeatId(headingLine: string): string {
  const beatPrefix = headingLine.match(BEAT_PREFIX_RE);
  if (beatPrefix) {
    return slugify(beatPrefix[1]);
  }
  // No "Beat" prefix — use the first slug-token of the heading.
  // "Hook (3 seconds)" → "hook"
  // "The Big Reveal"   → "the-big-reveal"
  return slugify(headingLine);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")    // strip diacritics
    .replace(/\([^)]*\)/g, "")            // drop parenthesised tail "(3s)"
    .replace(/[^a-z0-9]+/g, "-")          // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "")              // trim
    || "beat";
}

/**
 * Look for a `### Beat duration` subsection inside a beat body and parse
 * the first number. Returns undefined when absent or unparseable.
 */
export function parseBeatDuration(body: string): number | undefined {
  const sub = body.match(DURATION_SUBSECTION_RE);
  if (!sub) return undefined;
  const valueMatch = sub[1].match(DURATION_VALUE_RE);
  if (!valueMatch) return undefined;
  const n = parseFloat(valueMatch[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
