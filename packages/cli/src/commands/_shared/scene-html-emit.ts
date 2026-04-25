/**
 * @module _shared/scene-html-emit
 *
 * Pure HTML emitters for `vibe scene add`. Each preset produces a self-contained
 * Hyperframes-compatible scene composition: a `<template>`-wrapped `<div
 * data-composition-id>` with scoped CSS, optional audio/image, and a paused
 * GSAP timeline registered on `window.__timelines`.
 *
 * Also exposes helpers that mutate the root index.html:
 * - `nextSceneStart()` — sum existing clip end-times to choose the new start
 * - `insertClipIntoRoot()` — splice a `<div class="clip">` reference before the
 *   root's closing div, preserving the user's hand-edited markup
 * - `slugifySceneName()` — name → kebab-case scene id
 *
 * Pure functions only — no I/O. The orchestrating command (`scene add`) wires
 * these to the filesystem.
 */
export type ScenePreset =
  | "simple"
  | "announcement"
  | "explainer"
  | "kinetic-type"
  | "product-shot";

export const SCENE_PRESETS: readonly ScenePreset[] = [
  "simple",
  "announcement",
  "explainer",
  "kinetic-type",
  "product-shot",
] as const;

/**
 * One word from a Whisper word-level transcript. Mirrors
 * {@link import("@vibeframe/ai-providers").TranscriptWord} but is duplicated
 * here so this module stays pure (no provider package import).
 */
export interface SceneTranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface EmitSceneInput {
  /** Kebab-case scene id; appears in `data-composition-id` and template id. */
  id: string;
  preset: ScenePreset;
  /** Canvas width in px (must match the root composition). */
  width: number;
  /** Canvas height in px (must match the root composition). */
  height: number;
  /** Visible composition duration in seconds. */
  duration: number;
  /** Headline text — required for non-simple presets; defaulted from id. */
  headline?: string;
  /** Secondary text (subhead/caption). Often the narration. */
  subhead?: string;
  /** Optional small label above the headline (explainer / product-shot). */
  kicker?: string;
  /** Project-relative image path (e.g. "assets/scene-intro.png"). */
  imagePath?: string;
  /** Project-relative narration audio path (e.g. "assets/narration-intro.mp3"). */
  audioPath?: string;
  /**
   * Word-level timings (Whisper output) for narration sync. When supplied, the
   * `simple`, `explainer`, and `kinetic-type` presets render each word as its
   * own `<span class="word">` and animate them at their absolute audio start
   * times via GSAP. `announcement` and `product-shot` ignore this field —
   * their headlines are intentionally static.
   */
  transcript?: SceneTranscriptWord[];
}

const GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

/** Minimal HTML escaper for text we inline into elements/attributes. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Normalise whitespace and trim — used on user-supplied headlines/subheads. */
function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Humanise a scene id — "product-shot" → "Product Shot". */
function humanise(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Slugify a free-form scene name to a kebab-case id usable in HTML attributes
 * and filenames. Strips diacritics, collapses whitespace, lowercases.
 */
export function slugifySceneName(name: string): string {
  const normalised = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = normalised
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "scene";
}

// ---------------------------------------------------------------------------
// Word-sync helpers
// ---------------------------------------------------------------------------

/**
 * Render a transcript as `<span class="word" data-i="N">…</span>` markup,
 * separated by literal whitespace so kerning and wrapping behave naturally.
 * Returns the empty string when there's nothing to render.
 */
export function renderTranscriptSpans(transcript: SceneTranscriptWord[]): string {
  return transcript
    .map((w, i) => `<span class="word" data-i="${i}">${esc(w.text)}</span>`)
    .join(" ");
}

/**
 * Build absolute-timing GSAP tweens that fade each transcript word in at its
 * narration `start` time. The `targetSelector` parametrises the scope so the
 * same routine can drive `simple` (`.caption .word`), `explainer`
 * (`#subtitle .word`), or `kinetic-type` (`.kinetic .word`).
 *
 * Each tween is `tl.fromTo(sel, {opacity:0,y:10}, {opacity:1,y:0,duration:0.18}, start)`
 * — short enough to feel responsive at any speech rate, long enough to avoid
 * popping at 30fps. Words clamp to non-negative starts.
 */
export function buildTranscriptTweens(
  transcript: SceneTranscriptWord[],
  targetSelector: string,
): string {
  return transcript
    .map((w, i) => {
      const start = Math.max(0, Number(w.start.toFixed(3)));
      const sel = `${targetSelector}[data-i="${i}"]`;
      return `tl.fromTo('${sel}', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.18, ease: 'power2.out' }, ${start});`;
    })
    .join("\n      ");
}

// ---------------------------------------------------------------------------
// Per-preset content + animation
// ---------------------------------------------------------------------------

interface PresetParts {
  /** CSS rules scoped via `[data-composition-id="<id>"] ...`. */
  css: string;
  /** Body markup inside the composition root div (no trailing newline). */
  body: string;
  /** GSAP tween statements, each terminated with a semicolon. */
  timeline: string;
}

function buildPreset(input: Required<Pick<EmitSceneInput, "id" | "preset" | "duration">> & EmitSceneInput): PresetParts {
  const id = input.id;
  const scope = `[data-composition-id="${id}"]`;
  const headline = clean(input.headline) || humanise(id);
  const subhead = clean(input.subhead);
  const kicker = clean(input.kicker);
  const dur = input.duration;
  const hasImage = !!input.imagePath;

  const backdrop = hasImage
    ? `${scope} .backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background-image: url("${esc(input.imagePath as string)}");
        background-size: cover;
        background-position: center;
      }
      ${scope} .backdrop::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.55) 100%);
      }`
    : `${scope} .backdrop {
        position: absolute;
        inset: 0;
        background: radial-gradient(ellipse at center, #1a1a2e 0%, #000 70%);
      }`;
  const backdropMarkup = `<div class="backdrop"></div>`;

  switch (input.preset) {
    case "simple": {
      const transcript = input.transcript;
      const useWordSync = !!(transcript && transcript.length > 0);
      const captionText = subhead || headline;
      const captionInner = useWordSync
        ? renderTranscriptSpans(transcript)
        : esc(captionText);
      const wordCss = useWordSync
        ? `\n      ${scope} .caption .word { display: inline-block; opacity: 0; }`
        : "";
      const timeline = useWordSync
        ? `${buildTranscriptTweens(transcript, `${scope} .caption .word`)}
      tl.to('${scope} .caption', { opacity: 0, duration: 0.4, ease: 'power2.in' }, ${(dur - 0.4).toFixed(2)});`
        : `tl.from('${scope} .caption', { opacity: 0, y: 28, duration: 0.6, ease: 'power2.out' }, 0.1);
      tl.to('${scope} .caption', { opacity: 0, duration: 0.4, ease: 'power2.in' }, ${(dur - 0.4).toFixed(2)});`;
      return {
        css: `${scope} {
        position: absolute; inset: 0; width: 100%; height: 100%;
        font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
        color: #fff; overflow: hidden; background: #000;
      }
      ${backdrop}
      ${scope} .caption {
        position: absolute;
        left: 8%; right: 8%; bottom: 12%;
        text-align: center;
        font-size: 56px;
        font-weight: 700;
        line-height: 1.2;
        text-shadow: 0 4px 20px rgba(0,0,0,0.65);
      }${wordCss}`,
        body: `${backdropMarkup}
    <div class="caption" id="caption">${captionInner}</div>`,
        timeline,
      };
    }
    case "announcement": {
      return {
        css: `${scope} {
        position: absolute; inset: 0; width: 100%; height: 100%;
        font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
        color: #fff; overflow: hidden; background: #000;
      }
      ${backdrop}
      ${scope} .announce {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        text-align: center;
        padding: 0 8%;
      }
      ${scope} .announce h1 {
        margin: 0;
        font-size: 160px;
        font-weight: 900;
        letter-spacing: -4px;
        line-height: 1;
        background: linear-gradient(90deg, #8e2de2, #00c9ff);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        text-shadow: 0 8px 40px rgba(142,45,226,0.35);
      }`,
        body: `${backdropMarkup}
    <div class="announce"><h1 id="headline">${esc(headline)}</h1></div>`,
        timeline: `tl.from('${scope} #headline', { opacity: 0, scale: 0.8, duration: 0.9, ease: 'back.out(1.6)' }, 0.15);
      tl.to('${scope} #headline', { opacity: 0, duration: 0.4, ease: 'power2.in' }, ${(dur - 0.4).toFixed(2)});`,
      };
    }
    case "explainer": {
      const k = kicker || humanise(id).toUpperCase();
      const sub = subhead || "";
      const transcript = input.transcript;
      const useWordSync = !!(transcript && transcript.length > 0 && sub);
      const subtitleInner = useWordSync ? renderTranscriptSpans(transcript) : esc(sub);
      const wordCss = useWordSync
        ? `\n      ${scope} #subtitle .word { display: inline-block; opacity: 0; }`
        : "";
      const subtitleTween = useWordSync
        ? buildTranscriptTweens(transcript, `${scope} #subtitle .word`)
        : sub
          ? `tl.from('${scope} #subtitle', { opacity: 0, y: 30, duration: 0.55, ease: 'power3.out' }, 0.55);`
          : "";
      return {
        css: `${scope} {
        position: absolute; inset: 0; width: 100%; height: 100%;
        font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
        color: #fff; overflow: hidden; background: #000;
      }
      ${backdrop}
      ${scope} .stage {
        position: absolute; inset: 0;
        display: flex; flex-direction: column; justify-content: center;
        gap: 24px; padding: 0 10%;
      }
      ${scope} .kicker {
        font-size: 28px; letter-spacing: 6px; text-transform: uppercase;
        color: #00c9ff; font-weight: 600;
      }
      ${scope} .title {
        font-size: 110px; font-weight: 800; letter-spacing: -2px;
        line-height: 1.05; margin: 0;
      }
      ${scope} .subtitle {
        font-size: 38px; font-weight: 300; color: #c0c0d0; max-width: 80%;
      }${wordCss}`,
        body: `${backdropMarkup}
    <div class="stage">
      <div class="kicker" id="kicker">${esc(k)}</div>
      <h1 class="title" id="title">${esc(headline)}</h1>${sub ? `
      <div class="subtitle" id="subtitle">${subtitleInner}</div>` : ""}
    </div>`,
        timeline: `tl.from('${scope} #kicker', { opacity: 0, y: 16, duration: 0.4, ease: 'power2.out' }, 0.1);
      tl.from('${scope} #title', { opacity: 0, y: 60, duration: 0.7, ease: 'power3.out' }, 0.25);
      ${subtitleTween}`,
      };
    }
    case "kinetic-type": {
      const transcript = input.transcript;
      const useWordSync = !!(transcript && transcript.length > 0);
      // When transcript is supplied, drive word entries from it (narration is
      // the ground truth — what's spoken is what's shown). Otherwise fall back
      // to splitting the headline.
      const words = useWordSync
        ? transcript.map((w) => w.text)
        : headline.split(/\s+/).filter(Boolean);
      const wordSpans = words
        .map((w, i) => `<span class="word" data-i="${i}" id="w-${i}">${esc(w)}</span>`)
        .join(" ");
      const stagger = Math.max(0.08, Math.min(0.3, (dur - 0.6) / Math.max(words.length, 1)));
      const tweens = useWordSync
        ? transcript
            .map((w, i) => {
              const start = Math.max(0, Number(w.start.toFixed(3)));
              return `tl.from('${scope} #w-${i}', { opacity: 0, y: 80, scale: 0.8, duration: 0.35, ease: 'back.out(1.8)' }, ${start});`;
            })
            .join("\n      ")
        : words
            .map((_, i) => {
              const start = (0.05 + i * stagger).toFixed(2);
              return `tl.from('${scope} #w-${i}', { opacity: 0, y: 80, scale: 0.8, duration: 0.45, ease: 'back.out(1.8)' }, ${start});`;
            })
            .join("\n      ");
      return {
        css: `${scope} {
        position: absolute; inset: 0; width: 100%; height: 100%;
        font-family: "Helvetica Neue", Arial, sans-serif;
        color: #fff; overflow: hidden; background: #000;
      }
      ${backdrop}
      ${scope} .kinetic {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        text-align: center; padding: 0 6%;
        font-size: 180px; font-weight: 900; letter-spacing: -6px;
        line-height: 1; text-shadow: 0 6px 30px rgba(0,0,0,0.6);
      }
      ${scope} .kinetic .word { display: inline-block; margin: 0 12px; }`,
        body: `${backdropMarkup}
    <div class="kinetic">${wordSpans}</div>`,
        timeline: tweens,
      };
    }
    case "product-shot": {
      const label = kicker || humanise(id);
      return {
        css: `${scope} {
        position: absolute; inset: 0; width: 100%; height: 100%;
        font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
        color: #fff; overflow: hidden; background: #000;
      }
      ${backdrop}
      ${scope} .backdrop { transform-origin: center; }
      ${scope} .label {
        position: absolute; top: 8%; left: 8%;
        padding: 12px 24px; border-radius: 999px;
        background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
        font-size: 24px; font-weight: 600; letter-spacing: 2px;
        text-transform: uppercase;
      }
      ${scope} .product-headline {
        position: absolute; left: 8%; right: 8%; bottom: 14%;
        font-size: 72px; font-weight: 800; letter-spacing: -1px;
        line-height: 1.1; text-shadow: 0 4px 20px rgba(0,0,0,0.7);
      }${subhead ? `
      ${scope} .product-sub {
        position: absolute; left: 8%; right: 8%; bottom: 8%;
        font-size: 28px; font-weight: 400; color: #d0d0e0;
        text-shadow: 0 2px 10px rgba(0,0,0,0.7);
      }` : ""}`,
        body: `${backdropMarkup}
    <div class="label" id="label">${esc(label)}</div>
    <div class="product-headline" id="headline">${esc(headline)}</div>${subhead ? `
    <div class="product-sub" id="subhead">${esc(subhead)}</div>` : ""}`,
        timeline: `tl.fromTo('${scope} .backdrop', { scale: 1.0 }, { scale: 1.08, duration: ${dur.toFixed(2)}, ease: 'none' }, 0);
      tl.from('${scope} #label', { opacity: 0, x: -30, duration: 0.5, ease: 'power3.out' }, 0.2);
      tl.from('${scope} #headline', { opacity: 0, y: 40, duration: 0.6, ease: 'power3.out' }, 0.4);${subhead ? `
      tl.from('${scope} #subhead', { opacity: 0, y: 20, duration: 0.5, ease: 'power3.out' }, 0.65);` : ""}`,
      };
    }
  }
}

/**
 * Emit the full per-scene HTML. Returns a complete `<template>`-wrapped
 * composition ready to write to `compositions/scene-<id>.html`.
 */
export function emitSceneHtml(input: EmitSceneInput): string {
  if (input.duration <= 0) {
    throw new Error(`Scene duration must be > 0, got ${input.duration}`);
  }
  if (input.width <= 0 || input.height <= 0) {
    throw new Error(`Invalid canvas dims: ${input.width}x${input.height}`);
  }

  const id = input.id;
  const dur = Number(input.duration.toFixed(3));
  const parts = buildPreset({ ...input, id, duration: dur });

  const audioBlock = input.audioPath
    ? `\n    <audio
      id="narration"
      data-start="0"
      data-duration="auto"
      data-track-index="2"
      src="${esc(input.audioPath)}"
      data-volume="1"
    ></audio>\n`
    : "";

  return `<template id="scene-${id}-template">
  <div data-composition-id="${id}" data-start="0" data-duration="${dur}" data-width="${input.width}" data-height="${input.height}">
    <style>
      ${parts.css}
    </style>

    ${parts.body}
${audioBlock}
    <script src="${GSAP_CDN}"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      ${parts.timeline}

      window.__timelines["${id}"] = tl;
    </script>
  </div>
</template>
`;
}

// ---------------------------------------------------------------------------
// Root index.html mutation
// ---------------------------------------------------------------------------

/**
 * Sum existing `<div class="clip">` end-times to find where the next scene
 * should start. Returns 0 for an empty root.
 */
export function nextSceneStart(rootHtml: string): number {
  const clipRegex = /<div\s+class="clip"[^>]*?\sdata-start="([\d.]+)"[^>]*?\sdata-duration="([\d.]+)"/gi;
  let maxEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = clipRegex.exec(rootHtml)) !== null) {
    const end = parseFloat(match[1]) + parseFloat(match[2]);
    if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

export interface ClipReferenceInput {
  /** Scene id — used to derive the composition src path. */
  id: string;
  start: number;
  duration: number;
  trackIndex?: number;
  /** Override the default `compositions/scene-<id>.html` src. */
  src?: string;
}

/** Build the `<div class="clip" data-composition-id=... data-composition-src=...>` reference string. */
export function buildClipReference(opts: ClipReferenceInput): string {
  const start = Number(opts.start.toFixed(3));
  const duration = Number(opts.duration.toFixed(3));
  const track = opts.trackIndex ?? 1;
  const src = opts.src ?? `compositions/scene-${opts.id}.html`;
  return `<div class="clip" data-composition-id="${esc(opts.id)}" data-composition-src="${esc(src)}" data-start="${start}" data-duration="${duration}" data-track-index="${track}"></div>`;
}

/**
 * Insert a clip reference inside the root composition's `#root` div, just
 * before its closing `</div>`. Throws if the expected closing tag isn't
 * found — callers should surface this as a structured error so users know
 * to inspect a hand-edited root.
 *
 * Also grows the root's `data-duration` to fit the new clip's end-time.
 */
export function insertClipIntoRoot(rootHtml: string, clip: ClipReferenceInput): string {
  const clipDiv = buildClipReference(clip);

  // Find the root closing tag. Match `</div>` followed by blank line + `<script>`,
  // which matches `buildEmptyRootHtml` and any user-edited root that keeps the
  // standard structure.
  const closeMatch = rootHtml.match(/\n(\s*)<\/div>(\s*\n\s*<script>)/);
  if (!closeMatch) {
    throw new Error(
      "Could not find root composition closing </div>. Ensure index.html follows the layout from `vibe scene init`."
    );
  }
  const closeIdx = closeMatch.index!;
  const closeIndent = closeMatch[1];
  const childIndent = closeIndent + "  ";

  // Splice the clip just above the closing div, indented one level deeper.
  const insertion = `\n${childIndent}${clipDiv}`;
  let updated = rootHtml.slice(0, closeIdx) + insertion + rootHtml.slice(closeIdx);

  // Grow root data-duration to fit the new clip end (never shrink — preserves
  // user-set padding).
  const newEnd = clip.start + clip.duration;
  updated = updated.replace(
    /(<div\b[^>]*\bid="root"[^>]*\bdata-duration=")([\d.]+)(")/,
    (_full, prefix: string, value: string, suffix: string) => {
      const current = parseFloat(value);
      const next = Math.max(current, newEnd);
      return `${prefix}${Number(next.toFixed(3))}${suffix}`;
    },
  );

  return updated;
}

/**
 * Read the root composition's canvas dims by parsing `data-width`/`data-height`
 * on the `#root` div. Returns null if either is missing — caller should fall
 * back to the project's aspect config.
 */
export function readRootDims(rootHtml: string): { width: number; height: number } | null {
  const widthMatch = rootHtml.match(/<div\b[^>]*\bid="root"[^>]*\bdata-width="(\d+)"/);
  const heightMatch = rootHtml.match(/<div\b[^>]*\bid="root"[^>]*\bdata-height="(\d+)"/);
  if (!widthMatch || !heightMatch) return null;
  return { width: parseInt(widthMatch[1], 10), height: parseInt(heightMatch[1], 10) };
}
