/**
 * @module _shared/compose-aivideo
 *
 * Deterministic composer for the AI-video case (recurring character + per-beat
 * i2v clip + lower-third text). It codifies the hand-verified pattern that
 * survives the HyperFrames capture reliably:
 *
 *   1. Concatenate the per-beat clips into ONE continuous background video
 *      (`assets/bg-full.mp4`) — a single `<video>` never hits the intermittent
 *      multi-`<video>` sub-composition render race that drops scenes to black.
 *   2. Emit each scene composition as a TRANSPARENT lower-third text overlay so
 *      the single root background video shows through.
 *   3. Inject that one background `<video>` into `index.html` (idempotent),
 *      then let `root-sync` wire the scene clip refs + narration audio.
 *
 * No LLM call, no per-beat bespoke HTML — so it is fast, free, and cannot
 * reproduce the auto-composer's duplicate-word / missing-video bugs. See memory
 * `hyperframes-multiscene-video-render-gotchas`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { commandExists, execSafe } from "../../utils/exec-safe.js";
import { parseStoryboard, type Beat } from "./storyboard-parse.js";
import { parseDesign } from "./design-parse.js";

/**
 * Dedicated root track for the single background video. The managed root-sync
 * block uses tracks 0 (scene clip refs), 1 (music), 2 (narration); the full-span
 * background must sit on its own track so it never overlaps the sequential scene
 * clips (`overlapping_clips_same_track`). Visual stacking is via z-index, so a
 * high track index is purely a scheduling lane.
 */
const BG_VIDEO_TRACK = 9;

export interface AiVideoDesignTokens {
  /** Headline + body text colour. */
  primary: string;
  /** Scrim / fade-to ground colour. */
  ground: string;
  /** Eyebrow rule + single accent. */
  accent: string;
  /** Headline / eyebrow font-family. */
  headFont: string;
  /** Sub-line (italic) font-family. */
  bodyFont: string;
}

export const DEFAULT_AIVIDEO_TOKENS: AiVideoDesignTokens = {
  primary: "#EAF2F7",
  ground: "#0E1A24",
  accent: "#E2683C",
  headFont: '"Archivo", sans-serif',
  bodyFont: '"Newsreader", serif',
};

/** Per-scene overlay copy derived from a beat heading + optional cues. */
export interface OverlayText {
  kicker: string;
  title: string;
  sub: string;
}

const SAFE_TEXT = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const clean = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

/**
 * "Beat camp — First Light" → "First Light"; "First Light" → "First Light";
 * a bare slug heading "the-summit" → "The Summit". A hyphen only counts as a
 * separator when space-padded, so slugs aren't split.
 */
function headingDescriptor(heading: string): string {
  const stripped = heading.replace(/^\s*beat\s+/i, "");
  const m = stripped.match(/^[A-Za-z0-9][\w-]*(?:\s*[—:]\s*|\s+-\s+)(.+)$/);
  const desc = clean(m ? m[1] : stripped);
  // Slug-like (no spaces, has -/_) → humanise; otherwise keep as authored.
  return /\s/.test(desc) || !/[-_]/.test(desc) ? desc : humanise(desc);
}

function humanise(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive the lower-third copy for a beat. Authors override deterministically via
 * `eyebrow`/`title`/`caption` cues; otherwise it falls back to the heading.
 */
export function beatOverlayText(beat: Beat): OverlayText {
  const cues = beat.cues ?? {};
  const descriptor = headingDescriptor(beat.heading);
  const idHuman = humanise(beat.id);
  const titleCue = clean((cues as Record<string, unknown>).title);
  const title = titleCue || descriptor || idHuman;
  const kickerCue = clean(
    (cues as Record<string, unknown>).eyebrow ?? (cues as Record<string, unknown>).kicker
  );
  // Use the humanised id as the kicker only when the heading gave a DISTINCT
  // descriptor (a real "Beat <id> — <descriptor>" split), so a bare slug/title
  // heading never duplicates its title into the eyebrow.
  const kicker =
    kickerCue || (!titleCue && descriptor && descriptor !== idHuman ? idHuman : "");
  const sub = clean(
    (cues as Record<string, unknown>).caption ?? (cues as Record<string, unknown>).sub
  );
  return { kicker, title, sub };
}

/**
 * ffmpeg args to concat clips into one uniform background video. Each input is
 * scaled+cropped to fill {width}x{height} at {fps}, then concatenated (no
 * audio — narration rides a separate track).
 */
export function buildBgConcatArgs(
  clipPaths: string[],
  outPath: string,
  opts: { width?: number; height?: number; fps?: number; crf?: number } = {}
): string[] {
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const fps = opts.fps ?? 30;
  const crf = opts.crf ?? 18;
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const scale = clipPaths.map(
    (_, i) =>
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},setsar=1,fps=${fps}[v${i}]`
  );
  const concat =
    clipPaths.map((_, i) => `[v${i}]`).join("") +
    `concat=n=${clipPaths.length}:v=1:a=0[v]`;
  return [
    "-y",
    ...inputs,
    "-filter_complex",
    [...scale, concat].join(";"),
    "-map",
    "[v]",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    outPath,
  ];
}

/**
 * A transparent lower-third overlay scene. The root background video shows
 * through; a bottom scrim keeps text legible. Entrances only (the producer
 * cuts on `data-duration`); the final scene fades to ground.
 */
export function emitOverlayScene(opts: {
  id: string;
  text: OverlayText;
  duration: number;
  tokens?: AiVideoDesignTokens;
  isLast?: boolean;
}): string {
  const id = opts.id;
  const scope = `[data-composition-id="${id}"]`; // double-quoted — for CSS rules
  const sel = `[data-composition-id='${id}']`; // single-quoted — for JS selector strings
  const t = opts.tokens ?? DEFAULT_AIVIDEO_TOKENS;
  const { kicker, title, sub } = opts.text;
  const rgbaGround = (a: number) => hexToRgba(t.ground, a);

  const eyebrow = kicker
    ? `        <div class="eyebrow"><span class="rule"></span><span class="kicker">${SAFE_TEXT(kicker)}</span></div>`
    : "";
  const subLine = sub ? `        <div class="sub">${SAFE_TEXT(sub)}</div>` : "";
  const fadeMarkup = opts.isLast ? `    <div class="fadeout"></div>` : "";

  const tweens: string[] = [
    `tl.fromTo("${sel} .scrim", { opacity: 0.94 }, { opacity: 1, duration: ${opts.duration}, ease: "none" }, 0);`,
  ];
  if (kicker) {
    tweens.push(
      `tl.to("${sel} .eyebrow", { opacity: 1, duration: 0.5, ease: "power2.out" }, 0.3);`,
      `tl.fromTo("${sel} .rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.out" }, 0.3);`
    );
  }
  tweens.push(
    `tl.fromTo("${sel} .title", { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0.5);`
  );
  if (sub) {
    tweens.push(
      `tl.fromTo("${sel} .sub", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "sine.inOut" }, 0.95);`
    );
  }
  if (opts.isLast) {
    tweens.push(
      `tl.to("${sel} .fadeout", { opacity: 1, duration: 1.0, ease: "power2.inOut" }, ${Math.max(0, opts.duration - 1).toFixed(2)});`
    );
  } else {
    tweens.push(`tl.set("${sel} .lower", { opacity: 1 }, ${(opts.duration - 0.001).toFixed(3)});`);
  }

  return `<template id="scene-${id}-template">
  <div data-composition-id="${id}" data-start="0" data-duration="${opts.duration}" data-width="1920" data-height="1080">
    <style>
      ${scope} { position: relative; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
      ${scope} .scrim { position: absolute; inset: 0; z-index: 2; pointer-events: none;
        background: linear-gradient(to top, ${rgbaGround(0.88)} 0%, ${rgbaGround(0.45)} 26%, ${rgbaGround(0.0)} 52%); }
      ${opts.isLast ? `${scope} .fadeout { position: absolute; inset: 0; z-index: 20; background: ${t.ground}; opacity: 0; pointer-events: none; }` : ""}
      ${scope} .lower { position: absolute; left: 0; bottom: 0; width: 1920px; padding: 0 130px 104px; box-sizing: border-box; z-index: 10; display: flex; flex-direction: column; align-items: flex-start; gap: 18px; }
      ${scope} .eyebrow { display: flex; align-items: center; gap: 16px; opacity: 0; }
      ${scope} .rule { width: 40px; height: 2px; background: ${t.accent}; transform-origin: left center; }
      ${scope} .kicker { font-family: ${t.headFont}; font-weight: 600; font-size: 19px; letter-spacing: 0.22em; text-transform: uppercase; color: ${t.accent}; }
      ${scope} .title { font-family: ${t.headFont}; font-weight: 700; font-size: 92px; line-height: 1.0; letter-spacing: -0.02em; color: ${t.primary}; opacity: 0; }
      ${scope} .sub { font-family: ${t.bodyFont}; font-weight: 400; font-style: italic; font-size: 34px; letter-spacing: 0.01em; color: ${hexToRgba(t.primary, 0.85)}; opacity: 0; }
    </style>

    <div class="scrim"></div>
    <div class="clip" data-start="0" data-duration="${opts.duration}" data-track-index="1">
      <div class="lower">
${eyebrow}
        <div class="title">${SAFE_TEXT(title)}</div>
${subLine}
      </div>
    </div>
${fadeMarkup}

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${tweens.join("\n      ")}
      window.__timelines["${id}"] = tl;
    </script>
  </div>
</template>
`;
}

/**
 * Insert the single background `<video>` into `#root` (idempotent). Custom and
 * managed elements are otherwise untouched; the bg video carries no
 * `class="clip"`, so it is not subject to same-track clip scheduling and sits
 * behind the scene overlays via `z-index`.
 */
export function injectBgVideo(indexHtml: string, src: string, totalDuration: number): string {
  const videoTag =
    `      <video id="bg-video" class="clip" src="${src}" data-start="0" data-duration="${totalDuration}" ` +
    `data-media-start="0" data-track-index="${BG_VIDEO_TRACK}" muted playsinline></video>`;
  let html = indexHtml;

  // Style: ensure the bg-video cover + scene-overlay z-index rules exist once.
  if (!html.includes("/* aivideo-bg */")) {
    const css =
      `\n      /* aivideo-bg */\n` +
      `      #bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }\n` +
      `      #root > [data-composition-id^="scene-"] { position: absolute; inset: 0; z-index: 5; }`;
    if (/<\/style>/i.test(html)) {
      html = html.replace(/<\/style>/i, `${css}\n    </style>`);
    }
  }

  // Element: replace an existing bg-video (update src/duration) or insert once
  // right after the root opening tag.
  if (/<video\b[^>]*\bid="bg-video"[^>]*>(?:\s*<\/video>)?/i.test(html)) {
    return html.replace(/<video\b[^>]*\bid="bg-video"[^>]*>(?:\s*<\/video>)?/i, videoTag.trim());
  }
  const rootOpenRe = /(<[a-z][\w-]*[^>]*\bid="root"[^>]*>)/i;
  if (rootOpenRe.test(html)) {
    return html.replace(rootOpenRe, `$1\n${videoTag}`);
  }
  return html;
}

export interface ComposeAiVideoResult {
  bgVideoRel: string;
  sceneFiles: string[];
  totalDurationSec: number;
  beats: number;
}

/**
 * Orchestrate the deterministic compose: concat clips → bg-full.mp4, emit
 * transparent overlay scenes, inject the bg video into index.html. Caller runs
 * `root-sync` afterward to wire scene clip refs + narration.
 */
export async function composeAiVideo(opts: {
  projectDir: string;
  tokens?: AiVideoDesignTokens;
  /** Resolve the clip path for a beat (defaults to `assets/video-<id>.mp4`). */
  clipRelFor?: (beat: Beat) => string;
}): Promise<ComposeAiVideoResult> {
  const projectDir = resolve(opts.projectDir);
  if (!commandExists("ffmpeg")) {
    throw new Error("ffmpeg not found in PATH — required to concatenate AI-video clips.");
  }

  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const md = await readFile(storyboardPath, "utf-8");
  const beats = parseStoryboard(md).beats;
  if (beats.length === 0) throw new Error("STORYBOARD.md has no beats to compose.");

  const tokens = opts.tokens ?? (await loadProjectTokens(projectDir));
  const clipRelFor = opts.clipRelFor ?? ((b: Beat) => `assets/video-${b.id}.mp4`);

  const clipRels: string[] = [];
  for (const beat of beats) {
    const rel = clipRelFor(beat);
    if (!existsSync(join(projectDir, rel))) {
      throw new Error(`Missing clip for beat "${beat.id}" at ${rel} — run the assets stage first.`);
    }
    clipRels.push(rel);
  }

  // 1. Concatenate clips → assets/bg-full.mp4
  await mkdir(join(projectDir, "assets"), { recursive: true });
  const bgRel = "assets/bg-full.mp4";
  const concatArgs = buildBgConcatArgs(
    clipRels.map((r) => join(projectDir, r)),
    join(projectDir, bgRel)
  );
  await execSafe("ffmpeg", concatArgs, { timeout: 600_000 });
  const totalDurationSec = await probeDurationSec(join(projectDir, bgRel));

  // 2. Emit transparent overlay scenes
  await mkdir(join(projectDir, "compositions"), { recursive: true });
  const sceneFiles: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const rawDur = beat.cues?.duration;
    const duration = typeof rawDur === "number" && rawDur > 0 ? rawDur : 6;
    const html = emitOverlayScene({
      // Composition id MUST match the root clip ref the sync stage emits
      // (`data-composition-id="scene-<beatId>"`), or the producer cannot bind
      // and time-gate the overlay — every scene leaks onto every frame.
      id: `scene-${beat.id}`,
      text: beatOverlayText(beat),
      duration,
      tokens,
      isLast: i === beats.length - 1,
    });
    const rel = `compositions/scene-${beat.id}.html`;
    await writeFile(join(projectDir, rel), html, "utf-8");
    sceneFiles.push(rel);
  }

  // 3. Ensure index.html carries the single bg video. Compose runs before the
  //    sync stage scaffolds the root, so write a minimal root shell when it is
  //    missing (sync then only wires the managed block, preserving bg-video).
  const indexPath = join(projectDir, "index.html");
  const next = existsSync(indexPath)
    ? injectBgVideo(await readFile(indexPath, "utf-8"), bgRel, totalDurationSec)
    : buildRootShell(tokens, bgRel, totalDurationSec);
  await writeFile(indexPath, next, "utf-8");

  return { bgVideoRel: bgRel, sceneFiles, totalDurationSec, beats: beats.length };
}

/** Minimal root composition shell carrying the single bg video. The sync stage
 * adds the `<!-- vibe-scene-build -->` block (scene clip refs + narration). */
export function buildRootShell(
  tokens: AiVideoDesignTokens,
  bgRel: string,
  totalDuration: number
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: ${tokens.ground}; }
      /* aivideo-bg */
      #bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
      #root > [data-composition-id^="scene-"] { position: absolute; inset: 0; z-index: 5; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${totalDuration}" data-width="1920" data-height="1080">
      <video id="bg-video" class="clip" src="${bgRel}" data-start="0" data-duration="${totalDuration}" data-media-start="0" data-track-index="${BG_VIDEO_TRACK}" muted playsinline></video>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

// ── helpers ────────────────────────────────────────────────────────────────

async function probeDurationSec(absPath: string): Promise<number> {
  try {
    const { stdout } = await execSafe("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      absPath,
    ]);
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  } catch {
    return 0;
  }
}

/** Pull palette hexes from DESIGN.md and map by luminance/saturation. */
async function loadProjectTokens(projectDir: string): Promise<AiVideoDesignTokens> {
  const designPath = join(projectDir, "DESIGN.md");
  if (!existsSync(designPath)) return DEFAULT_AIVIDEO_TOKENS;
  try {
    return extractDesignTokens(await readFile(designPath, "utf-8"));
  } catch {
    return DEFAULT_AIVIDEO_TOKENS;
  }
}

/**
 * Map a DESIGN.md to background-video tokens. Named color tokens (front-matter
 * `colors: { primary, ground, accent }` or descriptive keys) win; otherwise the
 * palette is read by luminance (darkest → ground, lightest → primary) and the
 * most-saturated remaining color becomes the accent.
 */
export function extractDesignTokens(designMd: string): AiVideoDesignTokens {
  const colors = Object.values(parseDesign(designMd).colors)
    .map((c) => c.toUpperCase())
    .filter((c) => /^#[0-9A-F]{6}$/.test(c));
  const named = parseDesign(designMd).colors;
  const byName = (needles: string[]): string | undefined => {
    const hit = Object.entries(named).find(([k]) =>
      needles.some((n) => k.toLowerCase().includes(n))
    )?.[1];
    return hit && /^#[0-9a-fA-F]{6}$/.test(hit) ? hit.toUpperCase() : undefined;
  };

  const unique = Array.from(new Set(colors));
  if (unique.length < 3 && Object.keys(named).length === 0) return DEFAULT_AIVIDEO_TOKENS;
  if (unique.length < 3) {
    return {
      ...DEFAULT_AIVIDEO_TOKENS,
      ground: byName(["ground", "background", "bg", "surface", "base"]) ?? DEFAULT_AIVIDEO_TOKENS.ground,
      primary: byName(["primary", "text", "foreground", "ink"]) ?? DEFAULT_AIVIDEO_TOKENS.primary,
      accent: byName(["accent", "brand", "highlight"]) ?? DEFAULT_AIVIDEO_TOKENS.accent,
    };
  }
  const sorted = [...unique].sort((a, b) => luminance(a) - luminance(b));
  const ground = byName(["ground", "background", "bg", "surface", "base"]) ?? sorted[0];
  const primary = byName(["primary", "text", "foreground", "ink"]) ?? sorted[sorted.length - 1];
  const accent =
    byName(["accent", "brand", "highlight"]) ??
    unique.filter((h) => h !== ground && h !== primary).sort((a, b) => saturation(b) - saturation(a))[0] ??
    DEFAULT_AIVIDEO_TOKENS.accent;
  return { ...DEFAULT_AIVIDEO_TOKENS, primary, ground, accent };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}
