# VibeFrame MCP Integration Guide

Complete guide for integrating VibeFrame with AI assistants via Model Context Protocol (MCP).

---

## Table of Contents

1. [Overview](#overview)
2. [Setup](#setup)
   - [Claude Desktop](#claude-desktop)
   - [Cursor](#cursor)
   - [Other MCP Clients](#other-mcp-clients)
3. [Core Concepts](#core-concepts)
4. [Workflow Examples](#workflow-examples)
5. [Tool Reference](#tool-reference)
6. [Resource Reference](#resource-reference)
7. [Prompt Reference](#prompt-reference)
8. [Advanced Usage](#advanced-usage)
9. [Troubleshooting](#troubleshooting)

---

## Overview

VibeFrame's MCP server enables AI assistants to control video editing through natural language:

```
User → AI Assistant → MCP Server → VibeFrame → Video Project
```

**What you can do:**
- Create and manage video projects
- Add/remove/edit clips on the timeline
- Apply effects and transitions
- Get project information and analytics
- Use guided prompts for complex workflows

**Requirements:**
- Node.js 18+
- VibeFrame installed and built
- An MCP-compatible AI assistant (Claude Desktop, Cursor, etc.)

---

## Setup

### Prerequisites

```bash
# Clone and build VibeFrame
git clone https://github.com/vericontext/vibeframe.git
cd vibeframe
pnpm install
pnpm build
```

### Claude Desktop

#### macOS

1. Open Claude Desktop config file:
   ```bash
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Add VibeFrame server:
   ```json
   {
     "mcpServers": {
       "vibeframe": {
         "command": "node",
         "args": ["/Users/YOUR_USERNAME/vibeframe/packages/mcp-server/dist/index.js"],
         "env": {
           "VIBE_PROJECT_PATH": "/Users/YOUR_USERNAME/videos/my-project.vibe.json"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

4. Verify: Look for VibeFrame tools in Claude's tool list

#### Windows

1. Open config file:
   ```
   %APPDATA%\Claude\claude_desktop_config.json
   ```

2. Add configuration (use forward slashes or escaped backslashes):
   ```json
   {
     "mcpServers": {
       "vibeframe": {
         "command": "node",
         "args": ["C:/Users/YOUR_USERNAME/vibeframe/packages/mcp-server/dist/index.js"],
         "env": {
           "VIBE_PROJECT_PATH": "C:/Users/YOUR_USERNAME/videos/my-project.vibe.json"
         }
       }
     }
   }
   ```

3. Restart Claude Desktop

#### Linux

1. Config file location:
   ```bash
   ~/.config/Claude/claude_desktop_config.json
   ```

2. Same configuration format as macOS

### Cursor

Add to `.cursor/mcp.json` in your workspace:

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

### Other MCP Clients

Any MCP-compatible client can use VibeFrame. The server communicates via stdio:

```bash
# Direct invocation
node /path/to/vibeframe/packages/mcp-server/dist/index.js

# Or with environment
VIBE_PROJECT_PATH=/path/to/project.vibe.json node /path/to/dist/index.js
```

---

## Core Concepts

### Project Files

VibeFrame uses `.vibe.json` files to store project state:

```json
{
  "version": "1.0.0",
  "meta": {
    "name": "My Video",
    "aspectRatio": "16:9",
    "frameRate": 30,
    "duration": 120
  },
  "sources": [
    {
      "id": "source-abc123",
      "name": "intro.mp4",
      "type": "video",
      "url": "/path/to/intro.mp4",
      "duration": 30
    }
  ],
  "tracks": [
    {
      "id": "video-1",
      "name": "Video 1",
      "type": "video",
      "order": 0
    }
  ],
  "clips": [
    {
      "id": "clip-xyz789",
      "sourceId": "source-abc123",
      "trackId": "video-1",
      "startTime": 0,
      "duration": 30,
      "effects": []
    }
  ]
}
```

### ID System

Every element has a unique ID:
- Sources: `source-{random}`
- Tracks: `{type}-{random}` (e.g., `video-abc123`)
- Clips: `clip-{random}`
- Effects: `effect-{random}`

### Time Units

All times are in **seconds** (floats allowed):
- `startTime: 5.5` = 5.5 seconds
- `duration: 10` = 10 seconds

### Media Types

- `video`: mp4, webm, mov, avi
- `audio`: mp3, wav, aac, ogg
- `image`: jpg, jpeg, png, gif, webp

---

## Workflow Examples

### Workflow 1: Create a Simple Video

**Goal:** Create a project, add one video, trim it, add effects.

```
You: Create a new video project called "Product Demo"

Claude: I'll create a new project for you.
[Uses project_create with name="Product Demo"]
Created project "Product Demo" at Product Demo.vibe.json

You: Add the product-video.mp4 file

Claude: [Uses timeline_add_source with mediaPath="product-video.mp4"]
Added source with ID: source-abc123

You: Place it on the timeline

Claude: [Uses timeline_add_clip with sourceId="source-abc123"]
Added clip with ID: clip-xyz789

You: Keep only the first 30 seconds

Claude: [Uses timeline_trim_clip with trimEnd=30]
Trimmed clip to 30 seconds

You: Add a fade-in at the start and fade-out at the end

Claude: [Uses timeline_add_effect with effectType="fadeIn", duration=1]
[Uses timeline_add_effect with effectType="fadeOut", startTime=29, duration=1]
Added fade effects to the clip
```

### Workflow 2: Multi-Clip Montage

**Goal:** Import multiple clips and arrange them.

```
You: I have three clips: intro.mp4, main.mp4, and outro.mp4. Create a montage.

Claude: I'll help you create a montage with those clips.

First, let me add all the sources:
[Uses timeline_add_source for each file]
Added sources: source-1, source-2, source-3

Now I'll add them to the timeline in sequence:
[Uses timeline_add_clip for intro at startTime=0]
[Uses timeline_add_clip for main at startTime=10]
[Uses timeline_add_clip for outro at startTime=70]

Your montage is ready with:
- intro.mp4 (0s-10s)
- main.mp4 (10s-70s)
- outro.mp4 (70s-80s)

Would you like me to add transitions between them?
```

### Workflow 3: Split and Rearrange

**Goal:** Split a clip and reorder segments.

```
You: Split the main clip at 30 seconds and move the second part to the beginning

Claude: Let me first see what clips we have:
[Uses timeline_list]

I see clip-xyz789 is your main clip (60 seconds long).

Splitting at 30 seconds:
[Uses timeline_split_clip with splitTime=30]
Created two clips:
- clip-xyz789 (0-30s)
- clip-new123 (30-60s)

Moving the second part to the beginning:
[Uses timeline_move_clip with clipId="clip-new123", newStartTime=0]
[Uses timeline_move_clip with clipId="clip-xyz789", newStartTime=30]

Done! The timeline now plays:
1. Second half (originally 30-60s)
2. First half (originally 0-30s)
```

### Workflow 4: Color Grading

**Goal:** Apply consistent color grading to all clips.

```
You: Apply a cinematic look to all clips

Claude: I'll apply cinematic color grading. First, let me see all clips:
[Uses timeline_list]

Found 5 clips. Applying effects to each:

For cinematic style, I'll add:
- Reduced brightness (0.9)
- Increased contrast (1.2)
- Slightly desaturated (0.85)

[Uses timeline_add_effect on each clip with brightness, contrast, saturation]

Applied cinematic grading to all 5 clips. The result will have:
- Darker shadows
- More contrast
- Slightly muted colors

Would you like me to adjust the intensity?
```

### Workflow 5: Short-Form Content

**Goal:** Extract a vertical short from a horizontal video.

```
You: Create a 60-second TikTok version from my 5-minute video

Claude: I'll help you create a TikTok version. Let me analyze your project:
[Uses timeline_list to see current clips]

Your video is 5 minutes (300 seconds). For TikTok:
- Duration: 60 seconds max
- Aspect: 9:16 (vertical)

I'll need to:
1. Identify the best 60-second segment
2. Create a new project with 9:16 aspect ratio

Let me create the TikTok version:
[Uses project_create with name="Video-TikTok", width=1080, height=1920]

For the best segment, I recommend using 1:00-2:00 based on where the action is.
[Uses timeline_add_source]
[Uses timeline_add_clip with duration=60]

Created TikTok version at Video-TikTok.vibe.json

To export:
vibe export Video-TikTok.vibe.json -o tiktok.mp4
```

---

## Tool Reference

### Project Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `project_create` | Create new project | name, width, height, fps |
| `project_info` | Get project details | projectPath |

### Timeline Operations

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `timeline_add_source` | Import media file | projectPath, mediaPath |
| `timeline_add_clip` | Add clip to timeline | projectPath, sourceId, startTime |
| `timeline_split_clip` | Split clip at time | projectPath, clipId, splitTime |
| `timeline_trim_clip` | Adjust clip bounds | projectPath, clipId, trimStart, trimEnd |
| `timeline_move_clip` | Reposition clip | projectPath, clipId, newStartTime |
| `timeline_delete_clip` | Remove clip | projectPath, clipId |
| `timeline_duplicate_clip` | Copy clip | projectPath, clipId |
| `timeline_list` | Show all contents | projectPath |

### Effects & Tracks

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `timeline_add_effect` | Apply effect | projectPath, clipId, effectType, intensity |
| `timeline_add_track` | Add track | projectPath, trackType, name |

---

## Resource Reference

Resources provide read-only data access:

| Resource URI | Returns |
|--------------|---------|
| `vibe://project/current` | Complete project JSON |
| `vibe://project/clips` | Array of clips with metadata |
| `vibe://project/sources` | Array of media sources |
| `vibe://project/tracks` | Array of tracks |
| `vibe://project/settings` | Project configuration |

**Usage:** Set `VIBE_PROJECT_PATH` environment variable to access resources.

---

## Prompt Reference

Prompts are guided workflows for complex operations:

| Prompt | Purpose | Key Arguments |
|--------|---------|---------------|
| `edit_video` | Natural language editing | instruction |
| `create_montage` | Multi-clip montage | clips, duration, style |
| `add_transitions` | Batch transitions | transitionType, duration |
| `color_grade` | Color grading | style, intensity |
| `generate_subtitles` | AI transcription | language, format |
| `create_shorts` | Short-form content | targetDuration, aspectRatio |
| `sync_to_music` | Beat-synced editing | audioPath, cutStyle |

---

## Advanced Usage

### Combining with CLI

MCP edits and CLI commands work on the same project files:

```bash
# Create project via Claude
# Then use CLI for heavy lifting:
vibe detect scenes my-project.vibe.json
vibe ai transcribe audio.mp3 -o subtitles.srt
vibe export my-project.vibe.json -o final.mp4
```

### Batch Operations

For operations on many clips, use CLI batch commands alongside MCP:

```bash
# Import entire directory
vibe batch import my-project.vibe.json ./footage/

# Apply effect to all
vibe batch apply-effect my-project.vibe.json fadeIn --all
```

### AI Pipelines

VibeFrame's AI pipelines work with MCP-created projects:

```bash
# After creating project via MCP:
vibe ai highlights my-project.vibe.json -d 60
vibe ai viral my-project.vibe.json -p tiktok,instagram-reels
```

### Custom Workflows

Create scripts that combine MCP and CLI:

```bash
#!/bin/bash
# auto-edit.sh

# Claude creates project via MCP, then:
vibe detect scenes $PROJECT
vibe ai edit $PROJECT "remove all scenes shorter than 2 seconds"
vibe batch apply-effect $PROJECT fadeIn --all
vibe export $PROJECT -o output.mp4
```

---

## Troubleshooting

### Common Issues

#### "Server not found"

1. Verify path in config is absolute
2. Check that `pnpm build` completed
3. Ensure `dist/index.js` exists
4. Restart AI assistant

#### "No project loaded"

Set `VIBE_PROJECT_PATH` in your MCP config, or use `project_create` first.

#### "Permission denied"

Ensure read/write access to:
- Project directory
- Media file locations
- Output paths

#### Tools not appearing

1. Check config JSON syntax
2. Verify server path exists
3. Look for errors in logs:
   - Claude: `~/Library/Logs/Claude/`
   - Cursor: Check Output panel

### Debugging

#### Test server directly

```bash
# Run server manually
node packages/mcp-server/dist/index.js

# Should output: "VibeFrame MCP Server started"
```

#### Use MCP Inspector

```bash
npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js
```

#### Check server logs

The MCP server logs to stderr. Enable verbose logging:

```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "DEBUG": "true"
      }
    }
  }
}
```

### Getting Help

- [GitHub Issues](https://github.com/vericontext/vibeframe/issues)
- [MCP Documentation](https://modelcontextprotocol.io)

---

## Next Steps

1. **Explore CLI commands** - Many features beyond MCP
2. **Try AI pipelines** - Script-to-Video, Highlights, Viral Optimizer
3. **Check AI providers** - 12 integrated providers (see [models.md](models.md))

See [README.md](../README.md) for full documentation.
