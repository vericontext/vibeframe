/**
 * Motion graphics generation helpers for ClaudeProvider.
 *
 * Extracted methods: generateMotion, refineMotion, analyzeContent
 */

import type { ClaudeApiParams } from "./claude-api.js";
import type { MotionOptions, MotionResult, StoryboardSegment } from "./ClaudeProvider.js";
import { callClaude, extractJsonObject, extractJsonArray } from "./claude-api.js";
import { buildStoryboardSystemPrompt, buildStoryboardUserMessage } from "../storyboard-prompt.js";

// ---------------------------------------------------------------------------
// generateMotion
// ---------------------------------------------------------------------------

export async function generateMotion(
  api: ClaudeApiParams,
  description: string,
  options: MotionOptions = {}
): Promise<MotionResult> {
  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;
  const durationInFrames = Math.round(duration * fps);

  const stylePreset = options.style || "modern and clean";

  let systemPrompt = buildMotionSystemPrompt(width, height, fps, duration, durationInFrames, stylePreset);

  // Append visual context from Gemini analysis (image or video)
  if (options.videoContext) {
    const sourceLabel = options.sourceType === "image" ? "IMAGE" : "VIDEO";
    systemPrompt += `

═══ ${sourceLabel} ANALYSIS (Gemini visual understanding — MUST influence every design decision) ═══
${options.videoContext}

MANDATORY ADAPTATION RULES:
1. COLOR PALETTE: Extract hex colors from the analysis. Use them directly for text fills, accent lines, glow colors, background tints. Create contrast against the source — if source is warm/bright, use white text with warm-toned accents; if dark/moody, use light text with cool accents.
2. SAFE ZONES: Place ALL overlay elements strictly within described safe zones. If subject is centered, use lower-third or top-corner placement. If subject is on one side, place overlays on the opposite side.
3. MOOD → ANIMATION STYLE mapping:
   - Calm/serene/nature → smooth config ({ damping: 200 }), slow reveals (1.5-2s entrance), gentle floating particles, typewriter text
   - Dynamic/action/urban → snappy config ({ damping: 20, stiffness: 200 }), quick pops (0.3-0.5s), bounce entrances, kinetic typography
   - Cinematic/dramatic → heavy config ({ damping: 15, stiffness: 80, mass: 2 }), wipe reveals, SVG path drawing, gradient sweeps
   - Playful/fun/colorful → bouncy config ({ damping: 8 }), scale bounces, rotating entrances, pulsing glows
4. TYPOGRAPHY: Choose weight and spacing that matches source aesthetic. Elegant → light weight (300) + wide letterSpacing (3px). Bold → heavy weight (700) + tight spacing.
5. CONTENT RELEVANCE: If the analysis identifies specific subjects (e.g., "golden retriever on beach"), incorporate that context into text content, visual motifs, and color choices.`;
  }

  try {
    const userContent = buildMotionUserPrompt(description, stylePreset);

    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 16000,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) {
      return { success: false, error: "Could not parse response" };
    }

    const result = JSON.parse(jsonStr) as {
      name: string;
      code: string;
      description: string;
    };

    return {
      success: true,
      component: {
        name: result.name,
        code: result.code,
        durationInFrames,
        fps,
        width,
        height,
        description: result.description,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// refineMotion
// ---------------------------------------------------------------------------

export async function refineMotion(
  api: ClaudeApiParams,
  existingCode: string,
  instructions: string,
  options: MotionOptions = {}
): Promise<MotionResult> {
  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;
  const durationInFrames = Math.round(duration * fps);

  const systemPrompt = `You are a world-class broadcast motion graphics designer. Modify the provided Remotion component based on instructions.

CANVAS: ${width}×${height}px | ${fps}fps | ${durationInFrames} frames (${duration}s)

═══ ABSOLUTE RULES (must not break) ═══
1. ROOT must be <AbsoluteFill> with NO backgroundColor.
2. NO CSS animations/transitions — ALL motion MUST use useCurrentFrame() + interpolate()/spring().
3. ONE SINGLE exported component — no sub-components.
4. spring() ALWAYS needs fps: spring({ frame, fps, config: { damping: 200 } })
5. interpolate() outputRange MUST be an array:
   ✅ CORRECT: interpolate(exitEase, [0, 1], [barH, 0])
   ❌ WRONG:   interpolate(exitEase, [0, 1], barH, 0)
6. Use spring({ delay }) for staggering — NO <Sequence> components.
7. whiteSpace: "nowrap" on all text elements.

═══ MODIFICATION RULES ═══
- Make ONLY the changes requested. Preserve all working animation logic.
- If changing text: update the string values without changing animation code.
- If changing layout: adjust positions while keeping animation timing intact.
- If changing style: update colors/fonts while preserving spring/interpolate logic.
- Keep the component name unchanged unless explicitly asked to rename it.

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON (no markdown):
{
  "name": "SameComponentName",
  "code": "complete modified tsx code",
  "description": "One sentence describing the changes made"
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Here is the existing Remotion component code:\n\`\`\`tsx\n${existingCode}\n\`\`\`\n\nModification instructions: ${instructions}\n\nReturn the complete modified component as JSON.`,
      }],
      maxTokens: 16000,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) return { success: false, error: "Could not parse response" };

    const result = JSON.parse(jsonStr) as {
      name: string;
      code: string;
      description: string;
    };

    return {
      success: true,
      component: {
        name: result.name,
        code: result.code,
        durationInFrames,
        fps,
        width,
        height,
        description: result.description,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// analyzeContent (storyboard generation)
// ---------------------------------------------------------------------------

export async function analyzeContent(
  api: ClaudeApiParams,
  content: string,
  targetDuration?: number,
  options?: { creativity?: "low" | "high" }
): Promise<StoryboardSegment[]> {
  const creativity = options?.creativity || "low";
  const systemPrompt = buildStoryboardSystemPrompt(targetDuration, creativity);

  try {
    // Use higher temperature for creative mode
    const temperature = creativity === "high" ? 1.0 : 0.7;

    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: buildStoryboardUserMessage(content),
      }],
      maxTokens: 4096,
      temperature,
    });

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) {
      console.error("[Claude API] No JSON array found in response. Response text:");
      console.error(text.slice(0, 500));
      return [];
    }

    return JSON.parse(jsonStr) as StoryboardSegment[];
  } catch (err) {
    console.error(`[Claude API] Storyboard error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// System prompt builders (private helpers)
// ---------------------------------------------------------------------------

function buildMotionSystemPrompt(
  width: number,
  height: number,
  fps: number,
  duration: number,
  durationInFrames: number,
  stylePreset: string
): string {
  return `You are a world-class broadcast motion graphics designer (like Apple Keynote, Netflix intros, ESPN graphics). Create STUNNING, jaw-dropping overlays that make viewers go "wow".

CANVAS: ${width}×${height}px | ${fps}fps | ${durationInFrames} frames (${duration}s) | Style: ${stylePreset}

═══ ABSOLUTE RULES (violations crash the render) ═══
1. ROOT must be <AbsoluteFill> with NO backgroundColor — component is composited onto image/video.
2. CSS animations/transitions/keyframes are FORBIDDEN. Tailwind animate classes are FORBIDDEN.
   ALL motion MUST use useCurrentFrame() + interpolate()/spring().
3. Write ONE SINGLE exported component (no sub-components, no separate functions).
   Put ALL logic inside one component to avoid frame timing bugs.
4. spring() ALWAYS needs fps: spring({ frame, fps, config: { damping: 200 } })
5. interpolate() ALWAYS clamp both sides AND outputRange MUST be an array:
   ✅ CORRECT: interpolate(frame, [0, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
   ✅ CORRECT: interpolate(exitEase, [0, 1], [barH, 0])
   ❌ WRONG:   interpolate(exitEase, [0, 1], barH, 0)   ← barH is a scalar, NOT an array — this crashes!
   The third argument MUST always be an array. Never pass a scalar variable as outputRange.

═══ AVAILABLE IMPORTS ═══
import { useCurrentFrame, useVideoConfig, interpolate, spring, Easing, AbsoluteFill } from 'remotion';
(Do NOT import Sequence — use spring delay instead for staggering)

═══ TIMING PATTERN (use this for ALL staggered animations) ═══
Use spring({ delay }) to stagger elements — this is simpler and avoids Sequence frame bugs:

const frame = useCurrentFrame();
const { fps, durationInFrames } = useVideoConfig();

// Element 1: appears immediately
const el1 = spring({ frame, fps, config: { damping: 200 } });
// Element 2: appears 0.4s later
const el2 = spring({ frame, fps, delay: Math.round(0.4 * fps), config: { damping: 200 } });
// Element 3: appears 0.8s later
const el3 = spring({ frame, fps, delay: Math.round(0.8 * fps), config: { damping: 200 } });

// Exit animation (last 1 second)
const exitStart = durationInFrames - Math.round(1.0 * fps);
const exitProgress = interpolate(frame, [exitStart, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

═══ SPRING CONFIGS ═══
{ damping: 200 }                         // Smooth, no bounce
{ damping: 20, stiffness: 200 }          // Snappy pop
{ damping: 8 }                           // Playful bounce
{ damping: 15, stiffness: 80, mass: 2 }  // Heavy, dramatic

═══ EASING ═══
Easing.out(Easing.exp)              // Fast start, elegant deceleration
Easing.inOut(Easing.quad)           // Smooth S-curve
Easing.bezier(0.22, 1, 0.36, 1)    // Cinematic

═══ ANIMATION TECHNIQUES (use MANY of these — not just fade-in) ═══

1. TYPEWRITER (character-by-character reveal):
   const text = "Hello World";
   const typeDelay = Math.round(0.5 * fps); // starts 0.5s in
   const typeFrame = Math.max(0, frame - typeDelay);
   const charsPerFrame = 3;
   const typedLen = Math.min(Math.floor(typeFrame / charsPerFrame), text.length);
   const displayed = text.slice(0, typedLen);
   const cursorBlink = interpolate(frame % 16, [0, 8, 16], [1, 0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
   <span>{displayed}</span><span style={{ opacity: typedLen < text.length ? cursorBlink : 0 }}>▌</span>

2. WORD-BY-WORD KINETIC TEXT (each word pops in):
   const words = ["Create", "Something", "Amazing"];
   words.map((word, i) => {
     const wordSpring = spring({ frame, fps, delay: Math.round(0.3 * fps) + i * 6, config: { damping: 12 } });
     const y = interpolate(wordSpring, [0, 1], [40, 0]);
     const scale = interpolate(wordSpring, [0, 1], [0.5, 1]);
     const opacity = interpolate(wordSpring, [0, 1], [0, 1]);
     return <span key={i} style={{ display: "inline-block", transform: \`translateY(\${y}px) scale(\${scale})\`, opacity, marginRight: 16 }}>{word}</span>;
   });

3. SLIDE-IN BAR (colored strip from edge):
   const barSpring = spring({ frame, fps, config: { damping: 20, stiffness: 200 } });
   const barX = interpolate(barSpring, [0, 1], [-600, 0]);
   <div style={{ position: "absolute", left: barX, bottom: 120, width: 500, height: 80, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: "0 12px 12px 0" }} />

4. ACCENT LINE DRAW-IN:
   const lineDelay = Math.round(0.6 * fps);
   const lineW = interpolate(frame, [lineDelay, lineDelay + 40], [0, 350], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp) });
   <div style={{ width: lineW, height: 3, backgroundColor: "#FFD700", boxShadow: "0 0 12px rgba(255,215,0,0.6)" }} />

5. SCALE BOUNCE POP:
   const popSpring = spring({ frame, fps, delay: 10, config: { damping: 8 } });
   const popScale = interpolate(popSpring, [0, 1], [0, 1]);
   <div style={{ transform: \`scale(\${popScale})\`, transformOrigin: "center" }}>🔥</div>

6. ROTATING ENTRANCE:
   const rotSpring = spring({ frame, fps, config: { damping: 15 } });
   const rot = interpolate(rotSpring, [0, 1], [-180, 0]);
   <div style={{ transform: \`rotate(\${rot}deg)\`, opacity: rotSpring }}>★</div>

7. SVG PATH STROKE ANIMATION (decorative curves, borders):
   const pathTotal = 600;
   const drawDelay = Math.round(0.3 * fps);
   const strokeOffset = interpolate(frame, [drawDelay, drawDelay + 60], [pathTotal, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
   <svg width={${width}} height={${height}} style={{ position: "absolute", top: 0, left: 0 }}>
     <path d="M 80 900 Q 400 800 700 850 T 1200 780" stroke="#FFD700" strokeWidth={2} fill="none" strokeDasharray={pathTotal} strokeDashoffset={strokeOffset} opacity={0.6} />
   </svg>

8. GRADIENT WIPE REVEAL:
   const wipeDelay = Math.round(0.2 * fps);
   const wipe = interpolate(frame, [wipeDelay, wipeDelay + 30], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
   <div style={{ clipPath: \`inset(0 \${wipe}% 0 0)\` }}>Content</div>

9. FLOATING BOKEH PARTICLES (atmospheric, full-screen):
   {Array.from({ length: 15 }).map((_, i) => {
     const seed = i * 137.5;
     const px = (Math.sin(seed) * 0.5 + 0.5) * ${width};
     const startY = ${height} * 0.3 + (Math.cos(seed * 0.7) * ${height} * 0.4);
     const drift = interpolate(frame, [0, durationInFrames], [0, -120 - i * 15]);
     const fadeIn = interpolate(frame, [i * 3, i * 3 + 30], [0, 0.15 + (i % 3) * 0.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
     const fadeOut = interpolate(frame, [exitStart, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
     const sz = 6 + (i % 5) * 8;
     return <div key={i} style={{ position: "absolute", left: px, top: startY + drift, width: sz, height: sz, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%)", opacity: fadeIn * fadeOut, filter: \`blur(\${1 + i % 3}px)\` }} />;
   })}

10. PULSING GLOW:
    const pulse = Math.sin(frame * 0.15) * 0.3 + 0.7;
    <div style={{ boxShadow: \`0 0 \${pulse * 40}px \${pulse * 20}px rgba(255,215,0,\${pulse * 0.3})\` }}>Element</div>

11. CINEMATIC LETTERBOX BARS (top/bottom black bars sliding in):
    const barH = interpolate(frame, [0, 30], [0, 60], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: barH, backgroundColor: "rgba(0,0,0,0.85)" }} />
    <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: barH, backgroundColor: "rgba(0,0,0,0.85)" }} />

12. COUNTER / NUMBER TICKER:
    const count = Math.round(interpolate(frame, [20, 80], [0, 1250], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    <span style={{ fontVariantNumeric: "tabular-nums" }}>{count.toLocaleString()}</span>

13. HIGHLIGHT SWEEP (marker pen effect on text):
    const hlDelay = Math.round(1.0 * fps);
    const hlW = interpolate(frame, [hlDelay, hlDelay + 25], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    <span style={{ backgroundImage: "linear-gradient(transparent 55%, rgba(255,215,0,0.5) 55%)", backgroundSize: \`\${hlW}% 100%\`, backgroundRepeat: "no-repeat" }}>highlighted</span>

═══ LAYOUT & SIZING RULES (CRITICAL — prevents text overflow bugs) ═══
1. TEXT WIDTH ESTIMATION:
   fontSize 60px, letterSpacing 0 → ~36px/char
   fontSize 72px, letterSpacing 0 → ~43px/char
   fontSize 78px, letterSpacing 0 → ~47px/char
   fontSize 78px, letterSpacing 8 → ~55px/char  ← letterSpacing ADDS per-character!
   Example: "GOLDEN HOUR" (11 chars) at 78px, letterSpacing 8 → 11 × 55 = 605px

2. LETTERSPACEING RULE:
   - letterSpacing adds to EVERY character. For 11-char title: letterSpacing 8 adds 88px to total width.
   - With letterSpacing, use 0-3px for titles inside containers. Never use 8px in a 560px container.
   - Or: make container wide enough: 600px text + 120px padding = 720px minimum container width.

3. CONTAINER SIZING RULE:
   - Container width = (estimated text width) + (left padding) + (right padding) + 40px buffer
   - Safe minimums: title-only card → 700px wide; title+subtitle → 800px wide
   - Use width: "auto" or minWidth if you are unsure
   - NEVER set overflow: "hidden" on containers with animated text

4. ALWAYS use whiteSpace: "nowrap" on every text element.

5. SAFE SCREEN POSITIONING (1920×1080):
   - Bottom lower-third: bottom: 80-150px, left: 60-120px
   - Top overlay: top: 80-120px, left: 60-120px
   - Centered: use position absolute, top/left 50%, transform translateX(-50%)

═══ DESIGN QUALITY REQUIREMENTS ═══
YOUR MOTION GRAPHIC MUST:
- Use AT LEAST 5 animated elements with independent timing
- Stagger entrances: first element at 0s, last element no later than 60% of total duration
- Include BOTH entrance AND exit animations (exit = last ~20% of duration)
- Fill significant screen real estate — NO tiny text in a corner. Title text 60-100px. Subtitle 24-36px.
- Use textShadow for ALL text to ensure readability over any background
- Have visual depth: layer elements at different z-levels (particles behind, text front)
- Mix at least 3 different animation types from the list above
- Exit: reverse the entrance — elements slide/fade out in reverse stagger order
- ALWAYS add whiteSpace: "nowrap" to all title/label text elements

═══ STYLE-SPECIFIC LAYOUT (FOLLOW THIS EXACTLY for your style: "${stylePreset}") ═══

${stylePreset === "minimal" ? `MINIMAL STYLE — Apple Keynote / Typographic:
LAYOUT: CENTER of screen. Pure typography, NO glass panels, NO dark backgrounds.
  Phase 1 (0-0.5s): Thin horizontal line draws in from center outward (SVG or div, 1-2px thick, full-width)
  Phase 2 (0.3-1.0s): Main title fades + scales in (large, bold, centered, fontSize 80-100px, letterSpacing 6px)
  Phase 3 (0.8-1.5s): Subtitle appears word-by-word below, lighter weight (fontSize 28-36px, opacity 0.7)
  Phase 4 (1.2-2.0s): Second thin line draws in below subtitle
  Phase 5 (1.8s+): Small label or tag fades in at very bottom (fontSize 16-18px, wide letterSpacing, opacity 0.5)
  Hold: Subtle breathing scale pulse on title (Math.sin oscillation, ±1-2%)
  Exit: Everything fades out cleanly, lines retract to center
FORBIDDEN: glass panels, backdropFilter blur, dark bars, bokeh particles, lower-third placement` : ""}

${stylePreset === "corporate" ? `CORPORATE STYLE — Bloomberg / CNN / CNBC Data Broadcast:
LAYOUT: BOTTOM LEFT lower bar + TOP RIGHT info badge. Data-driven, clean, professional.
  Phase 1 (0-0.2s): Solid color brand stripe appears on left edge (4-6px wide, full height from bottom, slides up)
  Phase 2 (0.1-0.4s): White/light background bar slides in from left (bottom 60-80px tall, covers 50-60% of width)
  Phase 3 (0.3-0.8s): Organization/show name in bold sans-serif (fontSize 20-24px, dark text on light bar, letterSpacing 3px)
  Phase 4 (0.5-1.0s): Main title in LARGE text above the bar (fontSize 60-72px, white, bold)
  Phase 5 (0.8-1.5s): Stats/numbers animate via counter: format "1,234,567" counting up (tabular-nums)
  Phase 6 (1.0-1.5s): Top-right badge slides down: small box with category label, thin border
  Phase 7 (1.5s+): Progress bar or chart element draws in (horizontal bar filling from left)
  Hold: Subtle shimmer sweep on the brand stripe
  Exit: Counter freezes, badge slides up, bar slides right, stripe retracts
FORBIDDEN: bokeh particles, rotating elements, playful bounces` : ""}

${stylePreset === "playful" ? `PLAYFUL STYLE — YouTube / TikTok / Social Media:
LAYOUT: ASYMMETRIC, off-center, energetic. Use bright colors, multiple accent colors.
  Phase 1 (0-0.2s): Main word CRASHES in from above with heavy bounce (damping: 4, stiffness: 400) + rotation -5° → 0°
  Phase 2 (0.1-0.4s): Colored background blob scales in behind title (irregular shape or rounded rect, no blur)
  Phase 3 (0.3-0.8s): Supporting words pop in from random directions with different colors (each a spring with damping 6)
  Phase 4 (0.5-1.0s): Decorative stars/sparkles ✦ or circles pop at corners with scale bounce (damping 5)
  Phase 5 (0.8-1.3s): Arrow or underline element wiggles in (rotate oscillation: Math.sin(frame * 0.3) * 8)
  Phase 6 (1.0s+): Pulsing glow on key elements, floating icons drift upward slowly
  Hold: Multiple elements wiggle/pulse, continuous energy
  Exit: Everything scales down and fades simultaneously with bounce
REQUIRED: At least 3 different bright colors (not monochrome). Large emoji or symbol as accent element.` : ""}

${stylePreset === "cinematic" ? `CINEMATIC STYLE — Netflix / HBO / Film Title Card:
LAYOUT: LOWER-THIRD glass panel. Dark, dramatic, high production value.
  Phase 1 (0-0.3s): Cinematic letterbox bars slide in from top/bottom edges
  Phase 2 (0.2-0.6s): Dark glass-blur panel slides in from left with spring overshoot (damping: 18)
  Phase 3 (0.4-1.2s): Title typewriters in character-by-character with blinking cursor (▌ or |)
  Phase 4 (0.6-1.0s): Gold/colored accent line draws in from left to right below title
  Phase 5 (0.8-1.3s): Subtitle words pop in one by one with stagger, italic, lighter weight
  Phase 6 (1.0-1.5s): Decorative SVG curve draws in at bottom, bokeh particles float upward
  Phase 7 (1.2-2.0s): Small secondary badge or emblem animates in upper area
  Hold: Particles drift, subtle glow pulse on accent elements
  Exit: Everything in reverse — particles fade, line retracts, text fades, bar slides out, letterbox retracts
REQUIRED: backdropFilter blur, gold/warm accent color, SVG path decoration` : ""}

${stylePreset === "fullscreen" ? `FULLSCREEN STYLE — Movie Opening / Epic Title Reveal:
LAYOUT: ENTIRE screen used. Centered massive title, cinematic atmosphere, no lower-third.
  Phase 1 (0-1.0s): Vignette overlay fades in (radial gradient darkening edges)
  Phase 2 (0.5-1.5s): Large central title WIPES IN via clipPath (inset from 100% to 0% left-to-right)
     - fontSize 100-140px, centered, bold, wide letterSpacing 10-20px
  Phase 3 (1.0-2.0s): Subtitle appears BELOW title with gradient reveal from center outward
     - fontSize 24-32px, letterSpacing 8px, ALL CAPS, opacity 0.7
  Phase 4 (1.5-2.5s): Decorative frame/border draws in around content (4 SVG lines from center)
  Phase 5 (2.0-3.0s): Full-screen particle field (30+ small particles) fades in across entire canvas
  Phase 6 (2.5s+): Slow scale zoom on entire composition (scale 1.0 → 1.04 over full duration)
  Hold: Particles drift, title has subtle shimmer sweep every 2s
  Exit: Everything fades out simultaneously, vignette intensifies then fades
REQUIRED: Use full 1920×1080 canvas. No panel/box constraints. Centered layout only.` : ""}

${stylePreset === "hud" ? `HUD STYLE — Sci-Fi / Cyberpunk / Game Interface:
LAYOUT: CORNER DECORATIONS + CENTER DATA PANEL. Monospace font, tech aesthetic.
  Phase 1 (0-0.3s): Corner bracket decorations appear at all 4 corners (SVG L-shapes, each 60-80px, draw in with strokeDashoffset)
  Phase 2 (0.2-0.6s): Horizontal scan line sweeps top-to-bottom (thin line, opacity 0.3, position: absolute)
  Phase 3 (0.4-0.8s): Center data panel materializes with glitch effect (rapid opacity flicker for 0.2s then solid)
     - Use monospace font: "Courier New", Courier, monospace
  Phase 4 (0.6-1.0s): Data fields type out one by one (typewriter style):
     - "LOCATION: [value]", "STATUS: ACTIVE", "ID: [number]", "SIGNAL: ████░░ 67%"
  Phase 5 (0.8-1.2s): Progress bars fill from left (horizontal divs filling width)
  Phase 6 (1.0s+): Pulsing ring/circle in corner (Math.sin pulse on opacity and radius)
  Phase 7 (1.5s+): Occasional random glitch (fast interpolate flicker, 2-3 frames)
  Hold: Scan line sweeps continuously, data fields blink, corner brackets pulse
  Exit: Glitch effect, then everything flickers out
REQUIRED: monospace font, corner brackets (SVG), at least 3 data-field lines, scan line animation.` : ""}

${stylePreset === "split" ? `SPLIT STYLE — Sports / Versus / Comparison:
LAYOUT: DIAGONAL SPLIT divides screen into two zones. Contrasting colors left vs right.
  Phase 1 (0-0.3s): Diagonal slash/line draws across screen from top-left to bottom-right (SVG line, strokeDashoffset)
  Phase 2 (0.1-0.5s): LEFT panel slides in from left (covers left portion, color A, semi-transparent)
  Phase 3 (0.2-0.6s): RIGHT panel slides in from right (covers right portion, color B, semi-transparent)
  Phase 4 (0.5-1.0s): LEFT label appears (top-left zone) — large, bold, color contrasting with left panel
  Phase 5 (0.6-1.1s): RIGHT label appears (top-right zone) — large, bold, contrasting with right panel
  Phase 6 (0.8-1.3s): CENTER divider icon or "VS" text pops in at intersection with scale bounce
  Phase 7 (1.0-1.5s): Stats appear in each zone (left-aligned in left, right-aligned in right)
  Hold: Both panels pulse with opposite rhythms (left bright when right dim, vice versa)
  Exit: Panels slide back out to their respective sides, slash retracts
REQUIRED: Two distinct color zones, diagonal dividing element, "VS" or comparable label at center.` : ""}

${!["minimal","corporate","playful","cinematic","fullscreen","hud","split"].includes(stylePreset) ? `GENERAL STYLE (${stylePreset}):
Choose a layout appropriate for the description. Use a lower-third OR centered title OR corner overlay depending on content.
Include 5+ animated elements with staggered timing, entrance and exit animations.` : ""}

═══ OUTPUT FORMAT ═══
Respond with ONLY valid JSON (no markdown, no commentary):
{
  "name": "PascalCaseName",
  "code": "import { useCurrentFrame, useVideoConfig, interpolate, spring, Easing, AbsoluteFill } from 'remotion';\\n\\nexport const PascalCaseName: React.FC = () => {\\n  const frame = useCurrentFrame();\\n  const { fps, durationInFrames } = useVideoConfig();\\n  // ... complex multi-element animation ...\\n  return (<AbsoluteFill>{/* 5+ animated elements */}</AbsoluteFill>);\\n};",
  "description": "One sentence describing the animation"
}`;
}

function buildMotionUserPrompt(description: string, stylePreset: string): string {
  const styleRequirements: Record<string, string> = {
    minimal: `STRUCTURE REQUIREMENTS (MINIMAL):
- Center everything on screen — no panel sliding in from the side
- Pure typography: thin lines + large title + lighter subtitle
- NO glass panels, NO bokeh particles, NO dark bars
- Breathing/pulse animation on main title during hold phase
- Clean, elegant fade exit`,
    corporate: `STRUCTURE REQUIREMENTS (CORPORATE):
- Brand stripe + info bar at bottom, large title above it
- Animated number counter (count up to a meaningful stat)
- Top-right info badge slides down from off-screen
- Professional color palette (brand color + white/black)
- Progress bar or data visualization element`,
    playful: `STRUCTURE REQUIREMENTS (PLAYFUL):
- CRASH the main word in from above with heavy bounce spring (damping: 4)
- Use at least 3 different bright colors
- Include emoji or symbol as a major visual element
- Wobble/wiggle animations (Math.sin oscillation) on at least 2 elements
- Asymmetric layout — NOT centered or lower-third`,
    cinematic: `STRUCTURE REQUIREMENTS (CINEMATIC):
- Letterbox bars + glass lower-third panel from left
- Typewriter title with blinking cursor
- Gold accent line draw-in + bokeh particles floating up
- Decorative SVG path curve at bottom
- Heavy, dramatic spring config (damping: 15, stiffness: 80)`,
    fullscreen: `STRUCTURE REQUIREMENTS (FULLSCREEN):
- Use the ENTIRE 1920×1080 canvas — center everything
- Massive title (fontSize 100-140px) revealed by clipPath wipe
- Full-screen particle field (30+ particles across entire canvas)
- Decorative border/frame draws in around content (SVG)
- Vignette overlay (radial gradient on edges)
- Slow zoom on entire composition during hold`,
    hud: `STRUCTURE REQUIREMENTS (HUD):
- Corner bracket decorations at all 4 corners (SVG strokeDashoffset animation)
- Scan line that sweeps top-to-bottom continuously
- Monospace font throughout ("Courier New")
- Multiple typewriter data fields: "LOCATION:", "STATUS:", "SIGNAL: ████░░"
- Progress bars filling from left
- Glitch flicker effect on entry`,
    split: `STRUCTURE REQUIREMENTS (SPLIT):
- Diagonal slash line across the screen (SVG)
- Two color panels sliding in from opposite sides
- Large labels in each zone, contrasting colors
- "VS" or comparison label at center with bounce pop
- Opposite-rhythm pulsing during hold phase`,
  };

  const req = styleRequirements[stylePreset]
    || `REQUIREMENTS:
- At least 5+ independently animated elements
- Use spring({ delay }) for staggered timing — NO <Sequence> components
- Make text LARGE (title 60-100px, subtitle 24-36px) — this plays on a 1080p screen
- Exit animations must reverse the entrance`;

  return `Create a STUNNING broadcast-quality Remotion motion graphic: "${description}"

STYLE: ${stylePreset.toUpperCase()} — follow the STYLE-SPECIFIC LAYOUT instructions exactly.

${req}

UNIVERSAL RULES:
- At least 5 independently animated elements
- spring({ delay }) for ALL staggering — NO <Sequence>
- Text LARGE: title 60-100px min
- Both entrance AND exit animations
- whiteSpace: "nowrap" on all text`;
}
