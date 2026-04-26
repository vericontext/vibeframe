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
 * Pure function. No I/O.
 */

export interface ParsedStoryboard {
  /**
   * Markdown content before the first `## …` heading. Holds project-wide
   * direction (format, audio, style basis). Trimmed; may be empty.
   */
  global: string;
  /** One entry per `## …` heading. Order matches the document. */
  beats: Beat[];
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
   * Trimmed. Excludes the `## …` line itself.
   */
  body: string;
  /**
   * Beat duration in seconds, if a `### Beat duration` subsection is present
   * (parses both "3" and "3 seconds" / "3s" forms). Undefined when absent —
   * caller decides how to derive duration (typically from narration audio).
   */
  duration?: number;
}

const HEADING_RE = /^##\s+(.+?)\s*$/gm;
// "Beat <id> <sep> <title>" — separator MUST have whitespace on both sides so
// hyphens inside the id (e.g. "scene-2") aren't consumed as the separator.
const BEAT_PREFIX_RE = /^Beat\s+(.+?)\s+(?:—|:|-)\s+(.+)$/i;
const DURATION_SUBSECTION_RE = /###\s+Beat\s+duration\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/i;
// Capture optional minus so a "-3" body doesn't sneak in as 3.
const DURATION_VALUE_RE = /(-?\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)?/i;

/**
 * Parse a STORYBOARD.md document into structured beats.
 *
 * Empty input → `{ global: "", beats: [] }`.
 * Input with no `##` headings → `{ global: <whole doc>, beats: [] }`.
 */
export function parseStoryboard(md: string): ParsedStoryboard {
  const text = md.replace(/\r\n/g, "\n");

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
    return { global: text.trim(), beats: [] };
  }

  const global = text.slice(0, headings[0].start).trim();

  const beats: Beat[] = headings.map((h, i) => {
    const bodyStart = h.end;
    const bodyEnd = i + 1 < headings.length ? headings[i + 1].start : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    const id = deriveBeatId(h.line);
    const duration = parseBeatDuration(body);
    return {
      id,
      heading: h.line,
      body,
      ...(duration !== undefined ? { duration } : {}),
    };
  });

  return { global, beats };
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
