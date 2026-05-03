import { buildDesignMd } from "./scene-project.js";
import type { VisualStyle } from "./visual-styles.js";

export interface StoryboardDraft {
  storyboardMd: string;
  designMd: string;
  warnings: string[];
}

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
  const product = extractProductName(brief) ?? titleizeProjectName(opts.name);
  const beatCount = total >= 20 ? 4 : 3;
  const beatDurations = splitDuration(total, beatCount);
  const theme = describeTheme(brief, product);
  const beats = beatCount === 4
    ? fourBeatDraft({ product, brief, theme, durations: beatDurations })
    : threeBeatDraft({ product, brief, theme, durations: beatDurations });

  const storyboardMd = `---
title: ${JSON.stringify(product)}
duration: ${total}
aspect: ${opts.aspect ?? "16:9"}
providers:
  tts: auto
  image: openai
---

# ${product} - Storyboard

Brief: ${brief}

${beats.map(renderBeatDraft).join("\n\n")}
`;

  return {
    storyboardMd,
    designMd: buildDesignMd({ name: product, style: opts.visualStyle }),
    warnings: [
      "Drafted locally from the brief. Review STORYBOARD.md and DESIGN.md before provider spend.",
    ],
  };
}

interface BeatDraft {
  id: string;
  title: string;
  duration: number;
  narration: string;
  backdrop: string;
  motion: string;
  body: string;
}

function fourBeatDraft(opts: {
  product: string;
  brief: string;
  theme: string;
  durations: number[];
}): BeatDraft[] {
  const scenic = isMountainSunriseBrief(opts.brief);
  return [
    {
      id: "hook",
      title: scenic ? "First light" : "Hook",
      duration: opts.durations[0],
      narration: scenic
        ? `The first light reaches ${opts.product} before the day begins.`
        : `${opts.product} starts with one clear promise.`,
      backdrop: scenic
        ? `misty mountain ridge at sunrise, golden light, fog layers, cinematic ${opts.theme}`
        : `topic-aligned editorial background plate for ${opts.product}, ${opts.theme}, no readable text, no logos, no unrelated consumer products, clean negative space for HTML overlays`,
      motion: scenic
        ? "quiet title reveal, soft parallax, slow camera drift"
        : "large readable headline, restrained camera push, immediate value reveal",
      body: scenic
        ? "Show the mountain identity immediately. Keep text minimal."
        : "Make the value obvious in the first beat. Avoid setup that delays the payoff.",
    },
    {
      id: "proof",
      title: scenic ? "The path appears" : "Proof",
      duration: opts.durations[1],
      narration: scenic
        ? "A clear path appears when every step is visible."
        : "The proof appears when each step is visible.",
      backdrop: scenic
        ? "ridge trail emerging through fog, warm sunrise edge light, high contrast"
        : `topic-aligned proof background plate for ${opts.product}, abstract workflow structure, no readable text, no product photos, no shoes, no unrelated objects`,
      motion: scenic
        ? "thin line traces the path, small labels fade in"
        : "interface panels or proof points slide into place with precise transitions",
      body: "Connect the visual proof to the promise in one focused moment.",
    },
    {
      id: "mechanism",
      title: scenic ? "Built from files" : "Mechanism",
      duration: opts.durations[2],
      narration: "A storyboard becomes files, reports, scenes, and a render plan.",
      backdrop: `storyboard markdown, build-report.json, review-report.json, and generated scene cards for ${opts.product}`,
      motion: "STORYBOARD.md, build-report.json, and review-report.json cards move into a clean timeline",
      body: "Make the file-based workflow visible without crowding the frame.",
    },
    {
      id: "close",
      title: scenic ? "Day one" : "Close",
      duration: opts.durations[3],
      narration: scenic
        ? `${opts.product}. Day one begins here.`
        : `${opts.product} is ready to show.`,
      backdrop: scenic
        ? "wide mountain ridge at peak golden hour, valley filled with warm light"
        : `resolved editorial background plate for ${opts.product}, clean negative space, confident lockup, no readable text, no logos, no unrelated products`,
      motion: "clean final title, slow settling motion, gentle fade to the final frame",
      body: "End with a quiet branded title and no new idea.",
    },
  ];
}

function threeBeatDraft(opts: {
  product: string;
  brief: string;
  theme: string;
  durations: number[];
}): BeatDraft[] {
  return [
    {
      id: "hook",
      title: "Hook",
      duration: opts.durations[0],
      narration: `${opts.product} starts with one clear promise.`,
      backdrop: `topic-aligned editorial background plate for ${opts.product}, ${opts.theme}, no readable text, no logos, no unrelated consumer products, clean negative space for HTML overlays`,
      motion: "large readable headline, restrained camera push, immediate value reveal",
      body: "Make the value obvious in one beat.",
    },
    {
      id: "proof",
      title: "Proof",
      duration: opts.durations[1],
      narration: "The proof appears when each step is visible.",
      backdrop: `topic-aligned proof background plate for ${opts.product}, abstract workflow structure, no readable text, no product photos, no shoes, no unrelated objects`,
      motion: "layered panels, highlighted cause and effect, precise transitions",
      body: "Show the mechanism, metric, or before/after that makes the promise believable.",
    },
    {
      id: "close",
      title: "Close",
      duration: opts.durations[2],
      narration: `${opts.product} is ready to show.`,
      backdrop: `resolved editorial background plate for ${opts.product}, clean negative space, confident lockup, no readable text, no logos, no unrelated products`,
      motion: "clean final title, subtle parallax, gentle fade to the final frame",
      body: "End on the product name, offer, command, or memorable final line.",
    },
  ];
}

function renderBeatDraft(beat: BeatDraft): string {
  return `## Beat ${beat.id} - ${beat.title}

\`\`\`yaml
duration: ${beat.duration}
narration: "${escapeCue(beat.narration)}"
backdrop: "${escapeCue(beat.backdrop)}"
motion: "${escapeCue(beat.motion)}"
\`\`\`

${beat.body}`;
}

function splitDuration(total: number, count: number): number[] {
  const base = Math.max(1, Math.floor((total / count) * 10) / 10);
  const out = Array.from({ length: count }, () => base);
  const used = base * count;
  out[out.length - 1] = Number(Math.max(1, total - used + base).toFixed(1));
  return out;
}

function escapeCue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 180);
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

function describeTheme(brief: string, product: string): string {
  const cleaned = brief
    .replace(/\b\d+[- ]?second\b/gi, "")
    .replace(new RegExp(`\\bfor\\s+${escapeRegExp(product)}\\b`, "i"), "")
    .replace(/\blaunch video\b/gi, "launch story")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "focused product story";
}

function isMountainSunriseBrief(brief: string): boolean {
  return /\b(mountain|ridge|sunrise|fog|peak)\b/i.test(brief);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
