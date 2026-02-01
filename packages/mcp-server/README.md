# VibeEdit MCP Server

MCP (Model Context Protocol) server for VibeEdit, enabling AI assistants like Claude Desktop and Cursor to interact with video editing projects.

## Features

### Tools
- **Project Management**: Create and inspect projects
- **Timeline Editing**: Add/remove/split/trim/move clips
- **Effects**: Add visual effects to clips
- **Track Management**: Add video/audio tracks

### Resources
- `vibe://project/current` - Full project state
- `vibe://project/clips` - List of clips
- `vibe://project/sources` - Media sources
- `vibe://project/tracks` - Timeline tracks
- `vibe://project/settings` - Project configuration

### Prompts
- `edit_video` - Natural language video editing
- `create_montage` - Auto-paced montage creation
- `add_transitions` - Batch transition effects
- `color_grade` - Color grading presets
- `generate_subtitles` - AI transcription
- `create_shorts` - Short-form content generation
- `sync_to_music` - Beat-synced editing

## Installation

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "vibe-edit": {
      "command": "npx",
      "args": ["tsx", "/path/to/vibe-edit/packages/mcp-server/src/index.ts"],
      "env": {
        "VIBE_PROJECT_PATH": "/path/to/your/project.vibe.json"
      }
    }
  }
}
```

Or using pnpm:

```json
{
  "mcpServers": {
    "vibe-edit": {
      "command": "pnpm",
      "args": ["--filter", "@vibe-edit/mcp-server", "start:dev"],
      "cwd": "/path/to/vibe-edit",
      "env": {
        "VIBE_PROJECT_PATH": "/path/to/your/project.vibe.json"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "vibe-edit": {
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/packages/mcp-server/src/index.ts"]
    }
  }
}
```

## Usage Examples

### Creating a Project

```
Create a new VibeEdit project called "My Video" with 1080p resolution
```

### Adding Media

```
Add the video file "intro.mp4" to the project and place it on the timeline
```

### Editing

```
Split the first clip at 5 seconds and add a fade-in effect to the second part
```

### Complex Edits

```
Create a montage from all clips with fast pacing and fade transitions
```

## Environment Variables

- `VIBE_PROJECT_PATH`: Default project file path for resource access

## Development

```bash
# Start in development mode
pnpm --filter @vibe-edit/mcp-server start:dev

# Build for production
pnpm --filter @vibe-edit/mcp-server build
```
