// Prompt definitions for MCP
export const prompts = [
  {
    name: "edit_video",
    description: "Get guidance on editing a video with natural language instructions",
    arguments: [
      {
        name: "instruction",
        description: "Natural language description of the edit (e.g., 'trim the first 5 seconds')",
        required: true,
      },
      {
        name: "projectPath",
        description: "Path to the project file",
        required: false,
      },
    ],
  },
  {
    name: "create_montage",
    description: "Create a montage from multiple clips with automatic pacing",
    arguments: [
      {
        name: "clips",
        description: "Comma-separated list of clip IDs or media paths",
        required: true,
      },
      {
        name: "duration",
        description: "Target total duration in seconds",
        required: false,
      },
      {
        name: "style",
        description: "Montage style: fast, slow, rhythmic, dramatic",
        required: false,
      },
    ],
  },
  {
    name: "add_transitions",
    description: "Add transitions between clips in the timeline",
    arguments: [
      {
        name: "transitionType",
        description: "Transition type: fade, dissolve, wipe, cut",
        required: false,
      },
      {
        name: "duration",
        description: "Transition duration in seconds",
        required: false,
      },
    ],
  },
  {
    name: "color_grade",
    description: "Apply color grading to clips",
    arguments: [
      {
        name: "style",
        description: "Color grade style: cinematic, warm, cool, vintage, noir",
        required: true,
      },
      {
        name: "intensity",
        description: "Intensity of the effect (0-1)",
        required: false,
      },
    ],
  },
  {
    name: "generate_subtitles",
    description: "Generate subtitles from audio using AI transcription",
    arguments: [
      {
        name: "language",
        description: "Language code (e.g., en, ko, ja)",
        required: false,
      },
      {
        name: "format",
        description: "Output format: srt, vtt, json",
        required: false,
      },
    ],
  },
  {
    name: "create_shorts",
    description: "Create short-form content from a longer video",
    arguments: [
      {
        name: "targetDuration",
        description: "Target duration for each short (e.g., 60 for 60 seconds)",
        required: false,
      },
      {
        name: "aspectRatio",
        description: "Aspect ratio: 9:16, 1:1, 4:5",
        required: false,
      },
    ],
  },
  {
    name: "sync_to_music",
    description: "Sync video cuts to music beats",
    arguments: [
      {
        name: "audioPath",
        description: "Path to the audio/music file",
        required: true,
      },
      {
        name: "cutStyle",
        description: "Cut style: on-beat, off-beat, every-other",
        required: false,
      },
    ],
  },
];

/**
 * Get prompt content by name
 */
export function getPrompt(
  name: string,
  args: Record<string, string>
): { messages: Array<{ role: string; content: { type: string; text: string } }> } {
  switch (name) {
    case "edit_video":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help me edit a video with the following instruction: "${args.instruction}"

${args.projectPath ? `Project file: ${args.projectPath}` : "No project file specified."}

Please analyze the request and suggest the appropriate timeline tools to use. Consider:
1. What clips need to be affected?
2. What operations are needed (trim, split, move, add effects, etc.)?
3. What are the specific parameters?

Provide step-by-step guidance using the available MCP tools.`,
            },
          },
        ],
      };

    case "create_montage":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Help me create a ${args.style || "dynamic"} montage from these clips: ${args.clips}

${args.duration ? `Target duration: ${args.duration} seconds` : ""}

Please suggest:
1. The order of clips for best flow
2. Duration for each clip based on pacing
3. Transition types between clips
4. Any effects to enhance the montage

Use the available MCP tools to implement this.`,
            },
          },
        ],
      };

    case "add_transitions":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Add ${args.transitionType || "fade"} transitions between all clips in the timeline.

${args.duration ? `Transition duration: ${args.duration} seconds` : "Default duration: 0.5 seconds"}

Please:
1. First list all clips in the timeline
2. Identify clip boundaries
3. Add appropriate effects (fadeOut to ending clip, fadeIn to starting clip)
4. Ensure smooth visual flow`,
            },
          },
        ],
      };

    case "color_grade":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Apply "${args.style}" color grading to the video.

Intensity: ${args.intensity || "0.7"}

For this style, suggest and apply:
1. Brightness adjustments
2. Contrast settings
3. Saturation levels
4. Any special effects (grayscale for noir, sepia for vintage, etc.)

Use the timeline_add_effect tool to apply these to all clips.`,
            },
          },
        ],
      };

    case "generate_subtitles":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Generate subtitles from the video's audio track.

Language: ${args.language || "auto-detect"}
Format: ${args.format || "srt"}

Steps:
1. Extract audio from the video
2. Use Whisper transcription (vibe ai transcribe command)
3. Format output as ${args.format || "SRT"} subtitles
4. Optionally add as text overlay clips

Note: This requires the CLI transcribe command to be run separately.`,
            },
          },
        ],
      };

    case "create_shorts":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Create short-form content from this video for social media.

Target duration per short: ${args.targetDuration || 60} seconds
Aspect ratio: ${args.aspectRatio || "9:16"}

Please:
1. Analyze the timeline to find engaging segments
2. Identify natural cut points (scene changes, pauses)
3. Split the video into ${args.targetDuration || 60}-second segments
4. Suggest which segments would work best as standalone shorts
5. Note any reframing needed for vertical format`,
            },
          },
        ],
      };

    case "sync_to_music":
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Sync video cuts to music beats.

Audio file: ${args.audioPath}
Cut style: ${args.cutStyle || "on-beat"}

Steps:
1. Analyze the audio for beat detection (use vibe detect beats command)
2. Get beat timestamps
3. Split or trim clips to align with beats
4. Add transitions at beat points for ${args.cutStyle || "on-beat"} style

This creates a music video-style edit where cuts happen in rhythm with the music.`,
            },
          },
        ],
      };

    default:
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Unknown prompt: ${name}. Available prompts: edit_video, create_montage, add_transitions, color_grade, generate_subtitles, create_shorts, sync_to_music`,
            },
          },
        ],
      };
  }
}
