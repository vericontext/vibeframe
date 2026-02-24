/**
 * Viral optimization helpers for ClaudeProvider.
 *
 * Extracted methods: analyzeViralPotential, suggestPlatformCuts, generateViralCaptions
 */

import type {
  TranscriptSegment,
  ViralAnalysis,
  PlatformSpec,
  PlatformCut,
  TimeSeconds,
} from "../interface/types.js";
import type { ClaudeApiParams } from "./claude-api.js";
import { callClaude, extractJsonObject, extractJsonArray } from "./claude-api.js";

/** Default empty viral analysis for error/fallback returns */
function emptyViralAnalysis(reason: string): ViralAnalysis {
  return {
    overallScore: 0,
    hookStrength: 0,
    pacing: "moderate",
    emotionalPeaks: [],
    suggestedCuts: [],
    platforms: {},
    hookRecommendation: { suggestedStartTime: 0, reason },
  };
}

// ---------------------------------------------------------------------------
// analyzeViralPotential
// ---------------------------------------------------------------------------

export async function analyzeViralPotential(
  api: ClaudeApiParams,
  transcriptSegments: TranscriptSegment[],
  projectMeta: { duration: number; clipCount: number },
  targetPlatforms: string[]
): Promise<ViralAnalysis> {
  const transcriptWithTimestamps = transcriptSegments
    .map((seg) => `[${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const platformDescriptions = targetPlatforms.join(", ");

  const systemPrompt = `You are an expert social media content strategist analyzing video content for viral potential.

Analyze the transcript for:
1. **Hook Strength** (0-100): How engaging are the first 3 seconds? Does it grab attention immediately?
2. **Overall Viral Score** (0-100): Consider entertainment value, emotional impact, shareability, and relatability.
3. **Pacing**: Is the content slow, moderate, or fast-paced?
4. **Emotional Peaks**: Identify moments with strong emotional content (excitement, humor, surprise, inspiration).
5. **Suggested Cuts**: Identify the best segments that could stand alone as engaging content.
6. **Hook Recommendation**: If the current start isn't optimal, suggest a better starting point.

Platform context:
- YouTube (16:9, up to 10min ideally 1-8min)
- YouTube Shorts (9:16, max 60s, ideally 15-60s)
- TikTok (9:16, max 3min, ideally 15-60s)
- Instagram Reels (9:16, max 90s, ideally 15-60s)
- Instagram Feed (1:1, max 60s, ideally 15-60s)
- Twitter (16:9, max 140s, ideally 15-60s)

Target platforms for this analysis: ${platformDescriptions}

Content metadata:
- Total duration: ${projectMeta.duration}s
- Clip count: ${projectMeta.clipCount}

Respond with JSON only:
{
  "overallScore": 75,
  "hookStrength": 80,
  "pacing": "moderate",
  "emotionalPeaks": [
    {"time": 45.2, "emotion": "excitement", "intensity": 0.9},
    {"time": 120.5, "emotion": "humor", "intensity": 0.85}
  ],
  "suggestedCuts": [
    {"startTime": 10.0, "endTime": 55.0, "reason": "Best self-contained segment with high engagement"}
  ],
  "platforms": {
    "youtube": {"suitability": 0.92, "suggestions": ["Add chapter markers", "Strong thumbnail moment at 1:23"]},
    "tiktok": {"suitability": 0.75, "suggestions": ["Cut to 60s or less", "Move hook to start"]}
  },
  "hookRecommendation": {
    "suggestedStartTime": 5.2,
    "reason": "The statement at 5.2s is more attention-grabbing than the current intro"
  }
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyze this transcript for viral potential:\n\n${transcriptWithTimestamps}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) return emptyViralAnalysis("Could not parse response");

    return JSON.parse(jsonStr) as ViralAnalysis;
  } catch (error) {
    console.error("Error analyzing viral potential:", error);
    return emptyViralAnalysis("Analysis failed");
  }
}

// ---------------------------------------------------------------------------
// suggestPlatformCuts
// ---------------------------------------------------------------------------

export async function suggestPlatformCuts(
  api: ClaudeApiParams,
  transcriptSegments: TranscriptSegment[],
  viralAnalysis: ViralAnalysis,
  platform: PlatformSpec,
  clips: Array<{ id: string; startTime: number; duration: number }>
): Promise<PlatformCut> {
  const emptyResult: PlatformCut = { platform: platform.id, segments: [], totalDuration: 0 };

  const transcriptWithTimestamps = transcriptSegments
    .map((seg) => `[${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const clipsInfo = clips
    .map((c) => `[${c.id}] ${c.startTime.toFixed(1)}s - ${(c.startTime + c.duration).toFixed(1)}s (${c.duration.toFixed(1)}s)`)
    .join("\n");

  const systemPrompt = `You are an expert video editor optimizing content for ${platform.name}.

Platform requirements:
- Aspect ratio: ${platform.aspectRatio}
- Maximum duration: ${platform.maxDuration}s
- Ideal duration: ${platform.idealDuration.min}-${platform.idealDuration.max}s
- Needs strong hook: ${platform.features.hook ? "Yes" : "No"}
- Needs captions: ${platform.features.captions ? "Yes" : "No"}

Previous analysis found:
- Hook strength: ${viralAnalysis.hookStrength}%
- Emotional peaks: ${viralAnalysis.emotionalPeaks.map((p) => `${p.time.toFixed(1)}s (${p.emotion})`).join(", ")}
- Suggested hook start: ${viralAnalysis.hookRecommendation.suggestedStartTime}s

Your task:
1. Select the best segments from the video that fit within the platform's duration limits
2. Prioritize segments that include emotional peaks
3. Ensure the video starts with a strong hook
4. Return segments in chronological order
5. Each segment must reference a valid clip ID

Respond with JSON only:
{
  "platform": "${platform.id}",
  "segments": [
    {"sourceClipId": "clip-id", "startTime": 0, "endTime": 45.5, "priority": 1.0}
  ],
  "totalDuration": 45.5
}`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Optimize this video for ${platform.name}:\n\n## Transcript:\n${transcriptWithTimestamps}\n\n## Available Clips:\n${clipsInfo}`,
      }],
      maxTokens: 2048,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) return emptyResult;

    return JSON.parse(jsonStr) as PlatformCut;
  } catch (error) {
    console.error("Error suggesting platform cuts:", error);
    return emptyResult;
  }
}

// ---------------------------------------------------------------------------
// generateViralCaptions
// ---------------------------------------------------------------------------

export async function generateViralCaptions(
  api: ClaudeApiParams,
  transcriptSegments: TranscriptSegment[],
  style: "minimal" | "bold" | "animated"
): Promise<Array<{ startTime: TimeSeconds; endTime: TimeSeconds; text: string; style: string }>> {
  const transcriptWithTimestamps = transcriptSegments
    .map((seg) => `[${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const styleGuide = {
    minimal: "Clean, lowercase, simple. Use 1-3 words at a time. No emojis.",
    bold: "UPPERCASE for emphasis, short impactful phrases. Bold key words. Can use emojis sparingly.",
    animated: "Dynamic text, varied sizes, emojis, sound effects like *boom*, [music]. Very engaging.",
  };

  const systemPrompt = `You are a social media caption expert creating viral-style captions.

Style: ${style}
${styleGuide[style]}

Rules:
1. Break text into short, digestible chunks (2-5 words each)
2. Time captions to sync with speech rhythm
3. Emphasize key words and emotional moments
4. Each caption should have a style attribute: "normal", "emphasis", "highlight"

Respond with JSON array only:
[
  {"startTime": 0.0, "endTime": 1.5, "text": "This is", "style": "normal"},
  {"startTime": 1.5, "endTime": 2.5, "text": "AMAZING", "style": "emphasis"},
  {"startTime": 2.5, "endTime": 4.0, "text": "you need to see this", "style": "normal"}
]`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Generate ${style} style captions for this transcript:\n\n${transcriptWithTimestamps}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) return [];

    return JSON.parse(jsonStr) as Array<{
      startTime: TimeSeconds;
      endTime: TimeSeconds;
      text: string;
      style: string;
    }>;
  } catch (error) {
    console.error("Error generating viral captions:", error);
    return [];
  }
}
