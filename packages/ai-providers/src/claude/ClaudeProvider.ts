import type { Clip } from "@vibe-edit/core";
import type {
  AIProvider,
  AICapability,
  ProviderConfig,
  EditSuggestion,
  TranscriptSegment,
  Highlight,
  HighlightCriteria,
  BrollClipInfo,
  NarrationSegment,
  BrollMatch,
} from "../interface/types";

/**
 * Motion graphic generation options
 */
export interface MotionOptions {
  /** Duration in seconds */
  duration?: number;
  /** Width in pixels */
  width?: number;
  /** Height in pixels */
  height?: number;
  /** Frame rate */
  fps?: number;
  /** Style preset */
  style?: "minimal" | "corporate" | "playful" | "cinematic";
}

/**
 * Generated Remotion component
 */
export interface RemotionComponent {
  /** Component name */
  name: string;
  /** JSX/TSX code */
  code: string;
  /** Duration in frames */
  durationInFrames: number;
  /** Frame rate */
  fps: number;
  /** Width */
  width: number;
  /** Height */
  height: number;
  /** Description of what was generated */
  description: string;
}

/**
 * Motion graphic generation result
 */
export interface MotionResult {
  success: boolean;
  /** Generated Remotion component */
  component?: RemotionComponent;
  /** Error message if failed */
  error?: string;
}

/**
 * Storyboard segment
 */
export interface StoryboardSegment {
  /** Segment index */
  index: number;
  /** Start time in seconds */
  startTime: number;
  /** Duration in seconds */
  duration: number;
  /** Description of what happens */
  description: string;
  /** Suggested visuals */
  visuals: string;
  /** Suggested audio/music */
  audio?: string;
  /** Text overlays */
  textOverlays?: string[];
}

/**
 * Claude provider for AI-powered content creation
 */
export class ClaudeProvider implements AIProvider {
  id = "claude";
  name = "Anthropic Claude";
  description = "AI-powered motion graphics, content analysis, storyboarding, highlight detection, and B-roll matching";
  capabilities: AICapability[] = ["auto-edit", "natural-language-command", "highlight-detection", "b-roll-matching"];
  iconUrl = "/icons/claude.svg";
  isAvailable = true;

  private apiKey?: string;
  private baseUrl = "https://api.anthropic.com/v1";
  private model = "claude-sonnet-4-20250514";

  async initialize(config: ProviderConfig): Promise<void> {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate Remotion motion graphic component from natural language
   */
  async generateMotion(
    description: string,
    options: MotionOptions = {}
  ): Promise<MotionResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: "Claude API key not configured",
      };
    }

    const width = options.width || 1920;
    const height = options.height || 1080;
    const fps = options.fps || 30;
    const duration = options.duration || 5;
    const durationInFrames = Math.round(duration * fps);

    const systemPrompt = `You are an expert Remotion developer. Generate a React component for motion graphics.

Requirements:
- Use Remotion's useCurrentFrame(), useVideoConfig(), interpolate(), spring() hooks
- Component should be self-contained with inline styles
- Use TypeScript
- Canvas size: ${width}x${height}, ${fps}fps, ${durationInFrames} frames (${duration}s)
- Style: ${options.style || "modern and clean"}

Available Remotion imports:
- useCurrentFrame, useVideoConfig, interpolate, spring, Easing from 'remotion'
- AbsoluteFill, Sequence from 'remotion'

Respond with JSON only:
{
  "name": "ComponentName",
  "code": "import { useCurrentFrame, ... } from 'remotion';\\n\\nexport const ComponentName: React.FC = () => { ... }",
  "description": "What this animation does"
}`;

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Create a Remotion motion graphic: "${description}"`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Claude API error:", error);
        return {
          success: false,
          error: `API error: ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return {
          success: false,
          error: "No response from Claude",
        };
      }

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          success: false,
          error: "Could not parse response",
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

  /**
   * Analyze long-form content and generate storyboard
   */
  async analyzeContent(
    content: string,
    targetDuration?: number
  ): Promise<StoryboardSegment[]> {
    if (!this.apiKey) {
      return [];
    }

    const systemPrompt = `You are a video editor analyzing content to create a storyboard.
Break down the content into visual segments suitable for a video.
${targetDuration ? `Target total duration: ${targetDuration} seconds` : ""}

Respond with JSON array:
[
  {
    "index": 0,
    "startTime": 0,
    "duration": 5,
    "description": "What happens in this segment",
    "visuals": "Suggested visuals/footage",
    "audio": "Suggested audio/music",
    "textOverlays": ["Text to show on screen"]
  }
]`;

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Analyze this content and create a video storyboard:\n\n${content}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) return [];

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      return JSON.parse(jsonMatch[0]) as StoryboardSegment[];
    } catch {
      return [];
    }
  }

  /**
   * Get edit suggestions using Claude (implements AIProvider interface)
   */
  async autoEdit(clips: Clip[], instruction: string): Promise<EditSuggestion[]> {
    if (!this.apiKey) {
      return [];
    }

    const clipsInfo = clips.map((clip) => ({
      id: clip.id,
      startTime: clip.startTime,
      duration: clip.duration,
      effects: clip.effects?.map((e) => e.type) || [],
    }));

    const systemPrompt = `You are a video editor. Analyze clips and suggest edits.

Respond with JSON array:
[
  {
    "type": "trim|cut|add-effect|reorder|delete|split|merge",
    "description": "What this edit does",
    "clipIds": ["clip-id"],
    "params": {},
    "confidence": 0.9
  }
]`;

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          messages: [
            {
              role: "user",
              content: `Clips: ${JSON.stringify(clipsInfo)}\n\nInstruction: ${instruction}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) return [];

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) return [];

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        type: string;
        description: string;
        clipIds: string[];
        params: Record<string, unknown>;
        confidence: number;
      }>;

      return suggestions.map((s) => ({
        id: crypto.randomUUID(),
        type: s.type as EditSuggestion["type"],
        description: s.description,
        clipIds: s.clipIds,
        params: s.params,
        confidence: s.confidence,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Analyze transcript segments and identify engaging highlights
   */
  async analyzeForHighlights(
    segments: TranscriptSegment[],
    options: {
      criteria?: HighlightCriteria;
      targetDuration?: number;
      maxCount?: number;
    } = {}
  ): Promise<Highlight[]> {
    if (!this.apiKey) {
      return [];
    }

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
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Analyze this transcript and identify the most engaging highlights:\n\n${transcriptWithTimestamps}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return [];
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) return [];

      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const rawHighlights = JSON.parse(jsonMatch[0]) as Array<{
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

  /**
   * Analyze B-roll video frame content using Claude Vision
   * Extracts visual description and semantic tags for matching
   */
  async analyzeBrollContent(
    frameBase64: string,
    fileName: string,
    mimeType: string = "image/jpeg"
  ): Promise<{ description: string; tags: string[] }> {
    if (!this.apiKey) {
      return { description: "Unknown content", tags: [] };
    }

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
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [
            {
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
              ],
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude Vision API error:", await response.text());
        return { description: `Content from ${fileName}`, tags: [] };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return { description: `Content from ${fileName}`, tags: [] };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { description: `Content from ${fileName}`, tags: [] };
      }

      const result = JSON.parse(jsonMatch[0]) as {
        description: string;
        tags: string[];
      };

      return result;
    } catch (error) {
      console.error("Error analyzing B-roll content:", error);
      return { description: `Content from ${fileName}`, tags: [] };
    }
  }

  /**
   * Analyze narration text and suggest visual requirements for each segment
   */
  async analyzeNarrationForVisuals(
    segments: Array<{ startTime: number; endTime: number; text: string }>
  ): Promise<NarrationSegment[]> {
    if (!this.apiKey) {
      return segments.map((seg, i) => ({
        index: i,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        visualDescription: "",
        suggestedBrollTags: [],
      }));
    }

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
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Analyze these narration segments and suggest appropriate B-roll visuals:\n\n${formattedSegments}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return segments.map((seg, i) => ({
          index: i,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
          visualDescription: "",
          suggestedBrollTags: [],
        }));
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return segments.map((seg, i) => ({
          index: i,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
          visualDescription: "",
          suggestedBrollTags: [],
        }));
      }

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return segments.map((seg, i) => ({
          index: i,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
          visualDescription: "",
          suggestedBrollTags: [],
        }));
      }

      const analyzed = JSON.parse(jsonMatch[0]) as Array<{
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
      return segments.map((seg, i) => ({
        index: i,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        visualDescription: "",
        suggestedBrollTags: [],
      }));
    }
  }

  /**
   * Match B-roll clips to narration segments using semantic analysis
   */
  async matchBrollToNarration(
    narrationSegments: NarrationSegment[],
    brollClips: BrollClipInfo[]
  ): Promise<BrollMatch[]> {
    if (!this.apiKey || narrationSegments.length === 0 || brollClips.length === 0) {
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
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Match B-roll clips to narration segments.\n\n## Narration Segments:\n${formattedNarration}\n\n## Available B-roll Clips:\n${formattedBroll}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return [];
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) return [];

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const matches = JSON.parse(jsonMatch[0]) as BrollMatch[];
      return matches;
    } catch (error) {
      console.error("Error matching B-roll to narration:", error);
      return [];
    }
  }
}

export const claudeProvider = new ClaudeProvider();
