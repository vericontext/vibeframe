/**
 * Motion graphics generation helpers for GeminiProvider.
 *
 * Extracted methods: generateMotion, refineMotion
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters needed to call the Gemini generateContent API. */
export interface GeminiApiParams {
  apiKey: string;
  baseUrl: string;
}

/** Options accepted by both generateMotion and refineMotion. */
export interface GeminiMotionOptions {
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  style?:
    | "minimal"
    | "corporate"
    | "playful"
    | "cinematic"
    | "fullscreen"
    | "hud"
    | "split"
    | string;
  videoContext?: string;
  sourceType?: "image" | "video";
  model?: string;
}

/** Result returned by generateMotion / refineMotion. */
export interface GeminiMotionResult {
  success: boolean;
  component?: {
    name: string;
    code: string;
    durationInFrames: number;
    fps: number;
    width: number;
    height: number;
    description: string;
  };
  error?: string;
}

/** Supported model aliases for motion graphic generation */
export const GEMINI_MOTION_MODELS = {
  pro: "gemini-2.5-pro",
  "3.1-pro": "gemini-3.1-pro-preview",
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildMotionSystemPrompt(
  width: number,
  height: number,
  fps: number,
  duration: number,
  durationInFrames: number,
  stylePreset: string,
): string {
  return `You are a world-class broadcast motion graphics designer (like Apple Keynote, Netflix intros, ESPN graphics). Create STUNNING, jaw-dropping overlays that make viewers go "wow".

CANVAS: ${width}\u00d7${height}px | ${fps}fps | ${durationInFrames} frames (${duration}s) | Style: ${stylePreset}

\u2550\u2550\u2550 LAYOUT & SIZING RULES (CRITICAL \u2014 prevents text overflow bugs) \u2550\u2550\u2550
1. TEXT WIDTH ESTIMATION:
   fontSize 60px, letterSpacing 0 \u2192 ~36px/char
   fontSize 72px, letterSpacing 0 \u2192 ~43px/char
   fontSize 78px, letterSpacing 0 \u2192 ~47px/char
   fontSize 78px, letterSpacing 8 \u2192 ~55px/char  \u2190 letterSpacing ADDS per-character!
   Example: "GOLDEN HOUR" (11 chars) at 78px, letterSpacing 8 \u2192 11 \u00d7 55 = 605px

2. LETTERSPACEING RULE:
   - letterSpacing adds to EVERY character. For 11-char title: letterSpacing 8 adds 88px to total width.
   - With letterSpacing, use 0-3px for titles inside containers. Never use 8px in a 560px container.
   - Or: make container wide enough: 600px text + 120px padding = 720px minimum container width.

3. CONTAINER SIZING RULE:
   - Container width = (estimated text width) + (left padding) + (right padding) + 40px buffer
   - Safe minimums: title-only card \u2192 700px wide; title+subtitle \u2192 800px wide
   - NEVER set overflow: "hidden" on containers with animated text

4. ALWAYS use whiteSpace: "nowrap" on every text element.

5. SAFE SCREEN POSITIONING (1920\u00d71080):
   - Bottom lower-third: bottom: 80-150px, left: 60-120px
   - Top overlay: top: 80-120px, left: 60-120px
   - Centered: position absolute, top/left 50%, transform translateX(-50%)

\u2550\u2550\u2550 ABSOLUTE RULES (violations crash the render) \u2550\u2550\u2550
1. ROOT must be <AbsoluteFill> with NO backgroundColor \u2014 component is composited onto image/video.
2. CSS animations/transitions/keyframes are FORBIDDEN. ALL motion MUST use useCurrentFrame() + interpolate()/spring().
3. Write ONE SINGLE exported component \u2014 put ALL logic inside one component to avoid frame timing bugs.
4. spring() ALWAYS needs fps: spring({ frame, fps, config: { damping: 200 } })
5. interpolate() outputRange MUST be an array \u2014 NEVER a scalar:
   \u2705 CORRECT: interpolate(exitEase, [0, 1], [barH, 0])
   \u274c WRONG:   interpolate(exitEase, [0, 1], barH, 0)  \u2190 crashes at render time!
6. Use spring({ delay }) for staggering \u2014 do NOT use <Sequence> components.

\u2550\u2550\u2550 AVAILABLE IMPORTS \u2550\u2550\u2550
import { useCurrentFrame, useVideoConfig, interpolate, spring, Easing, AbsoluteFill } from 'remotion';

\u2550\u2550\u2550 TIMING PATTERN \u2550\u2550\u2550
const frame = useCurrentFrame();
const { fps, durationInFrames } = useVideoConfig();
const el1 = spring({ frame, fps, config: { damping: 200 } });
const el2 = spring({ frame, fps, delay: Math.round(0.4 * fps), config: { damping: 200 } });
const exitStart = durationInFrames - Math.round(1.0 * fps);
const exitProgress = interpolate(frame, [exitStart, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

\u2550\u2550\u2550 ANIMATION TECHNIQUES \u2014 use many of these \u2550\u2550\u2550
- Typewriter: const typeFrame = Math.max(0, frame - delay); text.slice(0, Math.floor(typeFrame / 3))
- Kinetic word-by-word: words.map((w,i) => spring({ frame, fps, delay: i*8, config:{damping:12} }))
- Accent line: interpolate(frame, [delay, delay+40], [0, 350], { easing: Easing.out(Easing.exp) })
- Scale bounce: interpolate(spring({frame,fps,config:{damping:8}}), [0,1], [0,1])
- Slide-in: interpolate(spring({frame,fps,config:{damping:20,stiffness:200}}), [0,1], [-600,80])
- SVG path draw: strokeDashoffset animating from pathLength\u21920
- Bokeh particles: Array.from({length:15}).map((_,i)=>...) with staggered fade and drift
- Gradient wipe: clipPath: \`inset(0 \${wipeProgress}% 0 0)\`
- Pulsing glow: Math.sin(frame * 0.15) * 0.3 + 0.7
- Cinematic bars: interpolate(frame,[0,30],[0,60]) for top/bottom letterbox

\u2550\u2550\u2550 LAYOUT RULES \u2550\u2550\u2550
- fontSize 72px \u2192 ~43px/char width. "GOLDEN MOMENTS"(14 chars) needs container \u2265 660px.
- Always set whiteSpace: "nowrap" on title text.
- Container must be wide enough for its text + 120px padding.
- Title 60-80px, subtitle 24-32px. textShadow: "0 2px 12px rgba(0,0,0,0.8)".

\u2550\u2550\u2550 QUALITY REQUIREMENTS \u2550\u2550\u2550
- At least 5 animated elements with staggered entrances
- Both entrance AND exit animations (exit = last 20% of duration)
- Mix at least 3 animation techniques
- Broadcast-quality: Netflix/ESPN/Apple level
- whiteSpace: "nowrap" on ALL text elements

\u2550\u2550\u2550 STYLE-SPECIFIC LAYOUT (FOLLOW THIS EXACTLY for style: "${stylePreset}") \u2550\u2550\u2550

${stylePreset === "minimal" ? `MINIMAL: Center screen, pure typography, NO glass panels, NO bokeh, NO dark bars.
Phase 1: Thin line draws in from center outward (SVG, 1-2px).
Phase 2: Large title fades+scales in, centered, 80-100px, wide letterSpacing.
Phase 3: Subtitle word-by-word below, 28-36px, opacity 0.7.
Phase 4: Second thin line below subtitle.
Phase 5: Small tag label fades in, 16px, very wide letterSpacing.
Hold: Breathing scale pulse (Math.sin \u00b11-2%) on title.
Exit: Fade out + lines retract to center.` : ""}
${stylePreset === "corporate" ? `CORPORATE: Bottom info bar + top-right badge. Data-rich, professional.
Phase 1: Brand color stripe appears left edge (4-6px wide, slides up full height).
Phase 2: Light background bar slides in from left (bottom, 60-80px tall, 50-60% width).
Phase 3: Show name on bar, dark text, bold sans-serif, 20-24px.
Phase 4: Large title above bar, 60-72px, white, bold.
Phase 5: Number counter animates up (tabular-nums).
Phase 6: Top-right badge slides down, category label.
Phase 7: Progress bar fills from left.
Exit: Counter freezes, badge up, bar right, stripe retracts.` : ""}
${stylePreset === "playful" ? `PLAYFUL: Energetic, asymmetric, multiple bright colors.
Phase 1: Main word CRASHES from above, heavy bounce (damping:4, stiffness:400), rotation.
Phase 2: Colored background blob scales in behind title.
Phase 3: Supporting words pop from random directions, each different color (damping:6).
Phase 4: Decorative stars/sparkles \u2726 at corners with scale bounce.
Phase 5: Arrow or underline wiggles (Math.sin oscillation).
Hold: Multiple elements wiggle/pulse continuously.
Exit: Scale down + fade with bounce.` : ""}
${stylePreset === "cinematic" ? `CINEMATIC: Letterbox + glass lower-third + typewriter.
Phase 1: Letterbox bars top/bottom slide in.
Phase 2: Glass panel slides from left with spring overshoot (damping:18).
Phase 3: Typewriter title, character by character, blinking cursor.
Phase 4: Gold accent line draws in below title.
Phase 5: Subtitle words pop one by one.
Phase 6: SVG decorative curve + bokeh particles float up.
Exit: Everything reverses \u2014 particles, line, text, bar, letterbox.` : ""}
${stylePreset === "fullscreen" ? `FULLSCREEN: Entire canvas. Centered massive title. No panels.
Phase 1: Vignette overlay (radial gradient darkening edges).
Phase 2: Title clipPath wipe reveal left-to-right, 100-140px, centered, wide letterSpacing.
Phase 3: Subtitle gradient reveal from center, 24-32px, ALL CAPS, letterSpacing 8px.
Phase 4: Decorative border/frame draws in (4 SVG lines from center).
Phase 5: 30+ particle field across entire canvas.
Phase 6: Slow zoom 1.0\u21921.04 on entire composition.
Exit: All fade, vignette intensifies then out.` : ""}
${stylePreset === "hud" ? `HUD: Sci-fi data overlay. Monospace font. Corner brackets.
Phase 1: L-shaped corner brackets at all 4 corners (SVG strokeDashoffset).
Phase 2: Horizontal scan line sweeps top-to-bottom (continuous loop).
Phase 3: Center data panel with glitch flicker entry (rapid opacity).
Phase 4: Typewriter data fields: "LOCATION: [value]", "STATUS: ACTIVE", "SIGNAL: \u2588\u2588\u2588\u2588\u2591\u2591 67%".
Phase 5: Progress bars fill from left.
Phase 6: Pulsing ring in corner (Math.sin).
Hold: Scan line sweeps, data blinks, occasional glitch.
Exit: Glitch flicker out.
REQUIRED: monospace font throughout, corner brackets SVG.` : ""}
${stylePreset === "split" ? `SPLIT: Diagonal split screen. Two contrasting zones.
Phase 1: Diagonal slash line draws across screen (SVG strokeDashoffset).
Phase 2: Left panel slides from left, color A, semi-transparent.
Phase 3: Right panel slides from right, color B, semi-transparent.
Phase 4: Left label appears in left zone, large bold.
Phase 5: Right label appears in right zone, large bold, contrasting color.
Phase 6: "VS" or center label pops at intersection with scale bounce (damping:5).
Phase 7: Stats in each zone.
Hold: Panels pulse in opposite rhythms.
Exit: Panels slide back out to sides.` : ""}
${!["minimal", "corporate", "playful", "cinematic", "fullscreen", "hud", "split"].includes(stylePreset) ? `GENERAL (${stylePreset}): Use lower-third OR centered title as appropriate. 5+ elements, staggered.` : ""}

\u2550\u2550\u2550 OUTPUT FORMAT \u2550\u2550\u2550
Respond with ONLY valid JSON (no markdown, no commentary):
{"name":"PascalCaseName","code":"import { useCurrentFrame, useVideoConfig, interpolate, spring, Easing, AbsoluteFill } from 'remotion';\\n\\nexport const PascalCaseName: React.FC = () => {\\n  // ... \\n  return (<AbsoluteFill>{/* elements */}</AbsoluteFill>);\\n};","description":"One sentence"}`;
}

const STYLE_USER_INSTRUCTIONS: Record<string, string> = {
  minimal:
    "CENTER-ALIGNED pure typography. Thin lines + large title + subtitle. NO glass panels, NO bokeh, NO dark bars. Breathing pulse during hold.",
  corporate:
    "Data-rich info bar at bottom + top-right badge. Animated number counter. Brand color stripe. Progress bar.",
  playful:
    "CRASH main word from above with heavy bounce (damping:4). At least 3 bright colors. Emoji/symbol accent. Wobble animations. Asymmetric layout.",
  cinematic:
    "Letterbox bars + glass lower-third from left + typewriter title + gold accent line + SVG curve + bokeh particles.",
  fullscreen:
    "Use ENTIRE 1920\u00d71080 canvas. 100-140px centered title via clipPath wipe. 30+ particle field. SVG border frame. Vignette. Slow zoom.",
  hud: "Monospace font. Corner bracket SVG animations. Scan line sweep. Typewriter data fields with LOCATION/STATUS/SIGNAL. Glitch flicker.",
  split:
    "Diagonal slash SVG. Two color panels from opposite sides. Large labels per zone. 'VS' bounce pop at center. Opposite-rhythm pulsing.",
};

// ---------------------------------------------------------------------------
// generateMotion
// ---------------------------------------------------------------------------

export async function generateMotion(
  api: GeminiApiParams,
  description: string,
  options: GeminiMotionOptions = {},
): Promise<GeminiMotionResult> {
  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;
  const durationInFrames = Math.round(duration * fps);
  const stylePreset = options.style || "modern and clean";
  const modelId = options.model || "gemini-2.5-pro";

  let systemPrompt = buildMotionSystemPrompt(
    width,
    height,
    fps,
    duration,
    durationInFrames,
    stylePreset,
  );

  if (options.videoContext) {
    const sourceLabel = options.sourceType === "image" ? "IMAGE" : "VIDEO";
    systemPrompt += `\n\n\u2550\u2550\u2550 ${sourceLabel} ANALYSIS (apply to all design decisions) \u2550\u2550\u2550\n${options.videoContext}\n\nUse the identified colors, safe zones, mood, and subjects to inform animation style, typography, and color palette.`;
  }

  const styleInstruction =
    STYLE_USER_INSTRUCTIONS[stylePreset] ??
    "5+ animated elements, staggered timing, entrance and exit animations, large text.";

  const userPrompt = `Create a STUNNING broadcast-quality Remotion motion graphic: "${description}"

STYLE: ${stylePreset.toUpperCase()} \u2014 ${styleInstruction}

UNIVERSAL RULES:
- At least 5 independently animated elements
- spring({ delay }) for ALL staggering \u2014 NO <Sequence>
- Title text minimum 60px \u2014 plays on 1080p screen
- Both entrance AND exit animations
- whiteSpace: "nowrap" on all text`;

  try {
    const response = await fetch(
      `${api.baseUrl}/models/${modelId}:generateContent?key=${api.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 16384,
          },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      return {
        success: false,
        error: `Gemini API error (${response.status}): ${err}`,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { success: false, error: "No response from Gemini" };
    }

    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: "Could not parse JSON from Gemini response",
      };
    }

    const result = JSON.parse(jsonMatch[0]) as {
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
  api: GeminiApiParams,
  existingCode: string,
  instructions: string,
  options: GeminiMotionOptions = {},
): Promise<GeminiMotionResult> {
  const width = options.width || 1920;
  const height = options.height || 1080;
  const fps = options.fps || 30;
  const duration = options.duration || 5;
  const durationInFrames = Math.round(duration * fps);
  const modelId = options.model || "gemini-2.5-pro";

  const systemPrompt = `You are a world-class broadcast motion graphics designer. Modify the provided Remotion component based on instructions.

CANVAS: ${width}\u00d7${height}px | ${fps}fps | ${durationInFrames} frames (${duration}s)

\u2550\u2550\u2550 ABSOLUTE RULES (must not break) \u2550\u2550\u2550
1. ROOT must be <AbsoluteFill> with NO backgroundColor.
2. NO CSS animations \u2014 ALL motion MUST use useCurrentFrame() + interpolate()/spring().
3. ONE SINGLE exported component \u2014 no sub-components.
4. spring() ALWAYS needs fps: spring({ frame, fps, config: { damping: 200 } })
5. interpolate() outputRange MUST be an array:
   \u2705 CORRECT: interpolate(exitEase, [0, 1], [barH, 0])
   \u274c WRONG:   interpolate(exitEase, [0, 1], barH, 0)
6. Use spring({ delay }) for staggering \u2014 NO <Sequence>.
7. whiteSpace: "nowrap" on all text elements.

\u2550\u2550\u2550 MODIFICATION RULES \u2550\u2550\u2550
- Make ONLY the changes requested. Preserve all working animation logic.
- Keep the component name unchanged unless explicitly asked to rename it.

\u2550\u2550\u2550 OUTPUT FORMAT \u2550\u2550\u2550
Respond with ONLY valid JSON (no markdown):
{
  "name": "SameComponentName",
  "code": "complete modified tsx code",
  "description": "One sentence describing the changes made"
}`;

  try {
    const response = await fetch(
      `${api.baseUrl}/models/${modelId}:generateContent?key=${api.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Here is the existing Remotion component code:\n\`\`\`tsx\n${existingCode}\n\`\`\`\n\nModification instructions: ${instructions}\n\nReturn the complete modified component as JSON.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.5, maxOutputTokens: 16384 },
        }),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      return {
        success: false,
        error: `Gemini API error (${response.status}): ${err}`,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { success: false, error: "No response from Gemini" };

    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
      return {
        success: false,
        error: "Could not parse JSON from Gemini response",
      };

    const result = JSON.parse(jsonMatch[0]) as {
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
