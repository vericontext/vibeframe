/**
 * @module _shared/storyboard-draft
 *
 * The offline storyboard skeleton `vibe init --from "<brief>"` writes.
 *
 * Without a model this cannot know what the video says, so it does not
 * pretend to: beats come from the brief's own outline when it has one
 * ("hook, buoyancy, folding tip"), each beat gets a backdrop prompt from
 * its topic and the brief, and narration is left for the composer
 * (`storyboard revise`), the host agent, or the user to write. A skeleton
 * that renders silently is better than one that narrates someone else's
 * script. When a composer key is set, `init` hands this skeleton to the
 * composer, which writes the real draft.
 */

import { buildDesignMd } from "./scene-project.js";
import type { VisualStyle } from "./visual-styles.js";

export interface StoryboardDraft {
  storyboardMd: string;
  designMd: string;
  warnings: string[];
}

interface BeatDraft {
  id: string;
  title: string;
  duration: number;
  backdrop: string;
  motion: string;
  body: string;
}

const MAX_OUTLINE_BEATS = 8;

export function draftStoryboardFromBrief(opts: {
  name: string;
  brief: string;
  durationSec?: number;
  aspect?: string;
  visualStyle?: VisualStyle;
}): StoryboardDraft {
  const total = Number.isFinite(opts.durationSec) && opts.durationSec && opts.durationSec > 0
    ? opts.durationSec
    : 45;
  const brief = opts.brief.trim().replace(/\s+/g, " ");
  const title = extractProductName(brief) ?? titleizeProjectName(opts.name);
  const subject = describeSubject(brief);
  const topics = outlineTopics(brief) ?? defaultTopics(total);
  const durations = splitDuration(total, topics.length);
  const beats = topics.map((topic, index): BeatDraft => ({
    id: uniqueId(topics, index),
    title: titleize(topic),
    duration: durations[index],
    backdrop: clip(`${titleize(topic)}: ${subject}. No readable text, no logos, clean negative space for overlays`),
    motion: index === 0
      ? "headline reveal, restrained camera push"
      : index === topics.length - 1
        ? "clean final title, slow settle, gentle fade out"
        : "focused reveal of the beat's one idea, precise transitions",
    body: `Topic: ${topic}. Write the narration for this beat.`,
  }));

  const storyboardMd = `---
type: Storyboard
title: ${JSON.stringify(title)}
duration: ${total}
aspect: ${opts.aspect ?? "16:9"}
providers:
  tts: auto
  image: openai
---

# ${title} - Storyboard

Pacing: keep beats 6-15 seconds. Longer beats render as static, overstuffed
scenes - split them instead.

Brief: ${brief}

${beats.map(renderBeatDraft).join("\n\n")}
`;

  return {
    storyboardMd,
    designMd: buildDesignMd({ name: title, style: opts.visualStyle }),
    warnings: [
      "Offline skeleton: beats have no narration yet. Run `vibe storyboard revise <project> --from \"<brief>\"` with a composer key, or write the narration in scenes/*.md, before building.",
    ],
  };
}

function renderBeatDraft(beat: BeatDraft): string {
  return `## Beat ${beat.id} - ${beat.title}

\`\`\`yaml
duration: ${beat.duration}
backdrop: "${escapeCue(beat.backdrop)}"
motion: "${escapeCue(beat.motion)}"
\`\`\`

${beat.body}`;
}

/** Where a brief's own outline starts: a numbered list, or a list after a colon. */
const NUMBERED = /(?:^|\s)1[.)]\s+/;

/**
 * The beats a brief lists itself, as in "...: hook, buoyancy, folding tip"
 * or "... 1. what it is 2. the formula". Null when it has no outline.
 */
function outlineTopics(brief: string): string[] | null {
  const numbered = brief.search(NUMBERED);
  const items = numbered >= 0
    ? brief.slice(numbered).split(/(?:^|\s)\d+[.)]\s+/)
    : brief.includes(":")
      ? brief.slice(brief.indexOf(":") + 1).split(/,|;|\band\b|\bthen\b/i)
      : [];
  const topics = items.map((item) => item.trim().replace(/[.;,]+$/, "")).filter(Boolean);
  if (topics.length < 2 || topics.some((topic) => topic.split(/\s+/).length > 6)) return null;
  return topics.slice(0, MAX_OUTLINE_BEATS);
}

function defaultTopics(total: number): string[] {
  return total >= 20 ? ["hook", "setup", "payoff", "close"] : ["hook", "point", "close"];
}

/** The brief without its duration or outline, for backdrop prompts. */
function describeSubject(brief: string): string {
  const numbered = brief.search(NUMBERED);
  const end = numbered >= 0 ? numbered : brief.includes(":") ? brief.indexOf(":") : brief.length;
  const head = brief.slice(0, end).replace(/[\s:-]+$/, "");
  return head
    .replace(/\b(an?)\s+\d+(?:\.\d+)?[- ]?(?:seconds?|secs?|s)\b[- ]?/gi, "a ")
    .replace(/\b\d+(?:\.\d+)?[- ]?(?:seconds?|secs?)\b[- ]?/gi, "")
    .replace(/\ba ([aeiou])/gi, (_, vowel: string) => `an ${vowel}`)
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "")
    .trim() || "the subject of the brief";
}

function uniqueId(topics: string[], index: number): string {
  const slug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "beat";
  const id = slug(topics[index]);
  const earlier = topics.slice(0, index).filter((topic) => slug(topic) === id).length;
  return earlier === 0 ? id : `${id}-${earlier + 1}`;
}

function splitDuration(total: number, count: number): number[] {
  const base = Math.max(1, Math.floor((total / count) * 10) / 10);
  const out = Array.from({ length: count }, () => base);
  const used = base * count;
  out[out.length - 1] = Number(Math.max(1, total - used + base).toFixed(1));
  return out;
}

/** Cut at a word boundary so a prompt never ends mid-word. */
function clip(value: string, max = 180): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:\s]+$/, "");
}

function escapeCue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function titleize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractProductName(brief: string): string | null {
  const patterns = [
    /\b(?:for|called|named)\s+([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})\b/,
    /\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,3})\s+(?:launch|promo|video|story)\b/,
  ];
  for (const pattern of patterns) {
    const match = brief.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function titleizeProjectName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Video";
}
