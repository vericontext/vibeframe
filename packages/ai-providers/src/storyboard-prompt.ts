/**
 * @module storyboard-prompt
 *
 * Shared storyboard system prompt builder used by Claude, OpenAI, and Gemini
 * storyboard generation. Keeps the prompt in one place to avoid duplication.
 */

/**
 * Build the system prompt for storyboard generation.
 *
 * @param targetDuration - Target total video duration in seconds (optional)
 * @param creativity - Creativity level: "low" (default) or "high"
 * @returns The system prompt string for storyboard generation
 */
export function buildStoryboardSystemPrompt(
  targetDuration?: number,
  creativity?: "low" | "high"
): string {
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

  return `You are a video editor analyzing content to create a storyboard.
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
}

/** User message for storyboard generation */
export function buildStoryboardUserMessage(content: string): string {
  return `Analyze this content and create a video storyboard:\n\n${content}`;
}
