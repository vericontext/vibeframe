# VibeFrame MCP Server

MCP (Model Context Protocol) server for VibeFrame, enabling AI assistants like **Claude Desktop** and **Cursor** to interact with video editing projects through natural language.

> "Create a video project, add my intro clip, trim it to 5 seconds, and add a fade-in effect"

```
Claude Desktop → MCP Server → VibeFrame Project (.vibe.json)
```

---

## Quick Start

### 1. Install VibeFrame

```bash
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install
pnpm build
```

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "node",
      "args": ["/path/to/vibeframe/packages/mcp-server/dist/index.js"],
      "env": {
        "VIBE_PROJECT_PATH": "/path/to/your/project.vibe.json"
      }
    }
  }
}
```

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 3. Restart Claude Desktop

The VibeFrame tools will now be available.

---

## Configuration Options

### Claude Desktop (Production)

Using built package:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "node",
      "args": ["/absolute/path/to/vibeframe/packages/mcp-server/dist/index.js"],
      "env": {
        "VIBE_PROJECT_PATH": "/path/to/project.vibe.json"
      }
    }
  }
}
```

### Claude Desktop (Development)

Using tsx for hot-reload:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibeframe/packages/mcp-server/src/index.ts"],
      "env": {
        "VIBE_PROJECT_PATH": "/path/to/project.vibe.json"
      }
    }
  }
}
```

### Cursor

Add to your workspace's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "node",
      "args": ["${workspaceFolder}/packages/mcp-server/dist/index.js"],
      "env": {
        "VIBE_PROJECT_PATH": "${workspaceFolder}/my-video.vibe.json"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VIBE_PROJECT_PATH` | Default project file for resource access | Optional |

---

## Tools Reference

### Project Management

#### `project_create`
Create a new VibeFrame project file.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Project name |
| `outputPath` | string | No | Output path (default: `{name}.vibe.json`) |
| `width` | number | No | Video width (default: 1920) |
| `height` | number | No | Video height (default: 1080) |
| `fps` | number | No | Frame rate (default: 30) |

**Example:**
```
Create a project called "My TikTok" with 1080x1920 resolution at 30fps
```

#### `project_info`
Get information about a project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to .vibe.json file |

---

### Timeline Operations

#### `timeline_add_source`
Add a media file to the project's source library.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `mediaPath` | string | Yes | Path to media file |
| `name` | string | No | Display name for source |

**Supported formats:**
- Video: mp4, webm, mov, avi
- Audio: mp3, wav, aac, ogg
- Image: jpg, png, gif, webp

#### `timeline_add_clip`
Add a clip to the timeline from an existing source.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `sourceId` | string | Yes | ID of the media source |
| `trackId` | string | No | Target track (default: first video track) |
| `startTime` | number | No | Position on timeline in seconds |
| `duration` | number | No | Clip duration (default: source duration) |

#### `timeline_split_clip`
Split a clip at a specific time.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | ID of clip to split |
| `splitTime` | number | Yes | Time relative to clip start (seconds) |

#### `timeline_trim_clip`
Trim a clip's start or end point.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | ID of clip to trim |
| `trimStart` | number | No | New source start offset |
| `trimEnd` | number | No | New duration |

#### `timeline_move_clip`
Move a clip to a new position or track.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | ID of clip to move |
| `newStartTime` | number | No | New timeline position |
| `newTrackId` | string | No | Target track ID |

#### `timeline_delete_clip`
Delete a clip from the timeline.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | ID of clip to delete |

#### `timeline_duplicate_clip`
Duplicate a clip.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | ID of clip to duplicate |
| `newStartTime` | number | No | Position for duplicate |

#### `timeline_list`
List all sources, tracks, and clips in a project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |

---

### Effects

#### `timeline_add_effect`
Add a visual effect to a clip.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `clipId` | string | Yes | Target clip ID |
| `effectType` | string | Yes | Effect type (see below) |
| `startTime` | number | No | Effect start (default: 0) |
| `duration` | number | No | Effect duration (default: 1s) |
| `intensity` | number | No | Intensity 0-1 (default: 1) |

**Available effects:**
- `fadeIn` - Fade in from black
- `fadeOut` - Fade out to black
- `blur` - Gaussian blur
- `brightness` - Adjust brightness
- `contrast` - Adjust contrast
- `saturation` - Adjust saturation
- `grayscale` - Convert to grayscale
- `sepia` - Sepia tone
- `invert` - Invert colors

---

### Tracks

#### `timeline_add_track`
Add a new track to the timeline.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | Yes | Path to project file |
| `trackType` | string | Yes | `video` or `audio` |
| `name` | string | No | Track display name |

---

## Resources Reference

Resources provide read-only access to project state. Access via `VIBE_PROJECT_PATH` environment variable.

| URI | Description |
|-----|-------------|
| `vibe://project/current` | Full project state (JSON) |
| `vibe://project/clips` | List of all clips with IDs, times, durations |
| `vibe://project/sources` | Media sources with metadata |
| `vibe://project/tracks` | Track list with types and visibility |
| `vibe://project/settings` | Project settings (resolution, fps, etc.) |

**Example response for `vibe://project/clips`:**
```json
[
  {
    "id": "clip-abc123",
    "sourceId": "source-xyz",
    "trackId": "video-1",
    "startTime": 0,
    "duration": 10.5,
    "sourceStartOffset": 0,
    "effects": []
  }
]
```

---

## Prompts Reference

Prompts provide guided workflows for common tasks.

### `edit_video`
Natural language video editing guidance.

```
Arguments:
  - instruction: "trim the first 5 seconds"
  - projectPath: "my-video.vibe.json" (optional)
```

### `create_montage`
Create a montage from multiple clips.

```
Arguments:
  - clips: "clip1.mp4,clip2.mp4,clip3.mp4"
  - duration: "60" (optional)
  - style: "fast" | "slow" | "rhythmic" | "dramatic" (optional)
```

### `add_transitions`
Add transitions between clips.

```
Arguments:
  - transitionType: "fade" | "dissolve" | "wipe" | "cut"
  - duration: "0.5" (optional)
```

### `color_grade`
Apply color grading presets.

```
Arguments:
  - style: "cinematic" | "warm" | "cool" | "vintage" | "noir"
  - intensity: "0.7" (optional)
```

### `generate_subtitles`
Generate subtitles from audio.

```
Arguments:
  - language: "en" | "ko" | "ja" (optional)
  - format: "srt" | "vtt" | "json" (optional)
```

### `create_shorts`
Create short-form content from longer video.

```
Arguments:
  - targetDuration: "60" (optional)
  - aspectRatio: "9:16" | "1:1" | "4:5" (optional)
```

### `sync_to_music`
Sync video cuts to music beats.

```
Arguments:
  - audioPath: "music.mp3"
  - cutStyle: "on-beat" | "off-beat" | "every-other" (optional)
```

---

## Usage Examples

### Basic Workflow

```
You: Create a new project called "Demo Video"

Claude: [Uses project_create tool]
Created project "Demo Video" at Demo Video.vibe.json

You: Add the intro.mp4 file to the project

Claude: [Uses timeline_add_source tool]
Added source: source-abc123

You: Add it to the timeline

Claude: [Uses timeline_add_clip tool]
Added clip: clip-xyz789

You: Trim it to the first 5 seconds

Claude: [Uses timeline_trim_clip tool]
Trimmed clip

You: Add a fade-in effect

Claude: [Uses timeline_add_effect with fadeIn]
Added effect: effect-123
```

### Complex Edit

```
You: I have a 2-minute video. Split it into 4 equal parts and add fade transitions between each part.

Claude: Let me help you with that.

1. First, I'll list the current clips to see what we're working with
   [Uses timeline_list]

2. The video is 120 seconds. I'll split at 30s, 60s, and 90s
   [Uses timeline_split_clip at 30]
   [Uses timeline_split_clip at 60]
   [Uses timeline_split_clip at 90]

3. Now I'll add fade effects between each segment
   [Uses timeline_add_effect fadeOut on clip 1]
   [Uses timeline_add_effect fadeIn on clip 2]
   ...
```

### Using Prompts

```
You: [Uses create_shorts prompt with targetDuration=60, aspectRatio=9:16]

Claude: I'll help you create short-form content from your video...
[Analyzes timeline, suggests segments, provides step-by-step guidance]
```

---

## Troubleshooting

### Server not connecting

1. Check the config file path is correct for your OS
2. Verify the path to the MCP server is absolute
3. Restart Claude Desktop after config changes
4. Check Claude Desktop logs: `~/Library/Logs/Claude/`

### "No project loaded" error

Set the `VIBE_PROJECT_PATH` environment variable in your config, or create a project first using `project_create`.

### Tools not appearing

1. Ensure `pnpm build` completed successfully
2. Check that `dist/index.js` exists in the mcp-server package
3. Verify JSON syntax in config file

### Permission errors

The server needs read/write access to:
- Project file location
- Media file locations
- Output directories

---

## Development

```bash
# Start in development mode (with hot reload)
pnpm --filter @vibeframe/mcp-server start:dev

# Build for production
pnpm --filter @vibeframe/mcp-server build

# Run from monorepo root
pnpm mcp
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js
```

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Desktop │────▶│  MCP Server      │────▶│  .vibe.json     │
│  / Cursor       │ MCP │  (VibeFrame)      │ I/O │  Project File   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  @vibeframe/cli  │
                        │  (Project class) │
                        └──────────────────┘
```

The MCP server exposes VibeFrame's CLI functionality through the Model Context Protocol, allowing AI assistants to manipulate video projects programmatically.

---

## Related Documentation

- [Full MCP Guide](../../docs/mcp.md) - Detailed setup and workflow documentation
- [CLI Reference](../cli/README.md) - Command-line interface
- [AI Providers](../ai-providers/README.md) - AI integration details
