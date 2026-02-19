import type { Clip } from "@vibeframe/core";
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
  ViralAnalysis,
  PlatformSpec,
  PlatformCut,
  TimeSeconds,
  CommandParseResult,
} from "../interface/types.js";

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
  /** Voiceover narration script */
  narration?: string;
  /** Consistent visual style reference for all scenes */
  visualStyle?: string;
  /** Detailed character description for consistency across scenes */
  characterDescription?: string;
  /** How this scene connects to the previous one */
  previousSceneLink?: string;
  /** Suggested background audio/music */
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
  description = "AI-powered motion graphics, content analysis, storyboarding, highlight detection, B-roll matching, and viral optimization";
  capabilities: AICapability[] = ["auto-edit", "natural-language-command", "highlight-detection", "b-roll-matching", "viral-optimization"];
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
   * Parse natural language command into structured timeline operations
   */
  async parseCommand(
    instruction: string,
    context: { clips: Clip[]; tracks: string[] }
  ): Promise<CommandParseResult> {
    if (!this.apiKey) {
      return {
        success: false,
        commands: [],
        error: "Claude API key not configured",
      };
    }

    try {
      const clipsInfo = context.clips.map((clip) => ({
        id: clip.id,
        name: clip.sourceId,
        startTime: clip.startTime,
        duration: clip.duration,
        trackId: clip.trackId,
        effects: clip.effects?.map((e) => e.type) || [],
      }));

      const systemPrompt = `You are a video editing assistant that converts natural language commands into structured timeline operations.

Available actions:
- add-clip: Add a new clip (params: sourceId, startTime, duration, trackId)
- remove-clip: Remove clip(s) (clipIds required)
- trim: Trim clip duration (params: startTrim, endTrim, or newDuration)
- split: Split clip at time (params: splitTime - relative to clip start)
- move: Move clip (params: newStartTime, newTrackId)
- duplicate: Duplicate clip (params: newStartTime optional)
- add-effect: Add effect (params: effectType, duration, intensity)
- remove-effect: Remove effect (params: effectType)
- set-volume: Set audio volume (params: volume 0-1)
- add-transition: Add transition between clips (params: transitionType, duration)
- add-track: Add new track (params: trackType: video|audio)
- export: Export project (params: format, quality)
- speed-change: Change clip playback speed (params: speed - e.g., 2 for 2x, 0.5 for half speed)
- reverse: Reverse clip playback (no params needed)
- crop: Crop/resize video (params: aspectRatio OR x, y, width, height)
- position: Move clips to beginning/end/middle (params: position - "beginning", "end", "middle")

Available effect types: fadeIn, fadeOut, blur, brightness, contrast, saturation, grayscale, sepia
Available transition types: crossfade, wipe, slide, fade

Current timeline state:
Clips: ${JSON.stringify(clipsInfo, null, 2)}
Tracks: ${JSON.stringify(context.tracks)}

Rules:
1. If user says "all clips" or "every clip", include all clip IDs
2. If user references "first", "last", "intro", "outro", map to appropriate clips
3. Time can be specified as "3s", "3 seconds", "00:03", etc.
4. If command is ambiguous, set clarification field
5. Multiple commands can be returned for complex instructions
6. For "speed up" use speed > 1, for "slow down" use speed < 1
7. For crop to portrait, use aspectRatio: "9:16", for square use "1:1"
8. "reverse" flips the clip playback backwards

Respond with JSON only:
{
  "success": true,
  "commands": [
    {
      "action": "trim",
      "clipIds": ["clip-id"],
      "params": {"newDuration": 5},
      "description": "Trim clip to 5 seconds"
    }
  ]
}

Or if clarification needed:
{
  "success": true,
  "commands": [],
  "clarification": "Which clip do you want to trim?"
}`;

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
              content: instruction,
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
          commands: [],
          error: `API error: ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const textContent = data.content?.find((c) => c.type === "text");
      if (!textContent?.text) {
        return {
          success: false,
          commands: [],
          error: "No response from Claude",
        };
      }

      // Extract JSON from response (Claude may include markdown code blocks)
      let jsonText = textContent.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }

      const result = JSON.parse(jsonText) as CommandParseResult;
      return {
        success: result.success ?? true,
        commands: result.commands || [],
        error: result.error,
        clarification: result.clarification,
      };
    } catch (error) {
      console.error("Claude parseCommand error:", error);
      return {
        success: false,
        commands: [],
        error: error instanceof Error ? error.message : "Failed to parse command",
      };
    }
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
- Use TypeScript with named export (export const ComponentName: React.FC = () => { ... })
- Canvas size: ${width}x${height}, ${fps}fps, ${durationInFrames} frames (${duration}s)
- Style: ${options.style || "modern and clean"}

CRITICAL — Compositing Rules:
- Background MUST be transparent (no background color on root). The component will be overlaid on video.
- Use <AbsoluteFill> as root wrapper with NO backgroundColor.
- Never use CSS animations or transitions — only useCurrentFrame() + interpolate()/spring().

Animation Best Practices:
- Always use extrapolateLeft: "clamp" and extrapolateRight: "clamp" in interpolate() to prevent values overshooting.
- spring() config guide: { damping: 200 } = smooth/no bounce, { damping: 10-15 } = gentle bounce, { damping: 5-8 } = bouncy.
- Use <Sequence from={frame} durationInFrames={n}> to stagger elements.
- For enter/exit animations, calculate exit start frame from durationInFrames.

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
   * @param content - The content/script to analyze
   * @param targetDuration - Target video duration in seconds
   * @param options - Additional options including creativity level
   */
  async analyzeContent(
    content: string,
    targetDuration?: number,
    options?: { creativity?: "low" | "high" }
  ): Promise<StoryboardSegment[]> {
    if (!this.apiKey) {
      return [];
    }

    const creativity = options?.creativity || "low";

    // Creative direction for high creativity mode
    const creativityPrompt = creativity === "high"
      ? `
CREATIVE DIRECTION (HIGH CREATIVITY MODE):
- Surprise the viewer with unexpected scene transitions and compositions
- AVOID cliche patterns like "wake up → coffee → work → lunch → evening" for day-in-life content
- Create unique visual metaphors and unconventional compositions
- Each scene should have a distinct mood, color palette, and emotional texture
- Think cinematically: use interesting angles, lighting contrasts, and visual storytelling
- Introduce unexpected elements that still fit the narrative
- Vary the pacing: some scenes intimate and slow, others dynamic and energetic
`
      : "";

    const systemPrompt = `You are a video editor analyzing content to create a storyboard.
Break down the content into visual segments suitable for a video.
${targetDuration ? `Target total duration: ${targetDuration} seconds` : ""}
${creativityPrompt}

IMPORTANT GUIDELINES:

1. CHARACTER CONSISTENCY (CRITICAL):
   - Define ONE detailed character description in the FIRST segment's "characterDescription" field
   - This EXACT description must be copied to ALL subsequent segments
   - Include: gender, age range, ethnicity, hair (color, length, style), clothing (specific items and colors), body type, distinguishing features
   - Example: "Asian male, late 20s, short black hair with slight wave, wearing navy blue henley shirt and dark gray joggers, medium build, clean-shaven, rectangular glasses"
   - The character description must appear in EVERY segment's "visuals" field

2. VISUAL CONTINUITY: Maintain consistent visual style across ALL segments:
   - Same color palette, lighting style, and art direction throughout
   - Reference elements from previous scenes when relevant
   - ALWAYS include the character description when the person appears

3. NARRATION LENGTH (CRITICAL for audio-video sync):
   - Each scene narration MUST be 12-25 words (fits within 5-10 seconds of speech)
   - NEVER exceed 30 words per scene narration — long content MUST be split into multiple scenes
   - Set duration to 5 for short narrations (12-18 words) or 10 for longer ones (19-25 words)
   - If the script has a long paragraph, break it into 2-3 shorter scenes rather than one long narration
   - This prevents freeze frames where video stops but narration continues

4. NARRATION-VISUAL ALIGNMENT: The narration must directly describe what's visible:
   - When narration mentions something specific, the visual must show it
   - Sync action words with visual actions (e.g., "pour" should show pouring)
   - Avoid generic narration - be specific to what's on screen

5. SCENE FLOW: Each segment should logically lead to the next:
   - Use previousSceneLink to describe how scenes connect
   - Maintain subject/location continuity unless intentionally changing

Respond with JSON array:
[
  {
    "index": 0,
    "startTime": 0,
    "duration": 5,
    "description": "Brief description of this segment",
    "visuals": "Detailed visual description INCLUDING CHARACTER DESCRIPTION. Example: 'Asian male, late 20s, short black hair, wearing navy blue henley shirt, sitting at wooden desk typing on laptop'",
    "narration": "Voiceover text that DIRECTLY describes what's shown in visuals",
    "visualStyle": "Art style for consistency (e.g., 'warm cinematic lighting, shallow depth of field, 4K professional video')",
    "characterDescription": "DETAILED character description - SAME in every segment. Include: gender, age, ethnicity, hair color/style, specific clothing items and colors, body type, accessories",
    "previousSceneLink": "How this connects to previous scene (e.g., 'continuation of kitchen scene' or 'new location: garden')",
    "audio": "Background music/sound effects description (optional)",
    "textOverlays": ["Text to show on screen"]
  }
]

Example of GOOD character description:
"Korean female developer, early 30s, shoulder-length straight black hair, wearing oversized cream-colored cable knit sweater and black leggings, petite build, silver hoop earrings, no glasses"

Example of BAD character description (too vague):
"A woman" or "developer" or "person working"

CRITICAL: Copy the EXACT same characterDescription to ALL segments. The character must look identical in every scene.

IMPORTANT: ALWAYS respond with a valid JSON array, even if the input is brief or vague.
- If the input is a short topic or concept, creatively expand it into a full storyboard.
- NEVER ask follow-up questions. NEVER refuse. Just generate the best storyboard you can.
- Your response must contain ONLY the JSON array (optionally wrapped in markdown code block).`;

    try {
      // Use higher temperature for creative mode
      const temperature = creativity === "high" ? 1.0 : 0.7;

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
          temperature,
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
        const errorBody = await response.text().catch(() => "");
        console.error(`[Claude API] Storyboard request failed: ${response.status} ${response.statusText}`);
        if (errorBody) console.error(`[Claude API] ${errorBody}`);
        return [];
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        console.error("[Claude API] No text content in response");
        return [];
      }

      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("[Claude API] No JSON array found in response. Response text:");
        console.error(text.slice(0, 500));
        return [];
      }

      return JSON.parse(jsonMatch[0]) as StoryboardSegment[];
    } catch (err) {
      console.error(`[Claude API] Storyboard error: ${err instanceof Error ? err.message : err}`);
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

  /**
   * Analyze video content for viral potential across platforms
   */
  async analyzeViralPotential(
    transcriptSegments: TranscriptSegment[],
    projectMeta: { duration: number; clipCount: number },
    targetPlatforms: string[]
  ): Promise<ViralAnalysis> {
    if (!this.apiKey) {
      return {
        overallScore: 0,
        hookStrength: 0,
        pacing: "moderate",
        emotionalPeaks: [],
        suggestedCuts: [],
        platforms: {},
        hookRecommendation: { suggestedStartTime: 0, reason: "API key not configured" },
      };
    }

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
              content: `Analyze this transcript for viral potential:\n\n${transcriptWithTimestamps}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return {
          overallScore: 0,
          hookStrength: 0,
          pacing: "moderate",
          emotionalPeaks: [],
          suggestedCuts: [],
          platforms: {},
          hookRecommendation: { suggestedStartTime: 0, reason: "API error" },
        };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return {
          overallScore: 0,
          hookStrength: 0,
          pacing: "moderate",
          emotionalPeaks: [],
          suggestedCuts: [],
          platforms: {},
          hookRecommendation: { suggestedStartTime: 0, reason: "No response" },
        };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          overallScore: 0,
          hookStrength: 0,
          pacing: "moderate",
          emotionalPeaks: [],
          suggestedCuts: [],
          platforms: {},
          hookRecommendation: { suggestedStartTime: 0, reason: "Could not parse response" },
        };
      }

      return JSON.parse(jsonMatch[0]) as ViralAnalysis;
    } catch (error) {
      console.error("Error analyzing viral potential:", error);
      return {
        overallScore: 0,
        hookStrength: 0,
        pacing: "moderate",
        emotionalPeaks: [],
        suggestedCuts: [],
        platforms: {},
        hookRecommendation: { suggestedStartTime: 0, reason: "Analysis failed" },
      };
    }
  }

  /**
   * Suggest optimal cuts for a specific platform
   */
  async suggestPlatformCuts(
    transcriptSegments: TranscriptSegment[],
    viralAnalysis: ViralAnalysis,
    platform: PlatformSpec,
    clips: Array<{ id: string; startTime: number; duration: number }>
  ): Promise<PlatformCut> {
    if (!this.apiKey) {
      return { platform: platform.id, segments: [], totalDuration: 0 };
    }

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
              content: `Optimize this video for ${platform.name}:\n\n## Transcript:\n${transcriptWithTimestamps}\n\n## Available Clips:\n${clipsInfo}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return { platform: platform.id, segments: [], totalDuration: 0 };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return { platform: platform.id, segments: [], totalDuration: 0 };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { platform: platform.id, segments: [], totalDuration: 0 };
      }

      return JSON.parse(jsonMatch[0]) as PlatformCut;
    } catch (error) {
      console.error("Error suggesting platform cuts:", error);
      return { platform: platform.id, segments: [], totalDuration: 0 };
    }
  }

  /**
   * Generate social-media styled captions
   */
  async generateViralCaptions(
    transcriptSegments: TranscriptSegment[],
    style: "minimal" | "bold" | "animated"
  ): Promise<Array<{ startTime: TimeSeconds; endTime: TimeSeconds; text: string; style: string }>> {
    if (!this.apiKey) {
      return [];
    }

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
              content: `Generate ${style} style captions for this transcript:\n\n${transcriptWithTimestamps}`,
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

      return JSON.parse(jsonMatch[0]) as Array<{
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

  /**
   * Analyze a style prompt and generate FFmpeg color grading filters
   */
  async analyzeColorGrade(
    style: string,
    preset?: string
  ): Promise<{
    ffmpegFilter: string;
    description: string;
  }> {
    // Built-in presets
    const presets: Record<string, { ffmpegFilter: string; description: string }> = {
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

    // If preset is specified, return it directly
    if (preset && presets[preset]) {
      return presets[preset];
    }

    // If no API key, try to match style to preset
    if (!this.apiKey) {
      const styleLower = style.toLowerCase();
      for (const [key, value] of Object.entries(presets)) {
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
              content: `Create an FFmpeg color grading filter for this style: "${style}"`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return {
          ffmpegFilter: "eq=contrast=1.1",
          description: "Default grade (API error)",
        };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return { ffmpegFilter: "eq=contrast=1.1", description: "Default grade" };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { ffmpegFilter: "eq=contrast=1.1", description: "Default grade" };
      }

      return JSON.parse(jsonMatch[0]) as {
        ffmpegFilter: string;
        description: string;
      };
    } catch (error) {
      console.error("Error analyzing color grade:", error);
      return { ffmpegFilter: "eq=contrast=1.1", description: "Default grade (error)" };
    }
  }

  /**
   * Analyze transcript for speed ramping - identify emotional peaks and emphasis points
   */
  async analyzeForSpeedRamp(
    segments: TranscriptSegment[],
    options: {
      style?: "dramatic" | "smooth" | "action";
      minSpeed?: number;
      maxSpeed?: number;
    } = {}
  ): Promise<{
    keyframes: Array<{ time: number; speed: number; reason: string }>;
  }> {
    if (!this.apiKey) {
      return { keyframes: [] };
    }

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
              content: `Analyze this transcript and create speed ramp keyframes:\n\n${transcriptWithTimestamps}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return { keyframes: [] };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return { keyframes: [] };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { keyframes: [] };
      }

      return JSON.parse(jsonMatch[0]) as {
        keyframes: Array<{ time: number; speed: number; reason: string }>;
      };
    } catch (error) {
      console.error("Error analyzing for speed ramp:", error);
      return { keyframes: [] };
    }
  }

  /**
   * Analyze a video frame for auto-reframe - identify subject position for smart cropping
   */
  async analyzeFrameForReframe(
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
    if (!this.apiKey) {
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
                  text: `Analyze this frame for ${targetAspect} reframe. Where should we crop to best capture the subject?`,
                },
              ],
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        console.error("Claude Vision API error:", await response.text());
        return {
          cropX: defaultCropX,
          cropY: defaultCropY,
          cropWidth,
          cropHeight,
          confidence: 0.5,
          subjectDescription: "Default crop (API error)",
        };
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const text = data.content.find((c) => c.type === "text")?.text;
      if (!text) {
        return {
          cropX: defaultCropX,
          cropY: defaultCropY,
          cropWidth,
          cropHeight,
          confidence: 0.5,
          subjectDescription: "Default crop",
        };
      }

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          cropX: defaultCropX,
          cropY: defaultCropY,
          cropWidth,
          cropHeight,
          confidence: 0.5,
          subjectDescription: "Default crop",
        };
      }

      const result = JSON.parse(jsonMatch[0]) as {
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

  /**
   * Generate a narration script from video analysis
   * @param videoAnalysis - Detailed description of video content (from Gemini)
   * @param duration - Target duration in seconds
   * @param style - Narration style
   * @param language - Target language code
   */
  async generateNarrationScript(
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
    if (!this.apiKey) {
      return { success: false, error: "Claude API key not configured" };
    }

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
              content: `Create a narration script for this video:\n\n${videoAnalysis}`,
            },
          ],
          system: systemPrompt,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Claude API error:", error);
        return { success: false, error: `API error: ${response.status}` };
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const textContent = data.content?.find((c) => c.type === "text");
      if (!textContent?.text) {
        return { success: false, error: "No response from Claude" };
      }

      // Extract JSON from response
      let jsonText = textContent.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
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
}

export const claudeProvider = new ClaudeProvider();
