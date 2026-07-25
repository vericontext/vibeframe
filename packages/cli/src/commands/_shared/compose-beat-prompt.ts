/**
 * @module _shared/compose-beat-prompt
 *
 * Per-beat authoring contract handed to the HOST agent. `getComposePrompts()`
 * (and therefore `vibe scene compose-prompts` / `scene_compose_prompts`) uses
 * this to describe exactly what one `compositions/scene-<id>.html` fragment
 * must contain: the bare `<template>` shape, the paused GSAP timeline anchored
 * to the full beat duration, full-window `.clip` rules, and which generated
 * assets to reference.
 *
 * These rules were written against the Hyperframes sub-composition contract
 * and every one of them encodes a render bug we hit: black holds from a short
 * timeline, stacked text from non-zero `data-start` phase clips, shimmer from
 * transforms on text ancestors.
 */

import type { Beat } from "./storyboard-parse.js";
import type { SceneTranscriptWord } from "./scene-html-emit.js";

/** The slice of beat context the prompt builder needs. */
export interface ComposeBeatPromptContext {
  beat: Beat;
  storyboardGlobal: string;
  retryFeedback?: string;
  finalDurationSec?: number;
  transcript?: SceneTranscriptWord[];
}

/**
 * Render a beat's declarative cues back into the prompt.
 *
 * A storyboard beat's prose body is often empty because the intent lives in
 * the cues, so the prompt has to carry them explicitly or the author sees only
 * a bare heading.
 */
function formatBeatCues(cues: Beat["cues"]): string {
  if (!cues) return "";
  const lines: string[] = ["", "**Beat cues** (declarative, machine-readable):"];
  if (cues.narration !== undefined) {
    lines.push(`- narration: ${JSON.stringify(cues.narration)}`);
  }
  if (cues.backdrop !== undefined) {
    lines.push(`- backdrop: ${JSON.stringify(cues.backdrop)}`);
  }
  if (cues.duration !== undefined) {
    lines.push(`- duration: ${cues.duration}s`);
  }
  if (cues.voice !== undefined) {
    lines.push(`- voice: ${JSON.stringify(cues.voice)}`);
  }
  // Surface unknown keys verbatim so users can extend cue semantics
  // (e.g. \`bgm\`, \`accent\`) without us coupling to every name.
  for (const [k, v] of Object.entries(cues)) {
    if (["narration", "backdrop", "duration", "voice"].includes(k)) continue;
    lines.push(`- ${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Word-level timing entries above this count are downgraded to coarse,
 * phrase-level anchors in the prompt. A token-budget guard: a 60s narration
 * can exceed 150 words, and inlining every `[start, "word"]` pair bloats the
 * prompt (and the cache key) for little composer benefit past a point.
 */
export const TRANSCRIPT_PROMPT_MAX_WORDS = 120;

/**
 * Render narration word timings as a compact, deterministic prompt section.
 * Token-budget guard (the `oversized` case is the reason this is a function,
 * not an inline template):
 *   - no transcript → `""` (section omitted entirely; prompt unchanged).
 *   - ≤ {@link TRANSCRIPT_PROMPT_MAX_WORDS} → full word-level `[start, "word"]`
 *     table the composer can map 1:1 to GSAP reveals.
 *   - more → group into ~`MAX/2` phrase anchors (start time of each phrase),
 *     tagged "approximate" so the composer paces reveals across the beat
 *     rather than over-trusting per-word truth.
 * Pure and stable for a given input → the compose cache stays consistent.
 */
export function formatTranscriptSection(
  transcript: SceneTranscriptWord[] | undefined,
  maxWords = TRANSCRIPT_PROMPT_MAX_WORDS
): string {
  if (!transcript || transcript.length === 0) return "";
  const round = (n: number): number => Number(Math.max(0, n).toFixed(2));
  const noAudioRule =
    "This is for VISUAL sync only — do NOT add an `<audio>` tag or invent SFX; " +
    "the narration audio is wired separately by the root timeline. If this beat " +
    "is visual-only (no on-screen text), you may ignore these timings.";

  if (transcript.length <= maxWords) {
    const pairs = transcript
      .map((w) => `[${round(w.start)}, ${JSON.stringify(w.text)}]`)
      .join(", ");
    return `

=== Narration word timings (seconds) ===

Whisper word-level start times for this beat's narration. If you author captions
or kinetic typography, reveal each word at its start time with absolute-time
GSAP tweens, e.g.
\`tl.fromTo('.caption .word[data-i="0"]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.18 }, ${round(
      transcript[0]!.start
    )});\`
${noAudioRule}

word starts (word-level): ${pairs}`;
  }

  // Oversized → phrase-level anchors. Chunk so the table stays ~maxWords/2
  // entries regardless of narration length.
  const phraseCount = Math.max(1, Math.floor(maxWords / 2));
  const chunkSize = Math.ceil(transcript.length / phraseCount);
  const anchors: string[] = [];
  for (let i = 0; i < transcript.length; i += chunkSize) {
    const chunk = transcript.slice(i, i + chunkSize);
    const text = chunk.map((w) => w.text).join(" ");
    anchors.push(`[${round(chunk[0]!.start)}, ${JSON.stringify(text)}]`);
  }
  return `

=== Narration timings (approximate, phrase-level) ===

This beat's narration is long (${transcript.length} words), so timings are
grouped into phrase-level anchors (start time of each phrase). Use them to PACE
caption / kinetic-type reveals across the beat — they are approximate, not
per-word truth.
${noAudioRule}

phrase starts (approximate): ${anchors.join(", ")}`;
}

/** Build the user prompt — instructions + storyboard global + beat body. */
export function buildUserPrompt(
  ctx: ComposeBeatPromptContext
): string {
  const compositionId = `scene-${ctx.beat.id}`;
  // When the narration-synced final duration is known, pin every duration
  // placeholder to the literal value — composing at the storyboard duration
  // while the root stretches the clip window is the black-tail bug.
  const durLiteral = ctx.finalDurationSec !== undefined ? String(ctx.finalDurationSec) : undefined;
  const SEC = durLiteral ?? "<sec>";
  const BEAT_DURATION = durLiteral ?? "<beat duration in seconds>";
  const BEAT = durLiteral ?? "<beat>";
  const BEAT_END = durLiteral ? `${durLiteral} - 0.001` : "<beat - 0.001>";
  const finalDurationBullet = durLiteral
    ? `- **FINAL beat duration: ${durLiteral}s — use this exact value everywhere.**
  This is the storyboard duration stretched to cover the generated narration
  audio. Use exactly \`data-duration="${durLiteral}"\` on the composition root,
  size full-beat \`.clip\` elements to end at ${durLiteral}s, and anchor the
  timeline (idle motion or end \`tl.set\`) to exactly ${durLiteral}s. If the
  beat cues show a different \`duration:\` value, that is only the storyboard
  minimum — ignore it.
`
    : "";
  const cueDurationNote =
    durLiteral &&
    ctx.beat.cues?.duration !== undefined &&
    Number(ctx.beat.cues.duration) !== ctx.finalDurationSec
      ? `\n(The \`duration: ${ctx.beat.cues.duration}s\` cue above is the storyboard minimum — superseded by the final synced duration ${durLiteral}s.)\n`
      : "";

  const baseRequirements = `Build the Hyperframes sub-composition HTML for this beat. The composition
will be loaded into a root index.html via
\`data-composition-src="compositions/${compositionId}.html"\`.

Requirements (non-negotiable):

- **Output must be a BARE \`<template>...</template>\` fragment.** Do NOT
  wrap it in \`<!DOCTYPE html>\`, \`<html>\`, \`<head>\`, or \`<body>\` —
  Hyperframes' producer reads the file as a fragment and full-document
  wrappers break sub-composition parsing.
- Wrapper template id: \`${compositionId}-template\`. Inner div has
  \`data-composition-id="${compositionId}"\` AND \`data-start="0"\` AND
  \`data-duration="${BEAT_DURATION}"\` AND \`data-width="1920"\`
  AND \`data-height="1080"\`.
${finalDurationBullet}
- One paused GSAP timeline registered on \`window.__timelines["${compositionId}"]\`.
- **Timeline total duration MUST equal the beat \`data-duration\`.** Hyperframes
  renders in screenshot-capture mode with virtual time; if the timeline ends
  before the beat (e.g., entry tweens covering 0–1.4s of a 3s beat), the
  producer's seek lands past the timeline's natural end and visibility state
  goes stale — the hold phase renders BLACK. Anchor the timeline to the full
  beat duration via either:
    1. A subtle idle motion spanning 0→duration on a background/media layer,
       e.g. \`tl.fromTo(".backdrop", { scale: 1.0 }, { scale: 1.015, duration: ${BEAT}, ease: "none" }, 0);\`
       (Ken-Burns, breathing opacity, gradient drift — should be barely
       perceptible so it doesn't compete with entry/exit beats).
    2. OR an explicit \`tl.set(target, { ...natural state... }, ${BEAT_END})\`
       anchor at the end.
  This is the #2 source of "text disappears mid-beat" bugs after \`.clip\` sizing.
- Do not apply continuous \`scale\`, \`x\`, \`y\`, \`filter\`, or other transform
  tweens to \`.scene-content\` or any ancestor that contains live text/cards.
  Animate the backdrop/media plane instead; let text enter briefly, then hold
  still at its final CSS position. Continuous transforms on text ancestors can
  create subpixel shimmer in screenshot-captured renders.
- Inner \`.clip\` elements carry \`data-start\`, \`data-duration\`,
  \`data-track-index\` — but **every inner clip MUST be full-window:
  \`data-start="0"\` spanning the whole beat.** The renderer does NOT toggle
  internal clip visibility inside sub-compositions, so "phase clips" with a
  non-zero \`data-start\` render ALL phases at once and text stacks on top of
  itself. For multi-phase beats, drive phase changes with GSAP \`autoAlpha\`
  inside full-window clips: animate phase A out (\`autoAlpha: 0\`), then
  phase B in, on the same timeline.
- If \`assets/video-${ctx.beat.id}.mp4\` exists, it is an AI-generated clip for
  this beat — use it as the FULL-FRAME visual and prefer it over any backdrop
  image or CSS. Put one full-bleed \`<video>\` inside a full-window \`.clip\`:
  \`<video src="assets/video-${ctx.beat.id}.mp4" data-start="0" data-duration="${BEAT_DURATION}" data-media-start="0" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>\`
  Use the exact path (no \`./\` or \`../\`). The framework seeks the clip to each
  timeline frame, so do NOT add transform tweens to the \`<video>\` or its
  ancestors; layer text/motion graphics on top instead.
- If \`assets/backdrop-${ctx.beat.id}.png\` exists (and no video clip above),
  use that local file as the
  full-frame visual backdrop. The exact path string is
  \`assets/backdrop-${ctx.beat.id}.png\`; do NOT prefix it with \`../\` or \`./\`
  because fragments are mounted from the project root.
- If no generated backdrop is available (for example the user ran
  \`--skip-backdrop\`), create a cue-derived CSS/HTML visual instead. The
  fallback must still match the beat's \`backdrop\`, \`motion\`, and
  \`narration\` cues; do not fall back to generic abstract cards.
- Visible copy must be derived from the beat narration and motion cues. Do not
  invent unrelated slogans, metrics, URLs, or CTAs that contradict the
  narration.
- Keep a meaningful visual progression across the full beat duration: line
  tracing, gentle camera drift, staged labels, value cards, or parallax. Avoid
  a completed static frame holding silently for most of the beat. For longer
  beats, progress through content phases with GSAP autoAlpha (old phase out,
  new phase in) — never with inner clip windows.
- Do not import external font or image URLs. Use the project DESIGN.md font
  choice when explicit; otherwise use \`Inter\`, which is available in the
  deterministic render font map.
- If the beat cues include \`narration\`, do not embed an \`<audio>\` tag in the
  scene fragment. The root timeline wires \`assets/narration-${ctx.beat.id}.wav\`
  or \`assets/narration-${ctx.beat.id}.mp3\` separately.
- Do NOT invent sound effects. This scene fragment is visual-only: never add
  an \`<audio>\` tag, and never imply ambient/foley SFX (keyboard clicks, whoosh,
  applause, room tone) that the beat did not explicitly request. Audio comes
  only from the beat's explicit \`narration\` and \`music\` cues, wired by the
  root timeline. If the beat declares an explicit \`sfx\` cue, treat it as intent
  for the storyboard author — still do not embed it here — and only when it is
  clearly tied to the beat's narration/motion; ignore orphaned or generic SFX.
- **\`.clip\` elements get visibility control from the framework but NO
  sizing.** Always give \`.clip\` explicit fill via CSS:
  \`{ position: absolute; inset: 0; }\` (or equivalent
  \`width: 100%; height: 100%; top: 0; left: 0;\`). Without this, the
  \`.clip\` collapses to its content size and any flex-centering inside
  it breaks. THIS IS THE #1 SOURCE OF "TEXT NOT RENDERING / WRONG
  POSITION" BUGS — do not skip the rule.
- Composition root must declare its absolute size in CSS:
  \`[data-composition-id="${compositionId}"] { position: relative; width: 1920px; height: 1080px; }\`.
- No \`Math.random()\`, \`Date.now()\`, \`repeat: -1\`, or \`<br>\` in content.
- Layout-before-animation: position elements at hero-frame state in CSS,
  animate FROM that position.
- No exit animations (transitions handle scene exits, except the final beat).
- Strictly follow DESIGN.md palette, typography, motion signature.

Reference shape (verbatim — match this skeleton exactly, no DOCTYPE / html / body):

\`\`\`
<template id="${compositionId}-template">
  <div data-composition-id="${compositionId}" data-start="0" data-duration="${SEC}" data-width="1920" data-height="1080">
    <style>
      [data-composition-id="${compositionId}"] {
        position: relative;
        width: 1920px;
        height: 1080px;
        background: /* from DESIGN.md */;
        overflow: hidden;
      }
      /* Critical: .clip elements get framework visibility control but NOT
         sizing — give them explicit fill or content centering breaks. */
      [data-composition-id="${compositionId}"] .clip {
        position: absolute;
        inset: 0;
      }
      /* …per-element styles… */
    </style>

    <div class="clip" data-start="0" data-duration="${SEC}" data-track-index="0">
      <!-- content; can use display:flex etc. since .clip now fills the scene -->
    </div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // Idle motion spanning full beat duration — required to keep timeline
      // length aligned with data-duration (otherwise hold phase goes black).
      // Keep continuous motion on the background/media layer so live text does
      // not shimmer from subpixel resampling.
      tl.fromTo(".backdrop", { scale: 1.0 }, { scale: 1.015, duration: ${SEC}, ease: "none" }, 0);
      // entry tweens
      window.__timelines["${compositionId}"] = tl;
    </script>
  </div>
</template>
\`\`\`

=== Storyboard — global direction ===

${ctx.storyboardGlobal || "(no global direction)"}

=== Beat to build ===

## ${ctx.beat.heading}
${formatBeatCues(ctx.beat.cues)}${cueDurationNote}
${ctx.beat.body}${formatTranscriptSection(ctx.transcript)}

=== Output format ===

Return ONE bare \`<template>\` fragment in a single \`\`\`html\`\`\` fenced code
block. No \`<!DOCTYPE>\`, no \`<html>\`, no prose, no explanations, no
commentary outside the code block. Just the template.`;

  if (ctx.retryFeedback && ctx.retryFeedback.trim().length > 0) {
    return `${baseRequirements}

=== Previous attempt failed lint with the following findings — fix them ===

${ctx.retryFeedback.trim()}`;
  }

  return baseRequirements;
}
