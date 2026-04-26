/**
 * @module _shared/hf-skill-bundle/bundle-content
 *
 * Vendored Hyperframes skill content as TS template-literal constants.
 * AUTO-GENERATED — regenerate via `scripts/refresh-hf-bundle.sh`. Do not
 * hand-edit; modify the sibling .md files (audit reference) and re-run
 * the script.
 *
 * Source: github.com/heygen-com/hyperframes (Apache 2.0). See `./NOTICE`
 * for license + provenance, and `/CREDITS.md` for the relationship.
 */

export const SKILL_MD = `---
name: hyperframes
description: Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML. Use when asked to build any HTML-based video content, add captions or subtitles synced to audio, generate text-to-speech narration, create audio-reactive animation (beat sync, glow, pulse driven by music), add animated text highlighting (marker sweeps, hand-drawn circles, burst lines, scribble, sketchout), or add transitions between scenes (crossfades, wipes, reveals, shader transitions). Covers composition authoring, timing, media, and the full video production workflow. For CLI commands (init, lint, preview, render, transcribe, tts) see the hyperframes-cli skill.
---

# HyperFrames

HTML is the source of truth for video. A composition is an HTML file with \`data-*\` attributes for timing, a GSAP timeline for animation, and CSS for appearance. The framework handles clip visibility, media playback, and timeline sync.

## Approach

Before writing HTML, think at a high level:

1. **What** — what should the viewer experience? Identify the narrative arc, key moments, and emotional beats.
2. **Structure** — how many compositions, which are sub-compositions vs inline, what tracks carry what (video, audio, overlays, captions).
3. **Timing** — which clips drive the duration, where do transitions land, what's the pacing.
4. **Layout** — build the end-state first. See "Layout Before Animation" below.
5. **Animate** — then add motion using the rules below.

For small edits (fix a color, adjust timing, add one element), skip straight to the rules.

### Visual Identity Gate

<HARD-GATE>
Before writing ANY composition HTML, you MUST have a visual identity defined. Do NOT write compositions with default or generic colors.

Check in this order:

1. **DESIGN.md exists in the project?** → Read it. Use its exact colors, fonts, motion rules, and "What NOT to Do" constraints.
2. **visual-style.md exists?** → Read it. Apply its \`style_prompt_full\` and structured fields. (Note: \`visual-style.md\` is a project-specific file. \`visual-styles.md\` is the style library with 8 named presets — different files.)
3. **User named a style** (e.g., "Swiss Pulse", "dark and techy", "luxury brand")? → Read [visual-styles.md](./visual-styles.md) for the 8 named presets. Generate a minimal DESIGN.md with: \`## Style Prompt\` (one paragraph), \`## Colors\` (3-5 hex values with roles), \`## Typography\` (1-2 font families), \`## What NOT to Do\` (3-5 anti-patterns).
4. **None of the above?** → Ask 3 questions before writing any HTML:
   - What's the mood? (explosive / cinematic / fluid / technical / chaotic / warm)
   - Light or dark canvas?
   - Any specific brand colors, fonts, or visual references?
     Then generate a minimal DESIGN.md from the answers.

Every composition must trace its palette and typography back to a DESIGN.md, visual-style.md, or explicit user direction. If you're reaching for \`#333\`, \`#3b82f6\`, or \`Roboto\` — you skipped this step.
</HARD-GATE>

For motion defaults, sizing, entrance patterns, and easing — follow [house-style.md](./house-style.md). The house style handles HOW things move. The DESIGN.md handles WHAT things look like.

## Layout Before Animation

Position every element where it should be at its **most visible moment** — the frame where it's fully entered, correctly placed, and not yet exiting. Write this as static HTML+CSS first. No GSAP yet.

**Why this matters:** If you position elements at their animated start state (offscreen, scaled to 0, opacity 0) and tween them to where you think they should land, you're guessing the final layout. Overlaps are invisible until the video renders. By building the end state first, you can see and fix layout problems before adding any motion.

### The process

1. **Identify the hero frame** for each scene — the moment when the most elements are simultaneously visible. This is the layout you build.
2. **Write static CSS** for that frame. The \`.scene-content\` container MUST fill the full scene using \`width: 100%; height: 100%; padding: Npx;\` with \`display: flex; flex-direction: column; gap: Npx; box-sizing: border-box\`. Use padding to push content inward — NEVER \`position: absolute; top: Npx\` on a content container. Absolute-positioned content containers overflow when content is taller than the remaining space. Reserve \`position: absolute\` for decoratives only.
3. **Add entrances with \`gsap.from()\`** — animate FROM offscreen/invisible TO the CSS position. The CSS position is the ground truth; the tween describes the journey to get there.
4. **Add exits with \`gsap.to()\`** — animate TO offscreen/invisible FROM the CSS position.

### Example

\`\`\`css
/* scene-content fills the scene, padding positions content */
.scene-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 120px 160px;
  gap: 24px;
  box-sizing: border-box;
}
.title {
  font-size: 120px;
}
.subtitle {
  font-size: 42px;
}
/* Container fills any scene size (1920x1080, 1080x1920, etc).
   Padding positions content. Flex + gap handles spacing. */
\`\`\`

**WRONG — hardcoded dimensions and absolute positioning:**

\`\`\`css
.scene-content {
  position: absolute;
  top: 200px;
  left: 160px;
  width: 1920px;
  height: 1080px;
  display: flex; /* ... */
}
\`\`\`

\`\`\`js
// Step 3: Animate INTO those positions
tl.from(".title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0);
tl.from(".subtitle", { y: 40, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.2);
tl.from(".logo", { scale: 0.8, opacity: 0, duration: 0.4, ease: "power2.out" }, 0.3);

// Step 4: Animate OUT from those positions
tl.to(".title", { y: -40, opacity: 0, duration: 0.4, ease: "power2.in" }, 3);
tl.to(".subtitle", { y: -30, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.1);
tl.to(".logo", { scale: 0.9, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.2);
\`\`\`

### When elements share space across time

If element A exits before element B enters in the same area, both should have correct CSS positions for their respective hero frames. The timeline ordering guarantees they never visually coexist — but if you skip the layout step, you won't catch the case where they accidentally overlap due to a timing error.

### What counts as intentional overlap

Layered effects (glow behind text, shadow elements, background patterns) and z-stacked designs (card stacks, depth layers) are intentional. The layout step is about catching **unintentional** overlap — two headlines landing on top of each other, a stat covering a label, content bleeding off-frame.

## Data Attributes

### All Clips

| Attribute          | Required                          | Values                                                 |
| ------------------ | --------------------------------- | ------------------------------------------------------ |
| \`id\`               | Yes                               | Unique identifier                                      |
| \`data-start\`       | Yes                               | Seconds or clip ID reference (\`"el-1"\`, \`"intro + 2"\`) |
| \`data-duration\`    | Required for img/div/compositions | Seconds. Video/audio defaults to media duration.       |
| \`data-track-index\` | Yes                               | Integer. Same-track clips cannot overlap.              |
| \`data-media-start\` | No                                | Trim offset into source (seconds)                      |
| \`data-volume\`      | No                                | 0-1 (default 1)                                        |

\`data-track-index\` does **not** affect visual layering — use CSS \`z-index\`.

### Composition Clips

| Attribute                    | Required | Values                                       |
| ---------------------------- | -------- | -------------------------------------------- |
| \`data-composition-id\`        | Yes      | Unique composition ID                        |
| \`data-start\`                 | Yes      | Start time (root composition: use \`"0"\`)     |
| \`data-duration\`              | Yes      | Takes precedence over GSAP timeline duration |
| \`data-width\` / \`data-height\` | Yes      | Pixel dimensions (1920x1080 or 1080x1920)    |
| \`data-composition-src\`       | No       | Path to external HTML file                   |

## Composition Structure

Sub-compositions loaded via \`data-composition-src\` use a \`<template>\` wrapper. **Standalone compositions (the main index.html) do NOT use \`<template>\`** — they put the \`data-composition-id\` div directly in \`<body>\`. Using \`<template>\` on a standalone file hides all content from the browser and breaks rendering.

Sub-composition structure:

\`\`\`html
<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080">
    <!-- content -->
    <style>
      [data-composition-id="my-comp"] {
        /* scoped styles */
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // tweens...
      window.__timelines["my-comp"] = tl;
    </script>
  </div>
</template>
\`\`\`

Load in root: \`<div id="el-1" data-composition-id="my-comp" data-composition-src="compositions/my-comp.html" data-start="0" data-duration="10" data-track-index="1"></div>\`

## Video and Audio

Video must be \`muted playsinline\`. Audio is always a separate \`<audio>\` element:

\`\`\`html
<video
  id="el-v"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
<audio
  id="el-a"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="video.mp4"
  data-volume="1"
></audio>
\`\`\`

## Timeline Contract

- All timelines start \`{ paused: true }\` — the player controls playback
- Register every timeline: \`window.__timelines["<composition-id>"] = tl\`
- Framework auto-nests sub-timelines — do NOT manually add them
- Duration comes from \`data-duration\`, not from GSAP timeline length
- Never create empty tweens to set duration

## Rules (Non-Negotiable)

**Deterministic:** No \`Math.random()\`, \`Date.now()\`, or time-based logic. Use a seeded PRNG if you need pseudo-random values (e.g. mulberry32).

**GSAP:** Only animate visual properties (\`opacity\`, \`x\`, \`y\`, \`scale\`, \`rotation\`, \`color\`, \`backgroundColor\`, \`borderRadius\`, transforms). Do NOT animate \`visibility\`, \`display\`, or call \`video.play()\`/\`audio.play()\`.

**Animation conflicts:** Never animate the same property on the same element from multiple timelines simultaneously.

**No \`repeat: -1\`:** Infinite-repeat timelines break the capture engine. Calculate the exact repeat count from composition duration: \`repeat: Math.ceil(duration / cycleDuration) - 1\`.

**Synchronous timeline construction:** Never build timelines inside \`async\`/\`await\`, \`setTimeout\`, or Promises. The capture engine reads \`window.__timelines\` synchronously after page load. Fonts are embedded by the compiler, so they're available immediately — no need to wait for font loading.

**Never do:**

1. Forget \`window.__timelines\` registration
2. Use video for audio — always muted video + separate \`<audio>\`
3. Nest video inside a timed div — use a non-timed wrapper
4. Use \`data-layer\` (use \`data-track-index\`) or \`data-end\` (use \`data-duration\`)
5. Animate video element dimensions — animate a wrapper div
6. Call play/pause/seek on media — framework owns playback
7. Create a top-level container without \`data-composition-id\`
8. Use \`repeat: -1\` on any timeline or tween — always finite repeats
9. Build timelines asynchronously (inside \`async\`, \`setTimeout\`, \`Promise\`)
10. Use \`gsap.set()\` on clip elements from later scenes — they don't exist in the DOM at page load. Use \`tl.set(selector, vars, timePosition)\` inside the timeline at or after the clip's \`data-start\` time instead.
11. Use \`<br>\` in content text — forced line breaks don't account for actual rendered font width. Text that wraps naturally + a \`<br>\` produces an extra unwanted break, causing overlap. Let text wrap via \`max-width\` instead. Exception: short display titles where each word is deliberately on its own line (e.g., "THE\\nIMMORTAL\\nGAME" at 130px).

## Scene Transitions (Non-Negotiable)

Every multi-scene composition MUST follow ALL of these rules. Violating any one of them is a broken composition.

1. **ALWAYS use transitions between scenes.** No jump cuts. No exceptions.
2. **ALWAYS use entrance animations on every scene.** Every element animates IN via \`gsap.from()\`. No element may appear fully-formed. If a scene has 5 elements, it needs 5 entrance tweens.
3. **NEVER use exit animations** except on the final scene. This means: NO \`gsap.to()\` that animates opacity to 0, y offscreen, scale to 0, or any other "out" animation before a transition fires. The transition IS the exit. The outgoing scene's content MUST be fully visible at the moment the transition starts.
4. **Final scene only:** The last scene may fade elements out (e.g., fade to black). This is the ONLY scene where \`gsap.to(..., { opacity: 0 })\` is allowed.

**WRONG — exit animation before transition:**

\`\`\`js
// BANNED — this empties the scene before the transition can use it
tl.to("#s1-title", { opacity: 0, y: -40, duration: 0.4 }, 6.5);
tl.to("#s1-subtitle", { opacity: 0, duration: 0.3 }, 6.7);
// transition fires on empty frame
\`\`\`

**RIGHT — entrance only, transition handles exit:**

\`\`\`js
// Scene 1 entrance animations
tl.from("#s1-title", { y: 50, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.3);
tl.from("#s1-subtitle", { y: 30, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.6);
// NO exit tweens — transition at 7.2s handles the scene change
// Scene 2 entrance animations
tl.from("#s2-heading", { x: -40, opacity: 0, duration: 0.6, ease: "expo.out" }, 8.0);
\`\`\`

## Animation Guardrails

- Offset first animation 0.1-0.3s (not t=0)
- Vary eases across entrance tweens — use at least 3 different eases per scene
- Don't repeat an entrance pattern within a scene
- Avoid full-screen linear gradients on dark backgrounds (H.264 banding — use radial or solid + localized glow)
- 60px+ headlines, 20px+ body, 16px+ data labels for rendered video
- \`font-variant-numeric: tabular-nums\` on number columns

When no \`visual-style.md\` or animation direction is provided, follow [house-style.md](./house-style.md) for aesthetic defaults.

## Typography and Assets

- **Fonts:** Just write the \`font-family\` you want in CSS — the compiler embeds supported fonts automatically. If a font isn't supported, the compiler warns.
- Add \`crossorigin="anonymous"\` to external media
- For dynamic text overflow, use \`window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })\`
- All files live at the project root alongside \`index.html\`; sub-compositions use \`../\`

## Editing Existing Compositions

- Read the full composition first — match existing fonts, colors, animation patterns
- Only change what was requested
- Preserve timing of unrelated clips

## Output Checklist

- [ ] \`npx hyperframes lint\` and \`npx hyperframes validate\` both pass
- [ ] \`npx hyperframes inspect\` passes, or every reported overflow is intentionally marked
- [ ] Contrast warnings addressed (see Quality Checks below)
- [ ] Layout issues addressed (see Quality Checks below)
- [ ] Animation choreography verified (see Quality Checks below)

## Quality Checks

### Visual Inspect

\`hyperframes inspect\` runs the composition in headless Chrome, seeks through the timeline, and maps visual layout issues with timestamps, selectors, bounding boxes, and fix hints. Run it after \`lint\` and \`validate\`:

\`\`\`bash
npx hyperframes inspect
npx hyperframes inspect --json
\`\`\`

Failures usually mean text is spilling out of a bubble/card, a fixed-size label is clipping dynamic copy, or text has moved off the canvas. Fix by increasing container size or padding, reducing font size or letter spacing, adding a real \`max-width\` so text wraps inside the container, or using \`window.__hyperframes.fitTextFontSize(...)\` for dynamic copy.

Use \`--samples 15\` for dense videos and \`--at 1.5,4,7.25\` for specific hero frames. Repeated static issues are collapsed by default to avoid flooding agent context. If overflow is intentional for an entrance/exit animation, mark the element or ancestor with \`data-layout-allow-overflow\`. If a decorative element should never be audited, mark it with \`data-layout-ignore\`.

\`hyperframes layout\` is the compatibility alias for the same check.

### Contrast

\`hyperframes validate\` runs a WCAG contrast audit by default. It seeks to 5 timestamps, screenshots the page, samples background pixels behind every text element, and computes contrast ratios. Failures appear as warnings:

\`\`\`
⚠ WCAG AA contrast warnings (3):
  · .subtitle "secondary text" — 2.67:1 (need 4.5:1, t=5.3s)
\`\`\`

If warnings appear:

- On dark backgrounds: brighten the failing color until it clears 4.5:1 (normal text) or 3:1 (large text, 24px+ or 19px+ bold)
- On light backgrounds: darken it
- Stay within the palette family — don't invent a new color, adjust the existing one
- Re-run \`hyperframes validate\` until clean

Use \`--no-contrast\` to skip if iterating rapidly and you'll check later.

### Animation Map

After authoring animations, run the animation map to verify choreography:

\`\`\`bash
node skills/hyperframes/scripts/animation-map.mjs <composition-dir> \\
  --out <composition-dir>/.hyperframes/anim-map
\`\`\`

Outputs a single \`animation-map.json\` with:

- **Per-tween summaries**: \`"#card1 animates opacity+y over 0.50s. moves 23px up. fades in. ends at (120, 200)"\`
- **ASCII timeline**: Gantt chart of all tweens across the composition duration
- **Stagger detection**: reports actual intervals (\`"3 elements stagger at 120ms"\`)
- **Dead zones**: periods over 1s with no animation — intentional hold or missing entrance?
- **Element lifecycles**: first/last animation time, final visibility
- **Scene snapshots**: visible element state at 5 key timestamps
- **Flags**: \`offscreen\`, \`collision\`, \`invisible\`, \`paced-fast\` (under 0.2s), \`paced-slow\` (over 2s)

Read the JSON. Scan summaries for anything unexpected. Check every flag — fix or justify. Verify the timeline shows the intended choreography rhythm. Re-run after fixes.

Skip on small edits (fixing a color, adjusting one duration). Run on new compositions and significant animation changes.

---

## References (loaded on demand)

- **[references/captions.md](references/captions.md)** — Captions, subtitles, lyrics, karaoke synced to audio. Tone-adaptive style detection, per-word styling, text overflow prevention, caption exit guarantees, word grouping. Read when adding any text synced to audio timing.
- **[references/tts.md](references/tts.md)** — Text-to-speech with Kokoro-82M. Voice selection, speed tuning, TTS+captions workflow. Read when generating narration or voiceover.
- **[references/audio-reactive.md](references/audio-reactive.md)** — Audio-reactive animation: map frequency bands and amplitude to GSAP properties. Read when visuals should respond to music, voice, or sound.
- **[references/css-patterns.md](references/css-patterns.md)** — CSS+GSAP marker highlighting: highlight, circle, burst, scribble, sketchout. Deterministic, fully seekable. Read when adding visual emphasis to text.
- **[references/typography.md](references/typography.md)** — Typography: font pairing, OpenType features, dark-background adjustments, font discovery script. **Always read** — every composition has text.
- **[references/motion-principles.md](references/motion-principles.md)** — Motion design principles: easing as emotion, timing as weight, choreography as hierarchy, scene pacing, ambient motion, anti-patterns. Read when choreographing GSAP animations.
- **[visual-styles.md](visual-styles.md)** — 8 named visual styles (Swiss Pulse, Velvet Standard, Deconstructed, Maximalist Type, Data Drift, Soft Signal, Folk Frequency, Shadow Cut) with hex palettes, GSAP easing signatures, and shader pairings. Read when user names a style or when generating DESIGN.md.
- **[house-style.md](house-style.md)** — Default motion, sizing, and color palettes when no style is specified.
- **[patterns.md](patterns.md)** — PiP, title cards, slide show patterns.
- **[data-in-motion.md](data-in-motion.md)** — Data, stats, and infographic patterns.
- **[references/transcript-guide.md](references/transcript-guide.md)** — Transcription commands, whisper models, external APIs, troubleshooting.
- **[references/dynamic-techniques.md](references/dynamic-techniques.md)** — Dynamic caption animation techniques (karaoke, clip-path, slam, scatter, elastic, 3D).

- **[references/transitions.md](references/transitions.md)** — Scene transitions: crossfades, wipes, reveals, shader transitions. Energy/mood selection, CSS vs WebGL guidance. **Always read for multi-scene compositions** — scenes without transitions feel like jump cuts.
  - [transitions/catalog.md](references/transitions/catalog.md) — Hard rules, scene template, and routing to per-type implementation code.
  - Shader transitions are in \`@hyperframes/shader-transitions\` (\`packages/shader-transitions/\`) — read package source, not skill files.

GSAP patterns and effects are in the \`/gsap\` skill.
`;

export const HOUSE_STYLE_MD = `# House Style

Creative direction for compositions when no \`visual-style.md\` is provided. These are starting points — override anything that doesn't serve the content.

## Before Writing HTML

1. **Interpret the prompt.** Generate real content. A recipe lists real ingredients. A HUD has real readouts.
2. **Pick a palette.** Light or dark? Declare bg, fg, accent before writing code.
3. **Pick typefaces.** Run the font discovery script in [references/typography.md](references/typography.md) — or pick a font you already know that fits the theme. The script broadens your options; it's not the only source.

## Lazy Defaults to Question

These patterns are AI design tells — the first thing every LLM reaches for. If you're about to use one, pause and ask: is this a deliberate choice for THIS content, or am I defaulting?

- Gradient text (\`background-clip: text\` + gradient)
- Left-edge accent stripes on cards/callouts
- Cyan-on-dark / purple-to-blue gradients / neon accents
- Pure \`#000\` or \`#fff\` (tint toward your accent hue instead)
- Identical card grids (same-size cards repeated)
- Everything centered with equal weight (lead the eye somewhere)
- Banned fonts (see [references/typography.md](references/typography.md) for full list)

If the content genuinely calls for one of these — centered layout for a solemn closing, cards for a real product UI mockup, a banned font because it's the perfect thematic match — use it. The goal is intentionality, not avoidance.

## Color

- Match light/dark to content: food, wellness, kids → light. Tech, cinema, finance → dark.
- One accent hue. Same background across all scenes.
- Tint neutrals toward your accent (even subtle warmth/coolness beats dead gray).
- **Contrast:** enforced by \`hyperframes validate\` (WCAG AA). Text must be readable with decoratives removed.
- Declare palette up front. Don't invent colors per-element.

## Background Layer

Every scene needs visual depth — persistent decorative elements that stay visible while content animates in. Without these, scenes feel empty during entrance staggering.

Ideas (mix and match, 2-5 per scene):

- Radial glows (accent-tinted, low opacity, breathing scale)
- Ghost text (theme words at 3-8% opacity, very large, slow drift)
- Accent lines (hairline rules, subtle pulse)
- Grain/noise overlay, geometric shapes, grid patterns
- Thematic decoratives (orbit rings for space, vinyl grooves for music, grid lines for data)

All decoratives should have slow ambient GSAP animation — breathing, drift, pulse. Static decoratives feel dead.

## Motion

See [references/motion-principles.md](references/motion-principles.md) for full rules. Quick: 0.3–0.6s, vary eases, combine transforms on entrances, overlap entries.

## Typography

See [references/typography.md](references/typography.md) for full rules. Quick: 700-900 headlines / 300-400 body, serif + sans (not two sans), 60px+ headlines / 20px+ body.

## Palettes

Declare one background, one foreground, one accent before writing HTML.

| Category          | Use for                                       | File                                                       |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Bold / Energetic  | Product launches, social media, announcements | [palettes/bold-energetic.md](palettes/bold-energetic.md)   |
| Warm / Editorial  | Storytelling, documentaries, case studies     | [palettes/warm-editorial.md](palettes/warm-editorial.md)   |
| Dark / Premium    | Tech, finance, luxury, cinematic              | [palettes/dark-premium.md](palettes/dark-premium.md)       |
| Clean / Corporate | Explainers, tutorials, presentations          | [palettes/clean-corporate.md](palettes/clean-corporate.md) |
| Nature / Earth    | Sustainability, outdoor, organic              | [palettes/nature-earth.md](palettes/nature-earth.md)       |
| Neon / Electric   | Gaming, tech, nightlife                       | [palettes/neon-electric.md](palettes/neon-electric.md)     |
| Pastel / Soft     | Fashion, beauty, lifestyle, wellness          | [palettes/pastel-soft.md](palettes/pastel-soft.md)         |
| Jewel / Rich      | Luxury, events, sophisticated                 | [palettes/jewel-rich.md](palettes/jewel-rich.md)           |
| Monochrome        | Dramatic, typography-focused                  | [palettes/monochrome.md](palettes/monochrome.md)           |

Or derive from OKLCH — pick a hue, build bg/fg/accent at different lightnesses, tint everything toward that hue.
`;

export const MOTION_PRINCIPLES_MD = `# Motion Principles

## Guardrails

You know these rules but you violate them. Stop.

- **Don't use the same ease on every tween.** You default to \`power2.out\` on everything. Vary eases like you vary font weights — no more than 2 independent tweens with the same ease in a scene.
- **Don't use the same speed on everything.** You default to 0.4-0.5s for everything. The slowest scene should be 3× slower than the fastest. Vary duration deliberately.
- **Don't enter everything from the same direction.** You default to \`y: 30, opacity: 0\` on every element. Vary: from left, from right, from scale, opacity-only, letter-spacing.
- **Don't use the same stagger on every scene.** Each scene needs its own rhythm.
- **Don't use ambient zoom on every scene.** Pick different ambient motion per scene: slow pan, subtle rotation, scale push, color shift, or nothing. Stillness after motion is powerful.
- **Don't start at t=0.** Offset the first animation 0.1-0.3s. Zero-delay feels like a jump cut.

## What You Don't Do Without Being Told

### Easing is emotion, not technique

The transition is the verb. The easing is the adverb. A slide-in with \`expo.out\` = confident. With \`sine.inOut\` = dreamy. With \`elastic.out\` = playful. Same motion, different meaning. Choose the adverb deliberately.

**Direction rules — these are not optional:**

- \`.out\` for elements entering. Starts fast, decelerates. Feels responsive. This is your default.
- \`.in\` for elements leaving. Starts slow, accelerates away. Throws them off.
- \`.inOut\` for elements moving between positions.

You get this backwards constantly. Ease-in for entrances feels sluggish. Ease-out for exits feels reluctant.

### Speed communicates weight

- Fast (0.15-0.3s) — energy, urgency, confidence
- Medium (0.3-0.5s) — professional, most content
- Slow (0.5-0.8s) — gravity, luxury, contemplation
- Very slow (0.8-2.0s) — cinematic, emotional, atmospheric

### Scene structure: build / breathe / resolve

Every scene has three phases. You dump everything in the build and leave nothing for breathe or resolve.

- **Build (0-30%)** — elements enter, staggered. Don't dump everything at once.
- **Breathe (30-70%)** — content visible, alive with ONE ambient motion.
- **Resolve (70-100%)** — exit or decisive end. Exits are faster than entrances.

### Transitions are meaning

- **Crossfade** = "this continues"
- **Hard cut** = "wake up" / disruption
- **Slow dissolve** = "drift with me"

You crossfade everything. Use hard cuts for disruption and register shifts.

### Choreography is hierarchy

The element that moves first is perceived as most important. Stagger in order of importance, not DOM order. Don't wait for completion — overlap entries. Total stagger sequence under 500ms regardless of item count.

### Asymmetry

Entrances need longer than exits. A card takes 0.4s to appear but 0.25s to disappear.

## Visual Composition

You build for the web. Video frames are not pages.

- **Two focal points minimum per scene.** The eye needs somewhere to travel. Never a single text block floating in empty space.
- **Fill the frame.** Hero text: 60-80% of width. You will try to use web-sized elements. Don't.
- **Three layers minimum per scene.** Background treatment (glow, oversized faded type, color panel). Foreground content. Accent elements (dividers, labels, data bars).
- **Background is not empty.** Radial glows, oversized faded type bleeding off-frame, subtle border panels, hairline rules. Pure solid #000 reads as "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web pattern.
- **Split frames.** Data panel on the left, content on the right. Top bar with metadata, full-width below. Zone-based layouts, not centered stacks.
- **Use structural elements.** Rules, dividers, border panels. They create paths for the eye and animate well (scaleX from 0).
`;

export const TYPOGRAPHY_MD = `# Typography

The compiler embeds supported fonts — just write \`font-family\` in CSS.

## Banned

Training-data defaults that every LLM reaches for. These produce monoculture across compositions.

Inter, Roboto, Open Sans, Noto Sans, Arimo, Lato, Source Sans, PT Sans, Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond, Bodoni Moda, EB Garamond, Cinzel, Prata, Syne

**Syne in particular** is the most overused "distinctive" display font. It is an instant AI design tell.

## Guardrails

You know these rules but you violate them. Stop.

- **Don't pair two sans-serifs.** You do this constantly — one for headlines, one for body. Cross the boundary: serif + sans, or sans + mono.
- **One expressive font per scene.** You pick two interesting fonts trying to make it "better." One performs, one recedes.
- **Weight contrast must be extreme.** You default to 400 vs 700. Video needs 300 vs 900. The difference must be visible in motion at a glance.
- **Video sizes, not web sizes.** Body: 20px minimum. Headlines: 60px+. Data labels: 16px. You will try to use 14px. Don't.

## What You Don't Do Without Being Told

- **Tension should mean something.** Don't pattern-match pairings. Ask WHY these two fonts disagree. The pairing should embody the content's contradiction — mechanical vs human, public vs private, institutional vs personal. If you can't articulate the tension, it's arbitrary.
- **Register switching.** Assign different fonts to different communicative modes — one voice for statements, another for data, another for attribution. Not hierarchy on a page. Voices in a conversation.
- **Tension can live inside a single font.** A font that looks familiar but is secretly strange creates tension with the viewer's expectations, not with another font.
- **One variable changed = dramatic contrast.** Same letterforms, monospaced vs proportional. Same family at different optical sizes. Changing only rhythm while everything else stays constant.
- **Double personality works.** Two expressive fonts can coexist if they share an attitude (both irreverent, both precise) even when their forms are completely different.
- **Time is hierarchy.** The first element to appear is the most important. In video, sequence replaces position.
- **Motion is typography.** How a word enters carries as much meaning as the font. A 0.1s slam vs a 2s fade — same font, completely different message.
- **Fixed reading time.** 3 seconds on screen = must be readable in 2. Fewer words, larger type.
- **Tracking tighter than web.** -0.03em to -0.05em on display sizes. Video encoding compresses letter detail.

## Finding Fonts

Don't default to what you know. If the content is luxury, a grotesque sans might create more tension than the expected Didone serif. Decide the register first, then search.

Save this script to \`/tmp/fontquery.py\` and run with \`curl -s 'https://fonts.google.com/metadata/fonts' > /tmp/gfonts.json && python3 /tmp/fontquery.py /tmp/gfonts.json\`:

\`\`\`python
import json, sys, random
from collections import OrderedDict

random.seed()  # true random each run

with open(sys.argv[1]) as f:
    data = json.load(f)
fonts = data.get("familyMetadataList", [])

ban = {"Inter","Roboto","Open Sans","Noto Sans","Lato","Poppins","Source Sans 3",
       "PT Sans","Nunito","Outfit","Sora","Playfair Display","Cormorant Garamond",
       "Bodoni Moda","EB Garamond","Cinzel","Prata","Arimo","Source Sans Pro","Syne"}
skip_pfx = ("Roboto","Noto ","Google Sans","Bpmf","Playwrite","Anek","BIZ ",
            "Nanum","Shippori","Sawarabi","Zen ","Kaisei","Kiwi ","Yuji ","Radio ")

def ok(f):
    if f["family"] in ban: return False
    if any(f["family"].startswith(b) for b in skip_pfx): return False
    if "latin" not in (f.get("subsets") or []): return False
    return True

seen = set()
R = OrderedDict()

# Trending Sans — recent (2022+), popular (<300)
R["Trending Sans"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") in ("Sans Serif","Display") and f.get("dateAdded","") >= "2022-01-01" and f.get("popularity",9999) < 300:
        R["Trending Sans"].append(f); seen.add(f["family"])

# Trending Serif — recent (2018+), popular (<600)
R["Trending Serif"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Serif" and f.get("dateAdded","") >= "2018-01-01" and f.get("popularity",9999) < 600:
        R["Trending Serif"].append(f); seen.add(f["family"])

# Monospace — recent (2018+), popular (<600)
R["Monospace"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Monospace" and f.get("dateAdded","") >= "2018-01-01" and f.get("popularity",9999) < 600:
        R["Monospace"].append(f); seen.add(f["family"])

# Impact & Condensed — heavy display fonts with 800+ weight
R["Impact & Condensed"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    has_heavy = any(k in list(f.get("fonts",{}).keys()) for k in ("800","900"))
    is_display = f.get("category") in ("Sans Serif","Display")
    if has_heavy and is_display and f.get("popularity",9999) < 400:
        R["Impact & Condensed"].append(f); seen.add(f["family"])

# Script & Handwriting — popular (<300)
R["Script & Handwriting"] = []
for f in fonts:
    if not ok(f) or f["family"] in seen: continue
    if f.get("category") == "Handwriting" and f.get("popularity",9999) < 300:
        R["Script & Handwriting"].append(f); seen.add(f["family"])


# Randomize the top 5 in each category so the LLM doesn't always pick the same first result
for cat in R:
    R[cat].sort(key=lambda x: x.get("popularity",9999))
    top5 = R[cat][:5]
    rest = R[cat][5:]
    random.shuffle(top5)
    R[cat] = top5 + rest
limits = {"Trending Sans":15,"Trending Serif":12,"Monospace":8,
          "Impact & Condensed":12,"Script & Handwriting":10}
for cat in R:
    items = R[cat][:limits.get(cat,10)]
    if not items: continue
    print(f"--- {cat} ({len(items)}) ---")
    for ff in items:
        var = "VAR" if ff.get("axes") else "   "
        print(f'  {ff.get("popularity"):4d} | {var} | {ff["family"]}')
    print()
\`\`\`

Five categories: trending sans, trending serif, monospace, impact/condensed, script/handwriting. All dynamically filtered from Google Fonts metadata — no hardcoded font names. Cross classification boundaries when pairing.

## Selection Thinking

Don't pick fonts by category reflex (editorial → serif, tech → mono, modern → geometric sans). That's pattern matching, not design.

1. **Name the register.** What voice is the content speaking in? Institutional authority? Personal confession? Technical precision? Casual irreverence? The register narrows the field more than the category.
2. **Think physically.** Imagine the font as a physical object the brand could ship — a museum exhibit caption, a hand-painted shop sign, a 1970s mainframe terminal manual, a fabric label inside a coat, a children's book printed on cheap newsprint, a tax form. Whichever physical object fits the register is pointing at the right _kind_ of typeface.
3. **Reject your first instinct.** The first font that feels right is usually your training-data default for that register. If you picked it last time too, find something else.
4. **Cross-check the assumption.** An editorial brief does NOT need a serif. A technical brief does NOT need a sans. A children's product does NOT need a rounded display font. The most distinctive choice often contradicts the category expectation.

## Similar-Font Pairing

Never pair two fonts that are similar but not identical — two geometric sans-serifs, two transitional serifs, two humanist sans. They create visual friction without clear hierarchy. The viewer senses something is "off" but can't articulate it. Either use one font at two weights, or pair fonts that contrast on multiple axes: serif + sans, condensed + wide, geometric + humanist.

## Dark Backgrounds

Light text on dark backgrounds creates two optical illusions you need to compensate for:

- **Increased apparent weight.** Light-on-dark reads heavier than dark-on-light at the same \`font-weight\`. Use 350 instead of 400 for body text. Headlines are less affected because size compensates.
- **Tighter apparent spacing.** Light halos around letterforms reduce perceived gaps. Increase \`line-height\` by 0.05-0.1 beyond your light-background value. For display sizes, add 0.01em \`letter-spacing\` to counteract.

## OpenType Features for Data

Most fonts ship with OpenType features that are off by default. Turn them on for data compositions:

\`\`\`css
/* Tabular numbers — digits align vertically in columns */
.stat-value,
.timer,
.data-column {
  font-variant-numeric: tabular-nums;
}

/* Diagonal fractions — renders 1/2 as ½ */
.recipe-amount,
.ratio {
  font-variant-numeric: diagonal-fractions;
}

/* Small caps for abbreviations — less visual shouting */
.abbreviation,
.unit {
  font-variant-caps: all-small-caps;
}

/* Disable ligatures in code — fi, fl, ffi should stay separate */
code,
.code {
  font-variant-ligatures: none;
}
\`\`\`

\`tabular-nums\` is essential any time numbers are stacked vertically — stat callouts, timers, scoreboards, data tables. Without it, digits have proportional widths and columns don't align.
`;

export const TRANSITIONS_MD = `# Scene Transitions

A transition tells the viewer how two scenes relate. A crossfade says "this continues." A push slide says "next point." A blur crossfade says "drift with me." Choose transitions that match what the content is doing emotionally, not just technically.

## Animation Rules for Multi-Scene Compositions

These are non-negotiable for every multi-scene composition:

1. **Every composition uses transitions.** No exceptions. Scenes without transitions feel like jump cuts.
2. **Every scene uses entrance animations.** Elements animate IN via \`gsap.from()\` — opacity, position, scale, etc. No scene should pop fully-formed onto screen.
3. **Exit animations are BANNED** except on the final scene. Do NOT use \`gsap.to()\` to animate elements out before a transition fires. The transition IS the exit. Outgoing scene content must be fully visible when the transition starts — the transition handles the visual handoff.
4. **Final scene exception:** The last scene MAY fade elements out (e.g., fade to black at the end of the composition). This is the only scene where exit animations are allowed.

## Energy → Primary Transition

| Energy                                   | CSS Primary                  | Shader Primary                       | Accent                         | Duration  | Easing                 |
| ---------------------------------------- | ---------------------------- | ------------------------------------ | ------------------------------ | --------- | ---------------------- |
| **Calm** (wellness, brand story, luxury) | Blur crossfade, focus pull   | Cross-warp morph, thermal distortion | Light leak, circle iris        | 0.5-0.8s  | \`sine.inOut\`, \`power1\` |
| **Medium** (corporate, SaaS, explainer)  | Push slide, staggered blocks | Whip pan, cinematic zoom             | Squeeze, vertical push         | 0.3-0.5s  | \`power2\`, \`power3\`     |
| **High** (promos, sports, music, launch) | Zoom through, overexposure   | Ridged burn, glitch, chromatic split | Staggered blocks, gravity drop | 0.15-0.3s | \`power4\`, \`expo\`       |

Pick ONE primary (60-70% of scene changes) + 1-2 accents. Never use a different transition for every scene.

## Mood → Transition Type

Think about what the transition _communicates_, not just what it looks like.

| Mood                     | Transitions                                                                                                                          | Why it works                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Warm / inviting**      | Light leak, blur crossfade, focus pull, film burn · **Shader:** thermal distortion, light leak, cross-warp morph                     | Soft edges, warm color washes. Nothing sharp or mechanical.                                 |
| **Cold / clinical**      | Squeeze, zoom out, blinds, shutter, grid dissolve · **Shader:** gravitational lens                                                   | Content transforms mechanically — compressed, shrunk, sliced, gridded.                      |
| **Editorial / magazine** | Push slide, vertical push, diagonal split, shutter · **Shader:** whip pan                                                            | Like turning a page or slicing a layout. Clean directional movement.                        |
| **Tech / futuristic**    | Grid dissolve, staggered blocks, blinds, chromatic aberration · **Shader:** glitch, chromatic split                                  | Grid dissolve is the core "data" transition. Shader glitch adds posterization + scan lines. |
| **Tense / edgy**         | Glitch, VHS, chromatic aberration, ripple · **Shader:** ridged burn, glitch, domain warp                                             | Instability, distortion, digital breakdown. Ridged burn adds sharp lightning-crack edges.   |
| **Playful / fun**        | Elastic push, 3D flip, circle iris, morph circle, clock wipe · **Shader:** ripple waves, swirl vortex                                | Overshoot, bounce, rotation, expansion. Swirl vortex adds organic spiral distortion.        |
| **Dramatic / cinematic** | Zoom through, zoom out, gravity drop, overexposure, color dip to black · **Shader:** cinematic zoom, gravitational lens, domain warp | Scale, weight, light extremes. Shader transitions add per-pixel depth.                      |
| **Premium / luxury**     | Focus pull, blur crossfade, color dip to black · **Shader:** cross-warp morph, thermal distortion                                    | Restraint. Cross-warp morph flows both scenes into each other organically.                  |
| **Retro / analog**       | Film burn, light leak, VHS, clock wipe · **Shader:** light leak                                                                      | Organic imperfection. Warm color bleeds, scan line displacement.                            |

## Narrative Position

| Position                   | Use                                                                        | Why                                                   |
| -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Opening**                | Your most distinctive transition. Match the mood. 0.4-0.6s                 | Sets the visual language for the entire piece.        |
| **Between related points** | Your primary transition. Consistent. 0.3s                                  | Don't distract — the content is continuing.           |
| **Topic change**           | Something different from your primary. Staggered blocks, shutter, squeeze. | Signals "new section" — the viewer's brain resets.    |
| **Climax / hero reveal**   | Your boldest accent. Fastest or most dramatic.                             | This is the payoff — spend your best transition here. |
| **Wind-down**              | Return to gentle. Blur crossfade, crossfade. 0.5-0.7s                      | Let the viewer exhale after the climax.               |
| **Outro**                  | Slowest, simplest. Crossfade, color dip to black. 0.6-1.0s                 | Closure. Don't introduce new energy at the end.       |

## Blur Intensity by Energy

| Energy     | Blur    | Duration | Hold at peak |
| ---------- | ------- | -------- | ------------ |
| **Calm**   | 20-30px | 0.8-1.2s | 0.3-0.5s     |
| **Medium** | 8-15px  | 0.4-0.6s | 0.1-0.2s     |
| **High**   | 3-6px   | 0.2-0.3s | 0s           |

## Presets

| Preset     | Duration | Easing            |
| ---------- | -------- | ----------------- |
| \`snappy\`   | 0.2s     | \`power4.inOut\`    |
| \`smooth\`   | 0.4s     | \`power2.inOut\`    |
| \`gentle\`   | 0.6s     | \`sine.inOut\`      |
| \`dramatic\` | 0.5s     | \`power3.in\` → out |
| \`instant\`  | 0.15s    | \`expo.inOut\`      |
| \`luxe\`     | 0.7s     | \`power1.inOut\`    |

## Implementation

Read [transitions/catalog.md](transitions/catalog.md) for GSAP code and hard rules for every transition type.

| Category    | CSS                                                            | Shader (WebGL)                                                            |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Push/slide  | Push slide, vertical push, elastic push, squeeze               | Whip pan                                                                  |
| Scale/zoom  | Zoom through, zoom out, gravity drop, 3D flip                  | Cinematic zoom, gravitational lens                                        |
| Reveal/mask | Circle iris, diamond iris, diagonal split, clock wipe, shutter | SDF iris                                                                  |
| Dissolve    | Crossfade, blur crossfade, focus pull, color dip               | Cross-warp morph, domain warp                                             |
| Cover       | Staggered blocks, horizontal blinds, vertical blinds           | —                                                                         |
| Light       | Light leak, overexposure burn, film burn                       | Light leak (shader), thermal distortion                                   |
| Distortion  | Glitch, chromatic aberration, ripple, VHS tape                 | Glitch (shader), chromatic split, ridged burn, ripple waves, swirl vortex |
| Pattern     | Grid dissolve, morph circle                                    | —                                                                         |

## Transitions That Don't Work in CSS

Avoid: star iris, tilt-shift, lens flare, hinge/door. See catalog.md for why.

## CSS vs Shader

CSS transitions animate scene containers with opacity, transforms, clip-path, and filters. Shader transitions composite both scene textures per-pixel on a WebGL canvas — they can warp, dissolve, and morph in ways CSS cannot.

**Both are first-class options.** Shaders are provided by the \`@hyperframes/shader-transitions\` package — import from the package instead of writing raw GLSL. CSS transitions are simpler to set up. Choose based on the effect you want, not based on which is easier.

When a composition uses shader transitions, ALL transitions in that composition should be shader-based (the WebGL canvas replaces DOM-based scene switching). Don't mix CSS and shader transitions in the same composition.

## Shader-Compatible CSS Rules

Shader transitions capture DOM scenes to WebGL textures via html2canvas. The canvas 2D rendering pipeline doesn't match CSS exactly. Follow these rules to avoid visible artifacts at transition boundaries:

1. **No \`transparent\` keyword in gradients.** Canvas interpolates \`transparent\` as \`rgba(0,0,0,0)\` (black at zero alpha), creating dark fringes. Always use the target color at zero alpha: \`rgba(200,117,51,0)\` not \`transparent\`.
2. **No gradient backgrounds on elements thinner than 4px.** Canvas can't match CSS gradient rendering on 1-2px elements. Use solid \`background-color\` on thin accent lines.
3. **No CSS variables (\`var()\`) on elements visible during capture.** html2canvas doesn't reliably resolve custom properties. Use literal color values in inline styles.
4. **Mark uncapturable decorative elements with \`data-no-capture\`.** The capture function skips these. They're present on the live DOM but absent from the shader texture. Use for elements that can't follow the rules above.
5. **No gradient opacity below 0.15.** Gradient elements below 10% opacity render differently in canvas vs CSS. Increase to 0.15+ or use a solid color at equivalent brightness.
6. **Every \`.scene\` div must have explicit \`background-color\`, AND pass the same color as \`bgColor\` in the \`init()\` config.** The package captures scene elements via html2canvas. Both the CSS \`background-color\` on \`.scene\` and the \`bgColor\` config must match. Without either, the texture renders as black.

These rules only apply to shader transition compositions. CSS-only compositions have no restrictions.

## Visual Pattern Warning

Avoid transitions that create visible repeating geometric patterns — grids of tiles, hexagonal cells, uniform dot arrays, evenly-spaced blob circles. These look cheap and artificial regardless of the math behind them. Organic noise (FBM, domain warping) is good because it's irregular. Geometric repetition is bad because the eye instantly sees the grid.
`;

