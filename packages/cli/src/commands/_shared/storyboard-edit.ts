import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  beatCharacterNames,
  deriveBeatId,
  parseStoryboard,
  type Beat,
  type BeatCues,
} from "./storyboard-parse.js";

export const STORYBOARD_CUE_KEYS = [
  "duration",
  "narration",
  "backdrop",
  "video",
  "motion",
  "voice",
  "music",
  "asset",
  "characters",
] as const;

export type StoryboardCueKey = (typeof STORYBOARD_CUE_KEYS)[number];

export interface StoryboardValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  beatId?: string;
}

export interface StoryboardValidationResult {
  ok: boolean;
  beats: Beat[];
  issues: StoryboardValidationIssue[];
}

export type StoryboardBeatUpsertAction = "replaced-starter" | "appended" | "updated";

export interface StoryboardBeatUpsertInput {
  beatId: string;
  title?: string;
  duration?: number;
  narration?: string;
  backdrop?: string;
  body?: string;
}

export interface StoryboardBeatUpsertResult {
  markdown: string;
  action: StoryboardBeatUpsertAction;
}

interface BeatSection {
  id: string;
  heading: string;
  start: number;
  headingEnd: number;
  end: number;
  raw: string;
  body: string;
}

const HEADING_RE = /^##\s+(.+?)\s*$/gm;
const LEADING_CUE_RE = /^(\s*)```ya?ml\s*\n([\s\S]*?)\n```\s*(?:\n|$)/;
const ALLOWED_CUE_KEYS = new Set<string>(STORYBOARD_CUE_KEYS);
const STRING_CUE_KEYS = new Set<string>(["narration", "backdrop", "video", "motion", "voice", "music", "asset"]);

/** Beats beyond this render as static, overstuffed scenes. */
export const MAX_RECOMMENDED_BEAT_SEC = 15;

export function validateStoryboardMarkdown(markdown: string): StoryboardValidationResult {
  const parsed = parseStoryboard(markdown);
  const sections = splitBeatSections(markdown);
  const issues: StoryboardValidationIssue[] = [];

  if (parsed.beats.length === 0) {
    issues.push({
      severity: "error",
      code: "NO_BEATS",
      message: "STORYBOARD.md must contain at least one `## Beat ...` heading.",
    });
  }

  const seen = new Map<string, number>();
  for (const beat of parsed.beats) {
    seen.set(beat.id, (seen.get(beat.id) ?? 0) + 1);
  }
  for (const [id, count] of seen.entries()) {
    if (count > 1) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_BEAT_ID",
        beatId: id,
        message: `Beat id "${id}" appears ${count} times. Beat ids must be unique.`,
      });
    }
  }

  for (const section of sections) {
    const cueBlock = readLeadingCueBlock(section.body);
    if (cueBlock?.error) {
      issues.push({
        severity: "error",
        code: "MALFORMED_CUE_YAML",
        beatId: section.id,
        message: `Beat "${section.id}" has malformed YAML cues: ${cueBlock.error}`,
      });
    }
  }

  const characterPool = new Set<string>(
    Object.keys(
      (parsed.frontmatter?.characters as Record<string, unknown> | undefined) ?? {}
    )
  );
  for (const beat of parsed.beats) {
    const cues = beat.cues ?? {};
    for (const [key, value] of Object.entries(cues)) {
      if (!ALLOWED_CUE_KEYS.has(key)) {
        issues.push({
          severity: "warning",
          code: "UNKNOWN_CUE",
          beatId: beat.id,
          message: `Beat "${beat.id}" uses unknown cue "${key}". Supported cues: ${STORYBOARD_CUE_KEYS.join(", ")}.`,
        });
        continue;
      }
      if (key === "characters") {
        const validShape =
          typeof value === "string" ||
          (Array.isArray(value) && value.every((v) => typeof v === "string"));
        if (!validShape) {
          issues.push({
            severity: "error",
            code: "INVALID_CHARACTERS_VALUE",
            beatId: beat.id,
            message: `Beat "${beat.id}" cue "characters" must be a character name or a list of names.`,
          });
          continue;
        }
        for (const name of beatCharacterNames({ characters: value } as BeatCues)) {
          if (!characterPool.has(name)) {
            issues.push({
              severity: "warning",
              code: "UNKNOWN_CHARACTER",
              beatId: beat.id,
              message: `Beat "${beat.id}" references character "${name}" not defined in the frontmatter \`characters:\` pool.`,
            });
          }
        }
        continue;
      }
      if (key === "duration") {
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push({
            severity: "error",
            code: "INVALID_DURATION",
            beatId: beat.id,
            message: `Beat "${beat.id}" cue "duration" must be a positive number of seconds.`,
          });
        }
        continue;
      }
      if (STRING_CUE_KEYS.has(key) && typeof value !== "string") {
        issues.push({
          severity: "error",
          code: "INVALID_CUE_VALUE",
          beatId: beat.id,
          message: `Beat "${beat.id}" cue "${key}" must be a string.`,
        });
      }
    }
  }

  // Pacing guard: beats much longer than ~15s render as static, overstuffed
  // scenes (one layout cannot carry 20-30s of narration). Warn so the agent
  // splits them before composing.
  for (const beat of parsed.beats) {
    if (beat.duration !== undefined && beat.duration > MAX_RECOMMENDED_BEAT_SEC) {
      issues.push({
        severity: "warning",
        code: "BEAT_DURATION_TOO_LONG",
        beatId: beat.id,
        message:
          `Beat "${beat.id}" is ${beat.duration}s — beats longer than ` +
          `${MAX_RECOMMENDED_BEAT_SEC}s render static and overstuffed. Split it into ` +
          `6-15s beats (a 90s video should have 6-8 beats).`,
      });
    }
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    beats: parsed.beats,
    issues,
  };
}

export function getStoryboardBeat(markdown: string, beatId: string): Beat | null {
  return parseStoryboard(markdown).beats.find((beat) => beat.id === beatId) ?? null;
}

export function upsertStoryboardBeat(
  markdown: string,
  opts: StoryboardBeatUpsertInput
): StoryboardBeatUpsertResult {
  const beatId = normalizeBeatId(opts.beatId);
  const sections = splitBeatSections(markdown);
  const existing = sections.find((section) => section.id === beatId);
  const cues = storyboardCuesFromInput(opts);

  if (existing) {
    let next = markdown;
    for (const [key, value] of Object.entries(cues)) {
      next = setStoryboardCue(next, { beatId, key, value });
    }
    return { markdown: next, action: "updated" };
  }

  const section = buildStoryboardBeatSection({ ...opts, beatId, cues });
  if (sections.length > 0 && isStarterStoryboard(markdown)) {
    const global = markdown.slice(0, sections[0].start).trimEnd();
    return {
      markdown: `${global}\n\n${section}`,
      action: "replaced-starter",
    };
  }

  const prefix = markdown.trimEnd();
  return {
    markdown: `${prefix}${prefix ? "\n\n" : ""}${section}`,
    action: "appended",
  };
}

export function setStoryboardCue(markdown: string, opts: {
  beatId: string;
  key: string;
  value?: unknown;
  unset?: boolean;
}): string {
  const section = findBeatSection(markdown, opts.beatId);
  if (!section) {
    throw new Error(`Beat "${opts.beatId}" not found.`);
  }
  if (!ALLOWED_CUE_KEYS.has(opts.key)) {
    throw new Error(`Unsupported cue "${opts.key}". Supported cues: ${STORYBOARD_CUE_KEYS.join(", ")}.`);
  }

  const cue = readLeadingCueBlock(section.body);
  if (cue?.error) {
    throw new Error(`Cannot edit malformed YAML cues for beat "${opts.beatId}": ${cue.error}`);
  }

  const cues: Record<string, unknown> = cue?.value ? { ...cue.value } : {};
  if (opts.unset) {
    delete cues[opts.key];
  } else {
    cues[opts.key] = normalizeCueValue(opts.key, opts.value);
  }

  const remainingBody = cue
    ? section.body.slice(cue.full.length).replace(/^\s*\n/, "")
    : section.body.replace(/^\s*\n/, "");
  const cueBlock = Object.keys(cues).length > 0
    ? "```yaml\n" + stringifyYaml(cues, { lineWidth: 0 }).trimEnd() + "\n```\n\n"
    : "";
  const nextBody = cueBlock + remainingBody.trimStart();
  const nextSection = section.raw.slice(0, section.headingEnd - section.start) + "\n\n" + nextBody.trimEnd() + "\n";
  return markdown.slice(0, section.start) + nextSection + markdown.slice(section.end);
}

export function moveStoryboardBeat(markdown: string, opts: {
  beatId: string;
  afterBeatId: string;
}): string {
  if (opts.beatId === opts.afterBeatId) return markdown;
  const sections = splitBeatSections(markdown);
  const movingIndex = sections.findIndex((section) => section.id === opts.beatId);
  if (movingIndex === -1) throw new Error(`Beat "${opts.beatId}" not found.`);
  const afterIndex = sections.findIndex((section) => section.id === opts.afterBeatId);
  if (afterIndex === -1) throw new Error(`Beat "${opts.afterBeatId}" not found.`);

  const global = sections.length > 0 ? markdown.slice(0, sections[0].start) : markdown;
  const chunks = sections.map((section) => section.raw);
  const [moving] = chunks.splice(movingIndex, 1);
  const adjustedAfterIndex = movingIndex < afterIndex ? afterIndex - 1 : afterIndex;
  chunks.splice(adjustedAfterIndex + 1, 0, moving);

  return global + normalizeBeatChunks(chunks);
}

function normalizeBeatChunks(chunks: string[]): string {
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .join("\n\n") + "\n";
}

function normalizeBeatId(id: string): string {
  return deriveBeatId(id);
}

function storyboardCuesFromInput(
  opts: StoryboardBeatUpsertInput
): Record<StoryboardCueKey, unknown> {
  const cues: Partial<Record<StoryboardCueKey, unknown>> = {};
  if (opts.duration !== undefined) cues.duration = opts.duration;
  if (opts.narration && opts.narration.trim()) cues.narration = opts.narration.trim();
  if (opts.backdrop && opts.backdrop.trim()) cues.backdrop = opts.backdrop.trim();
  return cues as Record<StoryboardCueKey, unknown>;
}

function buildStoryboardBeatSection(
  opts: StoryboardBeatUpsertInput & { cues: Record<StoryboardCueKey, unknown> }
): string {
  const title = normalizeTitle(opts.title ?? humanizeBeatId(opts.beatId));
  const cueBlock =
    Object.keys(opts.cues).length > 0
      ? "```yaml\n" + stringifyYaml(opts.cues, { lineWidth: 0 }).trimEnd() + "\n```\n\n"
      : "";
  const body =
    opts.body?.trim() ||
    "Scene created with `vibe scene add`. Edit this body if the build flow should recompose it.";
  return `## Beat ${opts.beatId} - ${title}\n\n${cueBlock}${body.trimEnd()}\n`;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "Scene";
}

function humanizeBeatId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Scene";
}

function isStarterStoryboard(markdown: string): boolean {
  const parsed = parseStoryboard(markdown);
  if (parsed.beats.length !== 3) return false;
  const ids = parsed.beats.map((beat) => beat.id);
  if (ids.join(",") !== "hook,proof,close") return false;
  return (
    markdown.includes("Introduce the promise in one crisp sentence.") &&
    markdown.includes("Show the mechanism or proof point that makes the promise believable.") &&
    markdown.includes("Close with the action the viewer should remember.")
  );
}

function normalizeCueValue(key: string, value: unknown): unknown {
  if (key === "duration") {
    const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("Cue duration must be a positive number.");
    }
    return n;
  }
  if (typeof value !== "string") return value;
  return value.trim();
}

function splitBeatSections(markdown: string): BeatSection[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const headings: Array<{ start: number; end: number; line: string }> = [];
  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(normalized)) !== null) {
    headings.push({ start: match.index, end: match.index + match[0].length, line: match[1].trim() });
  }
  return headings.map((heading, index) => {
    const end = index + 1 < headings.length ? headings[index + 1].start : normalized.length;
    return {
      id: deriveBeatId(heading.line),
      heading: heading.line,
      start: heading.start,
      headingEnd: heading.end,
      end,
      raw: normalized.slice(heading.start, end),
      body: normalized.slice(heading.end, end).trim(),
    };
  });
}

function findBeatSection(markdown: string, beatId: string): BeatSection | null {
  return splitBeatSections(markdown).find((section) => section.id === beatId) ?? null;
}

function readLeadingCueBlock(body: string): {
  full: string;
  value?: BeatCues;
  error?: string;
} | null {
  const match = body.match(LEADING_CUE_RE);
  if (!match) return null;
  try {
    const parsed = parseYaml(match[2]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { full: match[0], error: "cue block must parse to a YAML object" };
    }
    return { full: match[0], value: parsed as BeatCues };
  } catch (error) {
    return { full: match[0], error: error instanceof Error ? error.message : String(error) };
  }
}
