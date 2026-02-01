# Progress Log

Detailed changelog of development progress. Updated after each significant change.

---

## 2026-02-01

### Subtitle Format Output (SRT/VTT)
- Added subtitle format output to `vibe ai transcribe` command
- Supported formats:
  - **SRT** (SubRip Subtitle) - Standard subtitle format
  - **VTT** (WebVTT) - Web Video Text Tracks for HTML5 video
  - **JSON** - Raw transcript data with segments
- Format auto-detection from file extension (`.srt`, `.vtt`, `.json`)
- Explicit format option: `--format srt|vtt|json`
- Added 20 unit tests for subtitle utilities

**Files created:**
- `packages/cli/src/utils/subtitle.ts` - Subtitle formatting utilities
- `packages/cli/src/utils/subtitle.test.ts` - Unit tests

**Usage:**
```bash
# Transcribe and save as SRT
vibe ai transcribe audio.mp3 -o subtitles.srt

# Transcribe and save as VTT
vibe ai transcribe audio.mp3 -o subtitles.vtt

# Explicit format (overrides extension)
vibe ai transcribe audio.mp3 -o output.txt -f srt

# Korean language with VTT output
vibe ai transcribe interview.mp3 -l ko -o captions.vtt
```

---

### Scene Detection & Media Analysis
- Added `vibe detect` command for automatic media analysis
- Commands:
  - `vibe detect scenes <video>` - Detect scene changes using FFmpeg
  - `vibe detect silence <media>` - Detect silence periods in audio/video
  - `vibe detect beats <audio>` - Detect beats for music sync
- Scene detection can auto-add clips to project (`--project` option)
- Uses FFmpeg's scene detection and audio analysis filters
- No external API required - works offline

**Files created:**
- `packages/cli/src/commands/detect.ts`

**Usage:**
```bash
# Detect scenes in video
vibe detect scenes video.mp4 -t 0.3 -o scenes.json

# Add detected scenes as clips to project
vibe detect scenes video.mp4 --project project.vibe.json

# Detect silence periods
vibe detect silence audio.mp3 -n -30 -d 0.5

# Detect beats for music sync
vibe detect beats music.mp3 -o beats.json
```

---

### ElevenLabs Text-to-Speech
- Added `vibe ai tts` command for text-to-speech generation
- Added `vibe ai voices` command to list available voices
- Uses ElevenLabs API with multilingual v2 model
- Supports voice selection, custom output path
- Added ElevenLabsProvider with getVoices(), textToSpeech() methods

**Files created:**
- `packages/ai-providers/src/elevenlabs/ElevenLabsProvider.ts`
- `packages/ai-providers/src/elevenlabs/index.ts`

**Usage:**
```bash
# Generate speech
vibe ai tts "Hello, this is a test" -o narration.mp3

# Use specific voice
vibe ai tts "Welcome to VibeEdit" -v <voice-id> -o intro.mp3

# List available voices
vibe ai voices
```

---

### OpenAI GPT Natural Language Commands
- Added `vibe ai edit` command for natural language timeline control
- Uses GPT-4o-mini to parse instructions into executable commands
- Supported actions: trim, split, move, duplicate, add-effect, remove-clip, add-track
- Dry-run mode to preview without executing (`--dry-run`)
- Fallback to pattern matching when API unavailable

**Files created:**
- `packages/ai-providers/src/openai/OpenAIProvider.ts` - GPT provider
- `packages/ai-providers/src/openai/index.ts` - Export

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added TimelineCommand, CommandParseResult types
- `packages/cli/src/commands/ai.ts` - Added `edit` command

**Usage:**
```bash
# Natural language editing
vibe ai edit project.vibe.json "trim all clips to 5 seconds"
vibe ai edit project.vibe.json "add fade in effect"
vibe ai edit project.vibe.json "split the first clip at 3 seconds"
vibe ai edit project.vibe.json "delete all clips"

# Preview without executing
vibe ai edit project.vibe.json "add blur effect" --dry-run
```

---

### Gemini Auto-Edit Integration
- Implemented actual Gemini API integration for `vibe ai suggest`
- Sends clip data and user instruction to Gemini 1.5 Flash
- AI analyzes clips and returns smart edit suggestions
- Fallback to pattern matching when API fails
- Supported suggestion types: trim, cut, add-effect, reorder, delete, split, merge

**Files modified:**
- `packages/ai-providers/src/gemini/GeminiProvider.ts` - Added real API call

**Usage:**
```bash
# Get AI-powered edit suggestions
vibe ai suggest project.vibe.json "add fade in at the beginning"
vibe ai suggest project.vibe.json "trim all clips to 5 seconds"
vibe ai suggest project.vibe.json "make it more dynamic"

# Apply first suggestion automatically
vibe ai suggest project.vibe.json "add fadeOut" --apply
```

---

### API Key Management
- Added interactive API key prompt when not found in environment
- Loads `.env` file from project root automatically
- Prompts user to enter API key if not found
- Option to save API key to `.env` for future use
- Added `.env.example` template file
- Added 4 unit tests for API key utilities
- Total tests: 125 (75 unit + 50 integration)

**Files created:**
- `packages/cli/src/utils/api-key.ts` - API key loading and prompting
- `packages/cli/src/utils/api-key.test.ts` - Unit tests
- `.env.example` - Template for environment variables

**Usage:**
```bash
# Will prompt for API key if not found
vibe ai transcribe audio.mp3

# Output:
# OpenAI API key not found.
# Set OPENAI_API_KEY in .env or environment variables.
#
# Enter OpenAI API key: ********
# Save to .env for future use? (y/N): y
# API key saved to .env
```

---

### Batch Operations
- Added `vibe batch` command for processing multiple items at once
- Commands:
  - `vibe batch import <project> <directory>` - Import multiple media files from directory
    - Supports recursive search (-r), file extension filter (--filter)
  - `vibe batch concat <project> [source-ids...]` - Concatenate sources into sequential clips
    - Supports --all, --start, --gap, --track options
  - `vibe batch apply-effect <project> <effect-type> [clip-ids...]` - Apply effect to multiple clips
    - Supports --all, --duration, --intensity options
  - `vibe batch remove-clips <project> [clip-ids...]` - Remove multiple clips
    - Supports --all, --track options
  - `vibe batch info <project>` - Show project statistics
- Added 12 integration tests for batch commands
- Total tests: 101 (51 unit + 50 integration)

**Files created:**
- `packages/cli/src/commands/batch.ts`
- `packages/cli/src/commands/batch.test.ts`

**Usage:**
```bash
# Import all media from a directory
vibe batch import project.vibe.json ./media/

# Import recursively, only mp4 files
vibe batch import project.vibe.json ./media/ -r --filter ".mp4"

# Concatenate all sources into clips
vibe batch concat project.vibe.json --all

# Concatenate with 1s gap between clips
vibe batch concat project.vibe.json --all --gap 1

# Apply fadeIn to all clips
vibe batch apply-effect project.vibe.json fadeIn --all

# Remove all clips
vibe batch remove-clips project.vibe.json --all

# Show project statistics
vibe batch info project.vibe.json
```

---

### Timeline Operations
- Added advanced clip manipulation commands to CLI
- New Project methods: `splitClip()`, `duplicateClip()`
- Commands:
  - `vibe timeline split <project> <clip-id> -t <time>` - Split clip at given time
  - `vibe timeline duplicate <project> <clip-id> [-t <time>]` - Duplicate clip
  - `vibe timeline delete <project> <clip-id>` - Delete clip from timeline
  - `vibe timeline move <project> <clip-id> [-t <time>] [--track <id>]` - Move clip
- Added 8 unit tests for splitClip/duplicateClip
- Added 8 integration tests for new CLI commands
- Total tests: 89 (51 unit + 38 integration)

**Files modified:**
- `packages/cli/src/engine/project.ts` - Added splitClip, duplicateClip methods
- `packages/cli/src/commands/timeline.ts` - Added split, duplicate, delete, move commands
- `packages/cli/src/engine/project.test.ts` - Added splitClip/duplicateClip tests
- `packages/cli/src/commands/timeline.test.ts` - Added integration tests

**Usage:**
```bash
# Split a 10s clip at 4s mark -> creates two clips (4s + 6s)
vibe timeline split project.vibe.json <clip-id> -t 4

# Duplicate a clip (places after original by default)
vibe timeline duplicate project.vibe.json <clip-id>

# Duplicate at specific time
vibe timeline duplicate project.vibe.json <clip-id> -t 20

# Delete a clip
vibe timeline delete project.vibe.json <clip-id>

# Move clip to new time
vibe timeline move project.vibe.json <clip-id> -t 15

# Move clip to different track
vibe timeline move project.vibe.json <clip-id> --track <track-id>
```

---

### Export Command
- Added `vibe export` command for rendering projects to video
- Uses FFmpeg.wasm for in-process video encoding
- Features:
  - Quality presets: draft (360p), standard (720p), high (1080p), ultra (4K)
  - Format support: mp4, webm, mov
  - Automatic aspect ratio handling (16:9, 9:16, 1:1)
  - Clip trimming and concatenation
  - Progress indication during encoding

**Files created:**
- `packages/cli/src/commands/export.ts`

**Usage:**
```bash
vibe export project.vibe.json -o output.mp4 -p high
```

---

### Media Info Command
- Added `vibe media` command for media file analysis
- Uses `music-metadata` package for audio/video metadata parsing
- Commands:
  - `vibe media info <file>` - Shows file info, format, duration, bitrate, codec, tags
  - `vibe media duration <file>` - Returns duration in seconds (for scripting)

**Files created:**
- `packages/cli/src/commands/media.ts`

---

### CLI Integration Tests
- Added integration tests for CLI commands (project, timeline, ai)
- 30 additional test cases for CLI commands:
  - `project create/info/set` (8 tests)
  - `timeline add-source/add-clip/add-track/add-effect/trim/list` (18 tests)
  - `ai providers` (2 tests) + API key validation (2 tests)

**Files created:**
- `packages/cli/src/commands/project.test.ts`
- `packages/cli/src/commands/timeline.test.ts`
- `packages/cli/src/commands/ai.test.ts`

---

### CLI Unit Tests
- Added comprehensive unit tests for `Project` engine class
- 43 test cases covering:
  - Project initialization and settings
  - Media source CRUD operations
  - Track management
  - Clip operations (add, move, trim, remove)
  - Effect management
  - Transitions
  - JSON serialization/deserialization

**Files created:**
- `packages/cli/src/engine/project.test.ts`

**Run tests:**
```bash
pnpm --filter @vibe-edit/cli test
```

---

### CLI Package Implementation
- Created `packages/cli/` - headless command-line interface for video editing
- Implemented `Project` class in `packages/cli/src/engine/project.ts`
  - Pure TypeScript, no React/Zustand dependency
  - Full timeline manipulation (clips, tracks, effects, sources)
  - Serialization to `.vibe.json` project files

**Commands added:**
```
pnpm vibe project create/info/set
pnpm vibe timeline add-source/add-clip/add-track/add-effect/trim/list
pnpm vibe ai providers/transcribe/suggest
```

**Files created:**
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts` - CLI entry point
- `packages/cli/src/engine/project.ts` - Headless Project engine
- `packages/cli/src/commands/project.ts` - Project management commands
- `packages/cli/src/commands/timeline.ts` - Timeline editing commands
- `packages/cli/src/commands/ai.ts` - AI provider commands

**Related changes:**
- Fixed TypeScript strict mode errors in `packages/ai-providers/`
- Added `"type": "module"` to `packages/core/` and `packages/ai-providers/`
- Added `pnpm vibe` script to root `package.json`
- Updated `CLAUDE.md` with CLI documentation

---

## 2026-02-01 (Earlier)

### CLAUDE.md Creation
- Created initial `CLAUDE.md` for Claude Code guidance
- Documented development commands, architecture, type conventions
- Added Vibe terminology reference

---

## Initial Commit (Before Progress Tracking)

### Phase 1: Foundation (MVP) - Completed
- Turborepo monorepo setup with pnpm workspaces
- Next.js 14 app with App Router (`apps/web/`)
- Core timeline data structures (`packages/core/`)
  - Zustand store with Immer middleware
  - Types: Clip, Track, Effect, MediaSource, Transition
- Basic UI components (`packages/ui/`)
  - Radix UI primitives with Tailwind CSS
  - Button, Slider, Tooltip, Dialog, ContextMenu
- AI Provider plugin system (`packages/ai-providers/`)
  - AIProvider interface and registry
  - Whisper, Gemini, Runway, Kling providers (partial implementation)
- Web app components:
  - Drag-and-drop timeline editor
  - Canvas-based video preview with playback controls
  - Media library with upload zone
  - Chat panel for natural language commands
