/**
 * Content analysis helpers for ClaudeProvider.
 *
 * Extracted methods: analyzeForHighlights, analyzeBrollContent,
 * analyzeNarrationForVisuals, matchBrollToNarration
 */

import type {
  TranscriptSegment,
  Highlight,
  HighlightCriteria,
  BrollClipInfo,
  NarrationSegment,
  BrollMatch,
} from "../interface/types.js";
import type { ClaudeApiParams } from "./claude-api.js";
import { callClaude, extractJsonArray, extractJsonObject } from "./claude-api.js";

// ---------------------------------------------------------------------------
// analyzeForHighlights
// ---------------------------------------------------------------------------

export async function analyzeForHighlights(
  api: ClaudeApiParams,
  segments: TranscriptSegment[],
  options: {
    criteria?: HighlightCriteria;
    targetDuration?: number;
    maxCount?: number;
  } = {}
): Promise<Highlight[]> {
  const criteria = options.criteria || "all";

  // Format segments for analysis
  const transcriptWithTimestamps = segments
    .map((seg) => `[${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const systemPrompt = `You are an expert video editor analyzing a transcript to identify the most engaging moments for a highlight reel.

Criteria definitions:
- "emotional": Strong emotional content - excitement, humor, surprise, inspiration, heartfelt moments, dramatic reveals
- "informative": Key insights, important facts, valuable takeaways, "aha" moments, educational content
- "funny": Comedy, wit, unexpected humor, amusing anecdotes, entertaining moments
- "all": All types of engaging content

Current selection criteria: "${criteria}"

For each highlight you identify, provide:
1. Start timestamp (in seconds) - align with segment boundaries when possible
2. End timestamp (in seconds) - complete the thought/moment naturally
3. A brief reason why this is a highlight (1 sentence)
4. The relevant transcript text
5. A confidence score from 0 to 1 (0.7+ for strong highlights)
6. Category: "emotional", "informative", or "funny"

Guidelines:
- Prefer complete thoughts and natural breakpoints
- Avoid cutting mid-sentence or mid-thought
- Higher confidence for universally engaging content
- Consider pacing - highlights should have good energy
- Minimum highlight duration: 5 seconds
- Maximum highlight duration: 60 seconds
${options.targetDuration ? `- Target total highlight duration: approximately ${options.targetDuration} seconds` : ""}
${options.maxCount ? `- Maximum number of highlights: ${options.maxCount}` : ""}

Respond with a JSON array ONLY (no other text):
[{"startTime": 120.5, "endTime": 145.2, "reason": "Key insight about...", "transcript": "The actual text...", "confidence": 0.92, "category": "informative"}]`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyze this transcript and identify the most engaging highlights:\n\n${transcriptWithTimestamps}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) return [];

    const rawHighlights = JSON.parse(jsonStr) as Array<{
      startTime: number;
      endTime: number;
      reason: string;
      transcript: string;
      confidence: number;
      category: "emotional" | "informative" | "funny";
    }>;

    // Transform and add index
    return rawHighlights.map((h, index) => ({
      index: index + 1,
      startTime: h.startTime,
      endTime: h.endTime,
      duration: h.endTime - h.startTime,
      reason: h.reason,
      transcript: h.transcript,
      confidence: h.confidence,
      category: h.category,
    }));
  } catch (error) {
    console.error("Error analyzing highlights:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// analyzeBrollContent
// ---------------------------------------------------------------------------

export async function analyzeBrollContent(
  api: ClaudeApiParams,
  frameBase64: string,
  fileName: string,
  mimeType: string = "image/jpeg"
): Promise<{ description: string; tags: string[] }> {
  const systemPrompt = `You are a video editor analyzing a frame from B-roll footage for matching purposes.

Analyze this video frame and provide:
1. A brief description of what's shown (1-2 sentences, be specific about subjects, actions, and setting)
2. 5-10 keyword tags for semantic matching (e.g., "office", "technology", "people working", "close-up", "nature", "urban")

Focus on:
- Main subjects and their actions
- Setting/environment
- Mood/tone
- Camera angle/shot type (close-up, wide, etc.)
- Time of day, lighting conditions

Respond with JSON only:
{"description": "Brief description here", "tags": ["tag1", "tag2", "tag3"]}`;

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
            text: `Analyze this frame from B-roll footage: "${fileName}"`,
          },
        ] as unknown as string,
      }],
      maxTokens: 1024,
    });

    const jsonStr = extractJsonObject(text);
    if (!jsonStr) {
      return { description: `Content from ${fileName}`, tags: [] };
    }

    return JSON.parse(jsonStr) as { description: string; tags: string[] };
  } catch (error) {
    console.error("Error analyzing B-roll content:", error);
    return { description: `Content from ${fileName}`, tags: [] };
  }
}

// ---------------------------------------------------------------------------
// analyzeNarrationForVisuals
// ---------------------------------------------------------------------------

export async function analyzeNarrationForVisuals(
  api: ClaudeApiParams,
  segments: Array<{ startTime: number; endTime: number; text: string }>
): Promise<NarrationSegment[]> {
  const fallback = segments.map((seg, i) => ({
    index: i,
    startTime: seg.startTime,
    endTime: seg.endTime,
    text: seg.text,
    visualDescription: "",
    suggestedBrollTags: [],
  }));

  const formattedSegments = segments
    .map((seg, i) => `[${i}] [${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s] ${seg.text}`)
    .join("\n");

  const systemPrompt = `You are a video editor analyzing narration segments to determine appropriate B-roll footage.

For each segment, provide:
1. A description of the ideal visual to accompany this narration
2. 3-5 keyword tags for finding matching B-roll

Consider:
- What the narration is describing or discussing
- Abstract concepts that could be visualized
- Mood and tone that should match
- Variety (don't suggest the same visuals for every segment)

Respond with a JSON array only:
[{"index": 0, "visualDescription": "...", "suggestedBrollTags": ["tag1", "tag2"]}]`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyze these narration segments and suggest appropriate B-roll visuals:\n\n${formattedSegments}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) return fallback;

    const analyzed = JSON.parse(jsonStr) as Array<{
      index: number;
      visualDescription: string;
      suggestedBrollTags: string[];
    }>;

    // Merge with original segments
    return segments.map((seg, i) => {
      const analysis = analyzed.find((a) => a.index === i);
      return {
        index: i,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        visualDescription: analysis?.visualDescription || "",
        suggestedBrollTags: analysis?.suggestedBrollTags || [],
      };
    });
  } catch (error) {
    console.error("Error analyzing narration for visuals:", error);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// matchBrollToNarration
// ---------------------------------------------------------------------------

export async function matchBrollToNarration(
  api: ClaudeApiParams,
  narrationSegments: NarrationSegment[],
  brollClips: BrollClipInfo[]
): Promise<BrollMatch[]> {
  if (narrationSegments.length === 0 || brollClips.length === 0) {
    return [];
  }

  const formattedNarration = narrationSegments
    .map(
      (seg) =>
        `[Segment ${seg.index}] [${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s]\n  Text: "${seg.text}"\n  Visual need: ${seg.visualDescription}\n  Tags: ${seg.suggestedBrollTags.join(", ")}`
    )
    .join("\n\n");

  const formattedBroll = brollClips
    .map(
      (clip) =>
        `[${clip.id}] (${clip.duration.toFixed(1)}s) ${clip.description}\n  Tags: ${clip.tags.join(", ")}`
    )
    .join("\n\n");

  const systemPrompt = `You are an expert video editor matching B-roll footage to narration segments.

Your task:
1. For each narration segment, find the best matching B-roll clip
2. Consider semantic relevance between narration content and B-roll visuals
3. Use tag overlap as a primary matching signal
4. Aim for visual variety (avoid using the same B-roll repeatedly unless it's the only good match)
5. Match B-roll duration to segment duration (prefer clips that fit)

Scoring guidelines:
- 0.9+ : Perfect semantic match, tags align well, duration fits
- 0.7-0.9 : Good thematic match, some tag overlap
- 0.5-0.7 : Acceptable match, general relevance
- Below 0.5 : Weak match, consider leaving unmatched

For each match, provide:
- suggestedStartOffset: Where to start within the B-roll clip (usually 0)
- suggestedDuration: How long to use (match narration segment duration if possible)

Respond with JSON array only (empty array if no good matches):
[{"narrationSegmentIndex": 0, "brollClipId": "clip-id", "confidence": 0.85, "reason": "Why this matches", "suggestedStartOffset": 0, "suggestedDuration": 5.5}]`;

  try {
    const text = await callClaude(api, {
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Match B-roll clips to narration segments.\n\n## Narration Segments:\n${formattedNarration}\n\n## Available B-roll Clips:\n${formattedBroll}`,
      }],
      maxTokens: 4096,
    });

    const jsonStr = extractJsonArray(text);
    if (!jsonStr) return [];

    return JSON.parse(jsonStr) as BrollMatch[];
  } catch (error) {
    console.error("Error matching B-roll to narration:", error);
    return [];
  }
}
