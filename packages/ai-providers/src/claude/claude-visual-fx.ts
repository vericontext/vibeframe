/**
 * Visual effects helpers for ClaudeProvider.
 *
 * Extracted methods: analyzeColorGrade, analyzeForSpeedRamp,
 * analyzeFrameForReframe, generateNarrationScript
 */

import type { TranscriptSegment } from "../interface/types.js";
import type { ClaudeApiParams } from "./claude-api.js";
import { callClaude, extractJsonObject } from "./claude-api.js";

// ---------------------------------------------------------------------------
// analyzeColorGrade
// ---------------------------------------------------------------------------

/** Built-in color grade presets */
const COLOR_PRESETS: Record<string, { ffmpegFilter: string; description: string }> = {
  "film-noir": {
    ffmpegFilter: "colorbalance=rs=0.1:gs=-0.1:bs=-0.1:rm=-0.05:gm=-0.1:bm=0.1,eq=contrast=1.3:brightness=-0.05:saturation=0.3",
    description: "Classic film noir look with high contrast, desaturated colors and slight blue shadows",
  },
  "vintage": {
    ffmpegFilter: "colorbalance=rs=0.15:gs=0.05:bs=-0.15:rh=0.1:gh=0:bh=-0.1,eq=saturation=0.8:contrast=1.1,curves=vintage",
    description: "Warm vintage film look with faded blacks and orange/teal split toning",
  },
  "cinematic-warm": {
    ffmpegFilter: "colorbalance=rs=0.1:gs=0.05:bs=-0.1:rm=0.05:gm=0.02:bm=-0.05,eq=contrast=1.15:saturation=0.9,curves=r='0/0 0.25/0.22 0.5/0.5 0.75/0.78 1/1':g='0/0 0.5/0.5 1/1':b='0/0.02 0.5/0.48 1/0.98'",
    description: "Warm cinematic color grade with lifted blacks and orange highlights",
  },
  "cool-tones": {
    ffmpegFilter: "colorbalance=rs=-0.1:gs=0:bs=0.15:rm=-0.05:gm=0:bm=0.1,eq=saturation=0.85:contrast=1.1",
    description: "Cool blue-tinted look with desaturated colors for a modern feel",
  },
  "high-contrast": {
    ffmpegFilter: "eq=contrast=1.4:brightness=0.02:saturation=1.1,curves=all='0/0 0.15/0.05 0.5/0.5 0.85/0.95 1/1'",
    description: "High contrast punchy look with deep blacks and bright whites",
  },
  "pastel": {
    ffmpegFilter: "eq=saturation=0.6:brightness=0.1:contrast=0.9,colorbalance=rs=0.05:gs=0.05:bs=0.1",
    description: "Soft pastel look with lifted shadows and reduced saturation",
  },
  "cyberpunk": {
    ffmpegFilter: "colorbalance=rs=-0.15:gs=0.1:bs=0.2:rm=0.2:gm=-0.1:bm=0.1,eq=contrast=1.3:saturation=1.4,hue=h=10",
    description: "Neon cyberpunk style with magenta/cyan split toning and high saturation",
  },
  "horror": {
    ffmpegFilter: "colorbalance=rs=-0.1:gs=-0.15:bs=0.05,eq=contrast=1.35:brightness=-0.1:saturation=0.5,curves=all='0/0 0.25/0.15 0.5/0.45 0.75/0.8 1/1'",
    description: "Dark horror atmosphere with crushed blacks, desaturation and cold tones",
  },
};

export async function analyzeColorGrade(
  api: ClaudeApiParams | null,
  style: string,
  preset?: string
): Promise<{ ffmpegFilter: string; description: string }> {
  // If preset is specified, return it directly
  if (preset && COLOR_PRESETS[preset]) {
    return COLOR_PRESETS[preset];
  }

  // If no API key, try to match style to preset
  if (!api) {
    const styleLower = style.toLowerCase();
    for (const [key, value] of Object.entries(COLOR_PRESETS)) {
      if (styleLower.includes(key.replace("-", " ")) || styleLower.includes(key)) {
        return value;
      }
    }
    return {
      ffmpegFilter: "eq=contrast=1.1:saturation=0.95",
      description: "Default slight contrast boost (API key required for custom styles)",
    };
  }

  const systemPrompt = `You are an expert colorist who translates visual style descriptions into FFmpeg filter chains.

Available FFmpeg filters you can use:
- eq: brightness (-1 to 1), contrast (0 to 2), saturation (0 to 3), gamma (0.1 to 10)
- colorbalance: rs/gs/bs (shadows), rm/gm/bm (midtones), rh/gh/bh (highlights) all -1 to 1
- hue: h (hue shift 0-360), s (saturation multiplier)
- curves: per-channel curves r/g/b/all with control points
- lut3d: apply LUT file (but we'll avoid this for simplicity)
- colortemperature: temperature (1000-40000K), mix (0-1)

Rules:
1. Combine multiple filters with commas
2. Keep values subtle and realistic (avoid extreme values)
3. Consider color harmony (complementary/split-complementary toning)
4. Focus on: shadows, midtones, highlights, overall saturation and contrast

Respond with JSON only:
{
  "ffmpegFilter": "eq=contrast=1.1:saturation=0.9,colorbalance=rs=0.1:bs=-0.1",
  "description": "Brief description of the look"
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Create an FFmpeg color grading filter for this style: "${style}"`,
      }],
      maxTokens: 1024,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) {
      return { ffmpegFilter: "eq=contrast=1.1", description: "Default grade" };
    }

    return JSON.parse(jsonStr) as { ffmpegFilter: string; description: string };
  } catch (error) {
    console.error("Error analyzing color grade:", error);
    return { ffmpegFilter: "eq=contrast=1.1", description: "Default grade (error)" };
  }
}

// ---------------------------------------------------------------------------
// analyzeForSpeedRamp
// ---------------------------------------------------------------------------

export async function analyzeForSpeedRamp(
  api: ClaudeApiParams,
  segments: TranscriptSegment[],
  options: {
    style?: "dramatic" | "smooth" | "action";
    minSpeed?: number;
    maxSpeed?: number;
  } = {}
): Promise<{ keyframes: Array<{ time: number; speed: number; reason: string }> }> {
  const style = options.style || "dramatic";
  const minSpeed = options.minSpeed || 0.25;
  const maxSpeed = options.maxSpeed || 4.0;

  const transcriptWithTimestamps = segments
    .map((seg) => `[${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const styleDescriptions = {
    dramatic: "Slow down for emotional moments, speed through transitions and filler",
    smooth: "Gentle speed variations, maintain flow and readability",
    action: "Quick cuts, speed up calm moments, slow for impact",
  };

  const systemPrompt = `You are a video editor creating dynamic speed ramps based on content analysis.

Style: ${style}
${styleDescriptions[style]}

Speed range: ${minSpeed}x to ${maxSpeed}x (1.0 = normal speed)

Analyze the transcript and identify moments where speed should change:
1. **Slow motion (${minSpeed}x-0.5x)**: Emotional reveals, important statements, dramatic pauses, key visual moments
2. **Normal speed (0.8x-1.2x)**: Standard dialogue, normal pacing
3. **Fast forward (2x-${maxSpeed}x)**: Transitions, filler content, repetitive sections, "um/uh" moments

Guidelines:
- Create smooth transitions between speeds (don't jump abruptly)
- Group similar content together
- Minimum segment duration at each speed: 0.5 seconds real-time
- Space keyframes naturally based on content rhythm

Respond with JSON only:
{
  "keyframes": [
    {"time": 0, "speed": 1.0, "reason": "Start at normal speed"},
    {"time": 5.2, "speed": 0.5, "reason": "Slow for emotional reveal"},
    {"time": 8.1, "speed": 1.0, "reason": "Return to normal"},
    {"time": 12.5, "speed": 2.0, "reason": "Speed through transition"}
  ]
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyze this transcript and create speed ramp keyframes:\n\n${transcriptWithTimestamps}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) return { keyframes: [] };

    return JSON.parse(jsonStr) as {
      keyframes: Array<{ time: number; speed: number; reason: string }>;
    };
  } catch (error) {
    console.error("Error analyzing for speed ramp:", error);
    return { keyframes: [] };
  }
}

// ---------------------------------------------------------------------------
// analyzeFrameForReframe
// ---------------------------------------------------------------------------

export async function analyzeFrameForReframe(
  api: ClaudeApiParams | null,
  frameBase64: string,
  targetAspect: string,
  options: {
    focusMode?: "auto" | "face" | "center" | "action";
    sourceWidth: number;
    sourceHeight: number;
    mimeType?: string;
  }
): Promise<{
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  confidence: number;
  subjectDescription: string;
}> {
  const { sourceWidth, sourceHeight, focusMode = "auto", mimeType = "image/jpeg" } = options;

  // Calculate target dimensions
  const [targetW, targetH] = targetAspect.split(":").map(Number);
  const targetRatio = targetW / targetH;
  const sourceRatio = sourceWidth / sourceHeight;

  let cropWidth: number;
  let cropHeight: number;

  if (sourceRatio > targetRatio) {
    // Source is wider, crop horizontally
    cropHeight = sourceHeight;
    cropWidth = Math.round(sourceHeight * targetRatio);
  } else {
    // Source is taller, crop vertically
    cropWidth = sourceWidth;
    cropHeight = Math.round(sourceWidth / targetRatio);
  }

  // Default center crop
  const defaultCropX = Math.round((sourceWidth - cropWidth) / 2);
  const defaultCropY = Math.round((sourceHeight - cropHeight) / 2);

  // If center mode, just return center crop
  if (focusMode === "center") {
    return {
      cropX: defaultCropX,
      cropY: defaultCropY,
      cropWidth,
      cropHeight,
      confidence: 1.0,
      subjectDescription: "Center-focused crop",
    };
  }

  // Use Claude Vision to analyze subject position
  if (!api) {
    return {
      cropX: defaultCropX,
      cropY: defaultCropY,
      cropWidth,
      cropHeight,
      confidence: 0.5,
      subjectDescription: "Default center crop (API key required for smart reframe)",
    };
  }

  const focusModePrompts = {
    auto: "Identify the main subject or point of interest in the frame",
    face: "Focus on human faces, prioritize face visibility",
    action: "Focus on motion and action, follow moving subjects",
  };

  const systemPrompt = `You are analyzing a video frame to determine optimal crop position for ${targetAspect} aspect ratio.

Source dimensions: ${sourceWidth}x${sourceHeight}
Target crop dimensions: ${cropWidth}x${cropHeight}
Focus mode: ${focusMode} - ${focusModePrompts[focusMode as keyof typeof focusModePrompts] || focusModePrompts.auto}

Analyze the frame and determine:
1. Where is the main subject/point of interest?
2. What crop position (cropX, cropY) would best frame the subject?

Constraints:
- cropX must be between 0 and ${sourceWidth - cropWidth}
- cropY must be between 0 and ${sourceHeight - cropHeight}
- Keep the subject within the crop bounds
- For faces, keep them in upper third
- For action, anticipate movement direction

Respond with JSON only:
{
  "cropX": 100,
  "cropY": 50,
  "confidence": 0.85,
  "subjectDescription": "Person speaking on left side of frame"
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: frameBase64,
            },
          },
          {
            type: "text",
            text: `Analyze this frame for ${targetAspect} reframe. Where should we crop to best capture the subject?`,
          },
        ] as unknown as string,
      }],
      maxTokens: 1024,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) {
      return { cropX: defaultCropX, cropY: defaultCropY, cropWidth, cropHeight, confidence: 0.5, subjectDescription: "Default crop" };
    }

    const result = JSON.parse(jsonStr) as {
      cropX: number;
      cropY: number;
      confidence: number;
      subjectDescription: string;
    };

    // Validate and clamp values
    const clampedCropX = Math.max(0, Math.min(result.cropX, sourceWidth - cropWidth));
    const clampedCropY = Math.max(0, Math.min(result.cropY, sourceHeight - cropHeight));

    return {
      cropX: clampedCropX,
      cropY: clampedCropY,
      cropWidth,
      cropHeight,
      confidence: result.confidence,
      subjectDescription: result.subjectDescription,
    };
  } catch (error) {
    console.error("Error analyzing frame for reframe:", error);
    return {
      cropX: defaultCropX,
      cropY: defaultCropY,
      cropWidth,
      cropHeight,
      confidence: 0.5,
      subjectDescription: "Default crop (error)",
    };
  }
}

// ---------------------------------------------------------------------------
// generateNarrationScript
// ---------------------------------------------------------------------------

export async function generateNarrationScript(
  api: ClaudeApiParams,
  videoAnalysis: string,
  duration: number,
  style: "informative" | "energetic" | "calm" | "dramatic" = "informative",
  language: string = "en"
): Promise<{
  success: boolean;
  script?: string;
  segments?: Array<{ startTime: number; endTime: number; text: string }>;
  error?: string;
}> {
  const styleGuides: Record<string, string> = {
    informative: "Clear, educational, and objective. Focus on facts and explanations. Professional but accessible tone.",
    energetic: "Enthusiastic, dynamic, and engaging. Use active language and build excitement. Great for action content.",
    calm: "Soothing, gentle, and peaceful. Measured pace with thoughtful pauses. Ideal for nature or meditation content.",
    dramatic: "Cinematic and emotional. Build tension and create impact. Use powerful language and evocative descriptions.",
  };

  const languageInstructions = language === "en"
    ? ""
    : `IMPORTANT: Write the narration script in ${language} language.`;

  const systemPrompt = `You are an expert video narrator creating voiceover scripts.

Target duration: ${duration} seconds (approximately ${Math.round(duration * 2.5)} words at normal speaking pace)
Style: ${style} - ${styleGuides[style]}
${languageInstructions}

Based on the video analysis provided, write a narration script that:
1. Matches the visual content timing
2. Enhances viewer understanding without being redundant
3. Maintains the specified style throughout
4. Is the right length for the duration (2-3 words per second)
5. Has natural flow and rhythm for voiceover delivery

IMPORTANT: Respond with JSON only:
{
  "script": "The complete narration script as a single string...",
  "segments": [
    {"startTime": 0, "endTime": 5.5, "text": "First segment of narration..."},
    {"startTime": 5.5, "endTime": 12.0, "text": "Second segment..."}
  ]
}

The segments should divide the script into natural phrases that align with video scenes.
Each segment should be 3-10 seconds long.`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Create a narration script for this video:\n\n${videoAnalysis}`,
      }],
      maxTokens: 4096,
    });

    // Extract JSON from response
    let jsonText = text;
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Try to find JSON object
    const objectMatch = jsonText.match(/\{[\s\S]*"script"[\s\S]*\}/);
    if (objectMatch) {
      jsonText = objectMatch[0];
    }

    const result = JSON.parse(jsonText) as {
      script: string;
      segments?: Array<{ startTime: number; endTime: number; text: string }>;
    };

    return {
      success: true,
      script: result.script,
      segments: result.segments || [],
    };
  } catch (error) {
    console.error("Claude generateNarrationScript error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate narration script",
    };
  }
}
