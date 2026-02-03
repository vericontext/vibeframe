# Progress Log

Detailed changelog of development progress. Updated after each significant change.

---

## 2026-02-03

### Docs: Reorganize cli-guide.md to Reduce Duplication
Reorganized the CLI guide documentation to eliminate redundant content and improve maintainability.

**Problem:** cli-guide.md had ~1006 lines with significant duplication:
- API keys listed 3 times (Quick Start, API table, Config section)
- "Supported REPL Patterns" section duplicated examples already in AI Commands Reference
- Core Concepts explained project concept multiple times with overlapping workflow examples
- Batch Operations section rarely used (can use `--help` instead)

**Solution:**
1. Consolidated all API key information into single Configuration section
2. Quick Start Step 2 now links to Configuration instead of duplicating
3. Removed "Supported REPL Patterns" section (lines 126-175) - duplicated AI Commands
4. Simplified Core Concepts - removed duplicate workflow examples
5. Removed Batch Operations section (available via `--help`)
6. Merged Project Management and Timeline into unified "Project & Timeline" section
7. Moved "Built-in REPL Commands" table to "Two Ways to Use VibeFrame" section
8. Fixed filename consistency in Quick Start REPL example (sunset-landscape.png used consistently)

**Files Modified:**
- `docs/cli-guide.md` - Reorganized and deduplicated

**Result:**
- Before: ~1006 lines
- After: ~882 lines (~12% reduction)
- Cleaner structure with single source of truth for API keys
- All commands still documented
- CLI/REPL examples preserved per user preference

---

### Fix: REPL "ai voices" and "ai video -i" Bugs
Fixed two REPL bugs where commands were misclassified or disabled.

**Bug 1: `ai voices` generates audio instead of listing voices**
- **Problem:** `ai voices` was classified as TTS because the TTS pattern regex matched "voice" in "voices"
- **Expected:** List available ElevenLabs voices
- **Actual:** Generated `hello.mp3` audio file

**Bug 2: `ai video -i image.png` doesn't work in REPL**
- **Problem:** Video case handler was intentionally disabled, redirected to CLI
- **Expected:** Generate video from image (image-to-video)
- **Actual:** Shows message "Video generation is available via CLI"

**Solution:**
1. Added `voices` type to CommandIntent interface
2. Added pattern check for "voices" command before TTS classification in `fallbackClassify()`
3. Added "voices" case handler that executes `npx vibe ai voices` via CLI
4. Updated LLM system prompt to recognize "voices" type with explicit examples
5. Replaced disabled video handler with working implementation that:
   - Extracts `imageFile` parameter for image-to-video generation
   - Builds and executes the appropriate `vibe ai video` CLI command

**Files Modified:**
- `packages/cli/src/repl/executor.ts` - Both bug fixes

**Verification:**
```bash
# Bug 1 fix:
pnpm vibe
> ai voices
# Expected: List of ElevenLabs voices
# Not: "Audio saved: hello.mp3"

# Bug 2 fix:
pnpm vibe
> create a video from sunset.png with ocean waves
# Expected: Video generation starts (or queued)
# Not: "Video generation is available via CLI"
```

---

### Fix: REPL TTS/SFX Filename Overwriting
Fixed issue where TTS and SFX commands always saved to the same filename, overwriting previous files.

**Problem:**
- `create audio saying "Welcome"` → `output.mp3`
- `generate voice message "Hello"` → `output.mp3` (overwrites!)
- `create sfx whoosh` → `sound-effect.mp3`
- `create sfx explosion` → `sound-effect.mp3` (overwrites!)

**Solution:**
Generate unique filenames from content (same pattern as image generation):
- TTS: First 4 words of text → `welcome-to-vibeframe.mp3`
- SFX: First 3 words of prompt + `-sfx` → `whoosh-sfx.mp3`

**Files Modified:**
- `packages/cli/src/repl/executor.ts` - TTS and SFX filename generation

**Verification:**
```
vibe> create audio saying "Welcome to VibeFrame"
✓ Audio saved: welcome-to-vibeframe.mp3

vibe> generate voice message "Hello world"
✓ Audio saved: hello-world.mp3
```

---

### Docs: Add Auto-Detection Commands to CLI Guide
Added missing documentation for `vibe detect` commands.

**Problem:**
- `detect scenes`, `detect silence`, `detect beats` commands existed but were not documented in cli-guide.md
- Commands were listed in roadmap.md as completed but users had no usage reference

**Solution:**
Added "Auto-Detection" section to cli-guide.md with:
- Scene detection examples (`-t` threshold, `-o` output, `-p` project)
- Silence detection examples (`-d` duration, `-n` noise threshold)
- Beat detection examples (`-o` output)
- Output format example
- Use cases

**Files Modified:**
- `docs/cli-guide.md` - Added Auto-Detection section after Export

**Verification:**
```bash
vibe detect scenes video.mp4
vibe detect silence audio.mp3
vibe detect beats music.mp3
```

---

### Docs: Fix trim Command Option
Fixed incorrect option in cli-guide.md timeline trim example.

**Problem:** Documentation showed `vibe timeline trim ... -d 5` but `-d` option doesn't exist.
**Solution:** Changed to `--duration 5` (the actual option).

**Files Modified:**
- `docs/cli-guide.md` - Line 748: `-d 5` → `--duration 5`

---

### Fix: CLI Version Hardcoding and Image Track Mismatch
Fixed two bugs discovered during cli-guide.md workflow testing.

**Problem 1: Version Hardcoding**
- `vibe --version` showed `0.1.0` instead of actual version `0.2.1`
- Version was hardcoded in `index.ts` instead of reading from package.json

**Problem 2: Image Track Mismatch**
- CLI `add-clip` command failed for images: "No image track found"
- CLI used `source.type` directly ("image"), but default tracks are "video" and "audio"
- REPL correctly mapped images → video track, but CLI didn't

**Solution:**
1. Version now reads from package.json using `createRequire`
2. `add-clip` now maps source types: `source.type === "audio" ? "audio" : "video"`

**Files Modified:**
- `packages/cli/src/index.ts` - Import package.json, use `pkg.version`
- `packages/cli/src/commands/timeline.ts` - Fix track type mapping for images

**Verification:**
```bash
# Version fix
pnpm vibe --version
# Expected: 0.2.1 (matches package.json)

# Image track fix
pnpm vibe project create test -o /tmp/test.vibe.json
pnpm vibe timeline add-source /tmp/test.vibe.json image.png
pnpm vibe timeline add-clip /tmp/test.vibe.json <source-id> -d 5
# Expected: Clip added to video-track-1 (no error)
```

---

### Docs: CLI Guide Inconsistencies and Documentation Guidelines
Fixed several documentation inconsistencies in cli-guide.md and added documentation guidelines to CLAUDE.md.

**Problems:**
1. Version mismatch: showed `0.1.0`, actual is `0.2.1`
2. Filename mismatch: generated `sunset.png` but added `a-sunset-landscape.png`
3. ID format: used simplified `source-1`, `clip-1` without explanation that real IDs are timestamp-based

**Solution:**
1. Updated version format to `0.2.x` to avoid frequent updates
2. Fixed filename consistency in REPL example workflow
3. Added note explaining ID format simplification
4. Added "Documentation Consistency Rules" section to CLAUDE.md with guidelines for:
   - Filename consistency in examples
   - Version number formatting
   - ID example annotations
   - Testing examples before documenting
   - Cross-referencing related docs

**Files Modified:**
- `docs/cli-guide.md` - Version, filename consistency, ID note
- `CLAUDE.md` - New Documentation Consistency Rules section

**Verification:**
```bash
# Check cli-guide.md REPL example - filenames should be consistent
grep -A 10 "generate an image of a sunset" docs/cli-guide.md
# Should show: sunset-landscape.png generated AND added (same filename)
```

---

### Fix: Empty Video Export for Images
Fixed issue where exporting a project with only images resulted in a 0-second empty video.

**Problem:**
- Workflow `new project → add image.png → export` resulted in empty 0-second video
- Root causes:
  1. Hardcoded `duration: 10` for all media instead of detecting actual duration
  2. FFmpeg `trim` filter doesn't work for static images without `-loop 1` flag

**Solution:**
1. Added `getMediaDuration()` utility function using ffprobe to detect actual media duration
   - Images return a default 5-second duration (configurable)
   - Video/audio files get actual duration via ffprobe
2. Updated executor.ts to use `getMediaDuration()` instead of hardcoded duration
3. Fixed FFmpeg handling for images in `buildFFmpegArgs()`:
   - Added `-loop 1` flag before image inputs to create continuous video stream
   - Images use `trim=start=0:end=duration` (no source offset since looped)
   - Audio filter only applied to video/audio sources, not images

**Files Modified:**
- `packages/cli/src/commands/export.ts`:
  - Added `getMediaDuration()` exported function
  - Modified `buildFFmpegArgs()` to add `-loop 1` before image inputs
  - Modified video filter to use different trim logic for images vs video
- `packages/cli/src/repl/executor.ts`:
  - Import `getMediaDuration` from export.ts
  - Replace hardcoded `duration: 10` at lines 613 and 797 with actual duration detection

**FFmpeg Command Comparison:**
```bash
# Before (broken for images):
ffmpeg -i image.png -filter_complex "[0:v]trim=start=0:end=10,..." output.mp4

# After (works for images):
ffmpeg -loop 1 -i image.png -filter_complex "[0:v]trim=start=0:end=5,..." output.mp4
```

**Verification:**
```bash
vibe
> new test
> add /path/to/image.png to the project
> info   # Should show 5s duration
> export the video
# Output video should be 5 seconds with the image displayed
```

---

### Fix: "export the video" Natural Language Routing
Fixed "export the video" being incorrectly routed to timeline command instead of export handler.

**Problem:**
- `vibe [my-video]> export the video` → "Unknown action: export"
- The builtin export pattern `/^export(?:\s+[\w./-]+)?$/i` only matched simple filenames (no spaces)
- "export the video" triggered natural language routing, but LLM classified it as "timeline"
- Timeline handler had no "export" action, causing the error

**Solution:**
- Added "export" type to `CommandIntent` interface
- Updated LLM system prompt with export classification (type 8)
- Added fallback patterns for export commands:
  - `export/render/output the video/project/mp4`
  - `save/export as/to mp4/video`
  - `export/render to output.mp4`
- Extracted `runExport()` function for programmatic usage
- Added export case in `executeNaturalLanguageCommand()`

**Now works:**
```
vibe [my-video]> export the video       ✓ → export handler
vibe [my-video]> render the project     ✓ → export handler
vibe [my-video]> save as mp4            ✓ → export handler
vibe [my-video]> export to output.mp4   ✓ → export handler (with filename)

# Still works as builtin:
vibe [my-video]> export output.mp4      ✓ → builtin export
```

**Files Modified:**
- `packages/cli/src/repl/executor.ts`:
  - Added "export" to `CommandIntent` type union
  - Updated `classifyCommand()` system prompt with export examples
  - Added export patterns to `fallbackClassify()`
  - Added export case in `executeNaturalLanguageCommand()`
  - Added `runExport` import
- `packages/cli/src/commands/export.ts`:
  - Added `ExportResult` and `ExportOptions` interfaces
  - Extracted `runExport()` function for reuse
  - Renamed internal `runFFmpeg` to `runFFmpegProcess`

---

### Fix: Comprehensive Natural Language Routing for REPL
Fixed greedy builtin command detection that was incorrectly routing natural language commands.

**Problem:**
- Most natural language commands were being incorrectly routed to builtin handlers
- "add fade-in effect to the clip" → treated as builtin "add" → "File not found: fade-in effect to the clip"
- "new intro animation" → treated as builtin "new" → "Created project: intro animation"
- The `isBuiltinCommand()` function was too greedy - checking if first word was a builtin name

**Solution:**
- Inverted routing logic: check for natural language hints FIRST
- Added comprehensive natural language keyword detection:
  - Timeline operations: fade, effect, transition, trim, split, cut, crop, blur, filter, etc.
  - Phrases: "to the clip", "to the timeline", "please", "can you", etc.
  - Creative commands: "generate an image of", "create audio saying", etc.
  - Descriptive words: intro, outro, animation, banner, thumbnail, etc.
- Defined strict regex patterns for builtin commands (only exact forms match)
- Enhanced LLM classification prompt with better timeline examples

**Now works:**
```
vibe> add fade-in effect to the clip    ✓ → timeline (was: builtin add)
vibe> add blur effect                    ✓ → timeline (was: builtin add)
vibe> new intro animation project        ✓ → project via LLM (was: builtin new)
vibe> create a sunset image              ✓ → image
vibe> add sunset.png to the project      ✓ → add-media

# Still works as builtins:
vibe> add sunset.png                     ✓ → builtin add
vibe> new my-video                       ✓ → builtin new
vibe> exit                               ✓ → builtin exit
```

**Files Modified:**
- `packages/cli/src/repl/executor.ts`:
  - Rewrote `isBuiltinCommand()` with inverted logic (NL-first approach)
  - Added `simpleBuiltins` regex map for exact builtin command patterns
  - Enhanced `classifyCommand()` LLM prompt with timeline examples
  - Improved `fallbackClassify()` with timeline pattern detection first

---

### Feature: LLM-Unified Natural Language Command Routing
Replaced regex-based command matching with LLM-powered intent classification for all natural language commands.

**Problem:**
- Previously, AI generation commands (image, tts, sfx) used rigid regex patterns
- "create a welcome audio message" failed because "welcome" wasn't in the expected position
- Users expected LLM to understand natural language like advertised

**Solution:**
- Added `classifyCommand()` function that uses configured LLM to understand intent
- Supports all providers: OpenAI, Claude, Gemini, Ollama
- Routes to appropriate handler based on classified intent:
  - `image` → generateImage()
  - `tts` → generateTTS()
  - `sfx` → generateSFX()
  - `video` → CLI suggestion
  - `project` → create project
  - `add-media` → add file to project timeline
  - `timeline` → existing parseCommand flow
- Includes fallback pattern matching when LLM fails
- Smart builtin detection: "add X to the project" → LLM, "add X" → builtin

**Now works:**
```
vibe> create a welcome audio message          ✓
vibe> make me a banner image for my channel   ✓
vibe> generate speech saying hello world      ✓
vibe> new project called demo                 ✓
vibe> add sunset.png to the project           ✓
vibe> include intro.mp4 in timeline           ✓
```

**Files Modified:**
- `packages/cli/src/repl/executor.ts` - Complete rewrite of natural language handling:
  - Added `CommandIntent` interface with `add-media` type
  - Added `classifyCommand()` using LLM API
  - Added `fallbackClassify()` for offline mode
  - Updated `isBuiltinCommand()` to detect natural language phrases
  - Rewrote `executeNaturalLanguageCommand()` to use intent-based routing
  - Added `add-media` handler for natural language file adding

---

### Fix: REPL Exits After AI Generation Commands
Fixed the REPL exiting immediately after completing AI generation commands (image, tts, sfx).

**Problem:**
- After running commands like "generate an image of a sunset", the image would be created successfully
- The REPL prompt would briefly appear but then exit to the shell
- The `ora` spinner was interfering with readline by discarding stdin

**Solution:**
- Added `discardStdin: false` option to all `ora` spinner configurations in the executor
- This prevents the spinner from interfering with readline's stdin handling

**Verification:**
```bash
pnpm build
vibe
vibe> create a welcome audio message
# LLM understands and generates TTS
vibe> generate an image of a sunset
# Image generates, REPL stays open
vibe> exit
```

---

### Feature: Complete Skill Scripts Coverage
Added 15 new Python helper scripts to match all CLI capabilities.

**Stability AI Scripts (5 new):**
- `upscale.py` - Fast and creative upscaling modes
- `remove-bg.py` - Background removal
- `img2img.py` - Image-to-image transformation
- `replace.py` - Search and replace objects
- `outpaint.py` - Extend image boundaries

**ElevenLabs Scripts (3 new):**
- `voices.py` - List and filter available voices
- `voice-clone.py` - Clone voice from audio samples
- `isolate.py` - Separate vocals from background audio

**Kling Video Scripts (2 new):**
- `extend.py` - Extend existing videos
- `status.py` - Check task status

**Replicate AI Scripts (4 new):**
- `video-upscale.py` - Video upscaling with Real-ESRGAN
- `interpolate.py` - Frame interpolation with RIFE
- `demucs.py` - Audio stem separation
- `style-transfer.py` - Neural style transfer

**OpenAI Scripts (1 new):**
- `edit.py` - DALL-E 2 image inpainting/editing

**SKILL.md Updates:**
- Updated all skill documentation to reference new scripts
- Added usage examples for each new script

**Files Created:**
- `.claude/skills/stability-image/scripts/upscale.py`
- `.claude/skills/stability-image/scripts/remove-bg.py`
- `.claude/skills/stability-image/scripts/img2img.py`
- `.claude/skills/stability-image/scripts/replace.py`
- `.claude/skills/stability-image/scripts/outpaint.py`
- `.claude/skills/elevenlabs-tts/scripts/voices.py`
- `.claude/skills/elevenlabs-tts/scripts/voice-clone.py`
- `.claude/skills/elevenlabs-tts/scripts/isolate.py`
- `.claude/skills/kling-video/scripts/extend.py`
- `.claude/skills/kling-video/scripts/status.py`
- `.claude/skills/replicate-ai/scripts/video-upscale.py`
- `.claude/skills/replicate-ai/scripts/interpolate.py`
- `.claude/skills/replicate-ai/scripts/demucs.py`
- `.claude/skills/replicate-ai/scripts/style-transfer.py`
- `.claude/skills/openai-api/scripts/edit.py`

**Files Modified:**
- `.claude/skills/stability-image/SKILL.md`
- `.claude/skills/elevenlabs-tts/SKILL.md`
- `.claude/skills/kling-video/SKILL.md`
- `.claude/skills/replicate-ai/SKILL.md`
- `.claude/skills/openai-api/SKILL.md`

---

### Feature: Gemini Video Understanding
Added video analysis capabilities using Google Gemini's multimodal API.

**New Skill Created:**
- `.claude/skills/gemini-video/SKILL.md` - Full documentation for video understanding
- `.claude/skills/gemini-video/scripts/analyze.py` - Python helper script

**GeminiProvider Enhancements:**
- Added `analyzeVideo()` method for video analysis
- Supports inline data and YouTube URL input
- Video metadata options: fps, start/end offset, low resolution mode

**New CLI Command:**
```bash
# Analyze local video
vibe ai gemini-video video.mp4 "Summarize this video"

# Analyze YouTube video
vibe ai gemini-video "https://youtube.com/watch?v=ID" "What are the key points?"

# With options
vibe ai gemini-video video.mp4 "Describe action" --fps 5 --start 60 --end 180 -v
```

**Features:**
- Video summarization, Q&A, timestamp analysis
- YouTube URL direct processing (no upload needed)
- Custom FPS sampling (higher for action, lower for static)
- Video clipping (start/end offset)
- Low resolution mode for longer videos (fewer tokens)
- Token usage reporting with `-v` flag

**Files Created:**
- `.claude/skills/gemini-video/SKILL.md`
- `.claude/skills/gemini-video/scripts/analyze.py`

**Files Modified:**
- `packages/ai-providers/src/gemini/GeminiProvider.ts` (+176 lines)
- `packages/cli/src/commands/ai.ts` (+89 lines)

---

### Feature: Gemini Nano Banana Pro Support and Image Editing
Enhanced Gemini image generation with Pro model support and added image editing capabilities.

**SKILL.md Updates:**
- Added `gemini-3-pro-image-preview` (Nano Banana Pro) model documentation
- 2K/4K resolution support (Pro model only)
- Google Search grounding for real-time information
- Thinking mode documentation
- Multi-image composition (up to 14 reference images)
- Complete aspect ratio tables and prompting best practices

**New Scripts:**
- `edit.py` - Image editing with text prompts (style transfer, object modification, composition)

**GeminiProvider Enhancements:**
- Model selection: flash (fast) vs pro (professional)
- Resolution support: 1K, 2K, 4K (Pro only)
- Added `editImage()` method for image-to-image editing
- Google Search grounding option

**New CLI Commands:**
```bash
# Generate with Pro model and 2K resolution
vibe ai gemini "product photo" -o product.png -m pro -s 2K

# Image editing
vibe ai gemini-edit input.png "convert to watercolor style" -o output.png

# Multi-image composition (Pro)
vibe ai gemini-edit person1.png person2.png "group photo in office" -o group.png -m pro
```

**Files Created:**
- `.claude/skills/gemini-image/scripts/edit.py`

**Files Modified:**
- `.claude/skills/gemini-image/SKILL.md` (complete rewrite)
- `.claude/skills/gemini-image/scripts/generate.py` (Pro model, resolution, grounding)
- `packages/ai-providers/src/gemini/GeminiProvider.ts` (+231 lines)
- `packages/cli/src/commands/ai.ts` (+116 lines)

---

### Fix: Stability AI Image-to-Image Endpoint
Fixed `sd-img2img` command returning 404 error.

**Problem:**
- `sd-img2img` used endpoint `/v2beta/stable-image/generate/sd3.5-large`
- SD3.5 models don't support `mode=image-to-image` parameter

**Solution:**
- Changed endpoint to `/v2beta/stable-image/generate/sd3` which supports image-to-image mode

**Files Modified:**
- `packages/ai-providers/src/stability/StabilityProvider.ts` (line 366)

**Verification:**
```bash
vibe ai sd-img2img input.png "watercolor style" -o output.png  # Now works
```

---

### Test: Stability AI and Gemini Skills/CLI Verification
Comprehensive testing of Stability and Gemini integrations.

**Stability AI Tests (All Passed):**

| Command | Status |
|---------|--------|
| `generate.py` (skill) | ✅ |
| `vibe ai image -p stability` | ✅ |
| `vibe ai sd` | ✅ |
| `vibe ai sd-upscale` | ✅ |
| `vibe ai sd-remove-bg` | ✅ |
| `vibe ai sd-img2img` | ✅ (fixed) |
| `vibe ai sd-replace` | ✅ |
| `vibe ai sd-outpaint` | ✅ |

**Gemini Tests (All Passed):**

| Command | Status |
|---------|--------|
| `generate.py` (skill) | ✅ |
| `edit.py` (skill) | ✅ |
| `vibe ai image -p gemini` | ✅ |
| `vibe ai gemini` | ✅ |
| `vibe ai gemini-edit` | ✅ |
| `vibe ai gemini-video` | ✅ |

---

### Feature: Skills → CLI Integration Verification & "Wow" Demo Preparation
Verified all 9 Claude Code Skills are properly integrated with CLI commands and created a multi-provider demo script.

**Integration Status:**

| Skill | CLI Commands | Status |
|-------|-------------|--------|
| openai-api | `image -p dalle`, `transcribe`, `edit` | ✅ |
| claude-api | `motion`, `storyboard`, `parse`, `edit`, `suggest` | ✅ |
| gemini-image | `image -p gemini` | ✅ |
| elevenlabs-tts | `tts`, `sfx`, `voices`, `isolate`, `voice-clone` | ✅ |
| stability-image | `sd`, `sd-upscale`, `sd-remove-bg`, `sd-img2img`, `sd-replace`, `sd-outpaint` | ✅ |
| replicate-ai | `music`, `video-upscale`, `video-interpolate`, `style-transfer`, `track-object` | ✅ |
| runway-video | `image -p runway`, `video -p runway` | ✅ |
| kling-video | `video -p kling`, `kling`, `video-extend` | ✅ |
| remotion-motion | `motion` (via Claude) | ✅ |

**Files Created:**
- `scripts/demo-providers.sh` - Multi-provider demo script showcasing all 9 skills

**Demo Script Features:**
- Showcases all 9 AI provider integrations
- Generates images with DALL-E, Gemini, Stability AI, and Runway
- Creates voiceover and sound effects with ElevenLabs
- Generates background music with Replicate MusicGen
- Creates video with Kling AI
- Generates storyboard with Claude

**Usage:**
```bash
# Run full multi-provider demo
chmod +x scripts/demo-providers.sh
./scripts/demo-providers.sh

# Quick verification
vibe ai providers                              # List all providers
vibe ai image "test" -o /tmp/test.png -p dalle # Test DALL-E
vibe ai tts "test" -o /tmp/test.mp3            # Test ElevenLabs

# "Wow" Demo - Script-to-Video Pipeline
vibe ai script-to-video \
  "Introducing VibeFrame. The first video editor you can talk to." \
  -o wow-demo/demo.vibe.json \
  --output-dir wow-demo/assets \
  --images-only -d 30
```

**Registered Providers (10 total):**
1. OpenAI Whisper - Speech-to-text
2. Google Gemini - Video/image generation, auto-edit
3. OpenAI GPT - Natural language commands
4. Anthropic Claude - Motion graphics, storyboarding, analysis
5. ElevenLabs - TTS, SFX, voice cloning
6. OpenAI DALL-E - Image generation
7. Runway Gen-3 - Video generation
8. Kling AI - Video generation
9. Stability AI - Image generation/editing
10. Replicate - Video processing, music generation

---

## 2026-02-02

### Fix: Skills and CLI Integration Testing & Bug Fixes
Performed comprehensive integration testing of Claude Code skills and CLI commands. Fixed bugs discovered during testing.

**Tests Performed:**

| Category | Item | Status | Notes |
|----------|------|--------|-------|
| OpenAI API | chat.py | ✅ Pass | "Say hello" → "Hello!" |
| OpenAI API | dalle.py | ✅ Pass | Generated 403KB image |
| OpenAI API | whisper.py | ✅ Pass | Transcribed TTS audio correctly |
| OpenAI API | tts.py | ✅ Pass | 19KB MP3 output |
| Claude API | chat.py | ✅ Pass | "Say hello" → "Hello!" |
| Claude API | parse.py | ✅ Pass | Fixed JSON array parsing |
| Claude API | motion.py | ✅ Pass | Generated Remotion TSX |
| Claude API | storyboard.py | ✅ Pass | Fixed markdown stripping |
| Gemini Image | generate.py | ✅ Pass | 326KB PNG (1024x1024) - initial failure was transient |
| ElevenLabs | tts.py | ✅ Pass | 25KB MP3 output |
| ElevenLabs | sfx.py | ✅ Pass | 33KB MP3 output |
| CLI | vibe ai image | ✅ Pass | DALL-E generated 1MB image |
| CLI | vibe ai tts | ✅ Pass | ElevenLabs TTS working |
| CLI | vibe ai sfx | ✅ Pass | ElevenLabs SFX working |
| CLI | vibe ai transcribe | ✅ Pass | SRT output correct |
| CLI | project create/info | ✅ Pass | Project CRUD working |
| Stability Image | generate.py | ✅ Pass | 672KB PNG - fixed API endpoint |
| Replicate AI | music.py | ✅ Pass | 60KB MP3 (5s) - fixed model version |
| Replicate AI | upscale.py | ✅ --help | Requires input image |
| Runway Video | generate.py | ✅ Pass | 818KB MP4 (gen4_turbo + SDK) |
| Kling Video | generate.py | ✅ Pass | 12.5MB MP4 (5.1s, pro mode) |

**Bugs Fixed:**

1. **parse.py - Multiple Commands JSON Parsing**
   - Problem: When parsing commands like "trim first 10s and add fade in", Claude returned multiple JSON objects which caused `json.loads()` to fail with "Extra data" error
   - Solution: Updated system prompt to always return JSON array, even for single commands
   - File: `.claude/skills/claude-api/scripts/parse.py`

2. **storyboard.py - Markdown Code Block in Response**
   - Problem: Claude sometimes wrapped JSON in ```json code blocks, causing parse failure
   - Solution: Added code to strip markdown code blocks before JSON parsing
   - File: `.claude/skills/claude-api/scripts/storyboard.py`

3. **stability generate.py - API Endpoint Changed**
   - Problem: Stability AI changed API from `/generate/sd3.5-large` to `/generate/sd3` with model parameter
   - Solution: Updated MODELS dict to use (endpoint, model_param) tuples, added model field to form data
   - File: `.claude/skills/stability-image/scripts/generate.py`

4. **replicate music.py - Model Version Outdated**
   - Problem: MusicGen model version hash was outdated (422 error)
   - Solution: Updated MODEL_VERSION to `671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb`
   - File: `.claude/skills/replicate-ai/scripts/music.py`

5. **runway generate.py - API Migration to SDK**
   - Problem: Old REST API with gen3a_turbo model deprecated
   - Solution: Rewrote using official `runwayml` SDK with gen4_turbo model
   - Note: gen4_turbo requires input image (image-to-video only)
   - File: `.claude/skills/runway-video/scripts/generate.py`

**API Key Status:**
- ✅ OPENAI_API_KEY - Working (chat, dalle, whisper, tts)
- ✅ ANTHROPIC_API_KEY - Working (chat, parse, motion, storyboard)
- ✅ GOOGLE_API_KEY - Working (text, image generation)
- ✅ ELEVENLABS_API_KEY - Working (tts, sfx)
- ✅ STABILITY_API_KEY - Working (image generation)
- ✅ REPLICATE_API_TOKEN - Working (music generation)
- ✅ RUNWAY_API_SECRET - Working (gen4_turbo image-to-video)
- ✅ KLING_API_KEY - Working (kling-v1-5 pro mode)

**Files Modified:**
- `.claude/skills/claude-api/scripts/parse.py` - JSON array output format
- `.claude/skills/claude-api/scripts/storyboard.py` - Markdown code block stripping
- `.claude/skills/stability-image/scripts/generate.py` - Fixed API endpoint and added User-Agent
- `.claude/skills/replicate-ai/scripts/music.py` - Updated MusicGen model version
- `.claude/skills/runway-video/scripts/generate.py` - Rewrote with runwayml SDK (gen4_turbo)

**Verification Commands:**
```bash
# Test skills
python .claude/skills/openai-api/scripts/chat.py "Hello"
python .claude/skills/claude-api/scripts/parse.py "trim 10s and add fade"
python .claude/skills/claude-api/scripts/storyboard.py "product demo" -d 30 -o /tmp/test.json
python .claude/skills/gemini-image/scripts/generate.py "red circle" -o /tmp/gemini.png
python .claude/skills/stability-image/scripts/generate.py "blue square" -o /tmp/stability.png
python .claude/skills/replicate-ai/scripts/music.py "jingle" -o /tmp/music.mp3 -d 5

# Test CLI
pnpm vibe ai image "test" -o /tmp/test.png
pnpm vibe ai tts "Hello" -o /tmp/test.mp3
pnpm vibe ai transcribe /tmp/test.mp3 -o /tmp/test.srt
```

---

### Feature: Claude Code Skills for AI Provider APIs
Created 9 Claude Code skills for development-time API reference and helper scripts. These skills enable Claude Code to access vendor API documentation and use helper scripts during VibeFrame CLI development.

**Skills Created:**

| Skill | Description | Scripts |
|-------|-------------|---------|
| `openai-api` | GPT chat, DALL-E, Whisper, TTS | chat.py, dalle.py, whisper.py, tts.py |
| `claude-api` | Claude chat, command parsing, motion graphics, storyboarding | chat.py, parse.py, motion.py, storyboard.py |
| `remotion-motion` | Remotion component generation and rendering | generate.py, render.py |
| `replicate-ai` | Video upscaling, music gen, background removal | predict.py, upscale.py, music.py, rembg.py |
| `gemini-image` | Gemini Nano Banana image generation | generate.py |
| `elevenlabs-tts` | Text-to-speech, sound effects | tts.py, sfx.py |
| `runway-video` | Runway Gen-3 video generation | generate.py |
| `stability-image` | Stability AI image generation/editing | generate.py |
| `kling-video` | Kling AI video generation with JWT auth | generate.py |

**Each Skill Includes:**
- `SKILL.md` - API documentation with cURL examples, parameters, response formats
- `scripts/*.py` - Python helper scripts with CLI interface for quick API calls

**Files Created:**
- `.claude/skills/openai-api/SKILL.md` + 4 scripts
- `.claude/skills/claude-api/SKILL.md` + 4 scripts
- `.claude/skills/remotion-motion/SKILL.md` + 2 scripts
- `.claude/skills/replicate-ai/SKILL.md` + 4 scripts
- `.claude/skills/gemini-image/SKILL.md` + 1 script
- `.claude/skills/elevenlabs-tts/SKILL.md` + 2 scripts
- `.claude/skills/runway-video/SKILL.md` + 1 script
- `.claude/skills/stability-image/SKILL.md` + 1 script
- `.claude/skills/kling-video/SKILL.md` + 1 script

**Usage (during development with Claude Code):**
```bash
# Example: Use skills to quickly test APIs
python .claude/skills/openai-api/scripts/chat.py "Parse: trim 5 seconds"
python .claude/skills/claude-api/scripts/motion.py "animated subscribe button" -o Sub.tsx
python .claude/skills/replicate-ai/scripts/music.py "upbeat intro" -o music.mp3 -d 10
python .claude/skills/gemini-image/scripts/generate.py "thumbnail for coding video" -o thumb.png
```

---

### Feature: Unified AI Provider Selection for CLI Commands
Added `--provider` option to video and image generation commands, enabling users to choose between different AI providers for each task.

**Video Generation (`vibe ai video`)**
- Added `--provider` / `-p` option: `runway` (default), `kling`
- Unified Runway and Kling video generation under one command
- Supports text-to-video and image-to-video modes
- Added Kling-specific options: `--mode`, `--negative`, `--ratio 1:1`

**Image Generation (`vibe ai image`)**
- Added `--provider` / `-p` option: `dalle` (default), `gemini`, `stability`
- Added Gemini Imagen 3 support with high-quality image generation
- Added `--ratio` option for Gemini aspect ratios (1:1, 16:9, 9:16, 3:4, 4:3)

**GeminiProvider Enhancements**
- Added `generateImage()` method using Imagen 3 API
- Returns base64-encoded images
- Added "text-to-image" to AICapability type

**Files Modified:**
- `packages/cli/src/commands/ai.ts` - Updated video and image commands
- `packages/ai-providers/src/gemini/GeminiProvider.ts` - Added image generation
- `packages/ai-providers/src/interface/types.ts` - Added text-to-image capability
- `docs/cli-guide.md` - Updated command examples and provider table

**Usage:**
```bash
# Video generation with provider selection
vibe ai video "sunset timelapse" -o sunset.mp4               # Runway (default)
vibe ai video "sunset timelapse" -o sunset.mp4 -p kling      # Kling AI
vibe ai video "sunset" -i photo.jpg -o animated.mp4 -p kling # Image-to-video

# Image generation with provider selection
vibe ai image "mountain landscape" -o mountain.png           # DALL-E (default)
vibe ai image "mountain landscape" -o mountain.png -p gemini # Gemini Imagen 3
vibe ai image "mountain landscape" -o mountain.png -p stability # Stability AI
```

---

### Feature: Multi-Provider Promo Video Workflow
Created a promotional video demonstrating multiple AI providers working together.

**Workflow:**
1. **Claude** - Generated storyboard from script (`vibe ai storyboard`)
2. **ElevenLabs** - TTS narration (`vibe ai tts`)
3. **DALL-E** - Scene images (frustration, terminal-ui, simplicity, features)
4. **FFmpeg** - Combined images into video slideshow with fade transitions

**Generated Assets:**
- `promo/script.txt` - Narration script
- `promo/storyboard.json` - 6-scene storyboard
- `promo/assets/narration.mp3` - 23s TTS narration (ElevenLabs)
- `promo/assets/logo-dalle.png` - VibeFrame logo
- `promo/assets/terminal-ui.png` - Terminal interface mockup
- `promo/assets/scene1-frustration.png` - Complex UI frustration
- `promo/assets/scene4-simplicity.png` - Simplicity comparison
- `promo/assets/scene5-features.png` - Feature icons

**Final Video:**
- `promo/promo-v2.mp4` - 23.5s, 1920x1080, H.264 + AAC
- Slideshow format with fade in/out transitions
- Audio synced to narration length

**Files Created:**
- `promo/create-video.sh` - FFmpeg script for slideshow creation
- All assets in `promo/assets/`

**Usage:**
```bash
# Generate storyboard
vibe ai storyboard promo/script.txt -f -d 30 -o promo/storyboard.json

# Generate narration
vibe ai tts "Your script..." -v EXAVITQu4vr4xnSDxMaL -o promo/assets/narration.mp3

# Generate images
vibe ai image "description..." -o promo/assets/image.png

# Create video from images
bash promo/create-video.sh
```

**Documentation:**
- Added "Example 5: Multi-Provider Promo Video (Advanced)" to `docs/cli-guide.md`

---

### Feature: CLI User Experience Improvements
Enhanced CLI onboarding, documentation, and installation experience.

**New Documentation:**
- Created `docs/cli-guide.md` - Comprehensive CLI usage guide in English
  - Quick Start section
  - AI provider structure (LLM and media providers)
  - Command reference and API requirements by feature
  - Offline/free features list
  - Workflow examples (social media, YouTube, podcast, AI-generated)
  - Configuration guide and troubleshooting

**REPL Welcome Message Improvements:**
- Shows current LLM provider status on startup (e.g., "● LLM: Ollama (Local)")
- Displays active capabilities (Whisper, TTS, Video Gen, Images)
- Added tip for Ollama users to ensure server is running
- Updated help text with "Getting Started" quick reference section

**Setup Wizard Improvements:**
- Added provider descriptions explaining each LLM's characteristics
- Claude: "Best understanding, most capable"
- OpenAI: "GPT-4, reliable and fast"
- Gemini: "Google AI, good for general use"
- Ollama: "Free, local, no API key needed"
- Added Ollama server startup guidance when selected
- Added environment variable fallback note for API keys

**Install Script Changes:**
- Made CLI-only installation the default (faster install)
- Added `--full` flag for full installation with web UI
- Added `--skip-setup` flag to skip setup wizard
- CLI-only builds only core, ai-providers, mcp-server, and cli packages
- Updated completion messages to show relevant commands

**Files Created:**
- `docs/cli-guide.md` - CLI usage guide

**Files Modified:**
- `packages/cli/src/repl/prompts.ts` - Status display, Getting Started section
- `packages/cli/src/repl/index.ts` - Pass config to welcome message
- `packages/cli/src/commands/setup.ts` - Provider descriptions, Ollama guidance
- `scripts/install.sh` - CLI-only default, --full flag

**Usage:**
```bash
# Default CLI-only install (faster)
curl -fsSL https://vibeframe.ai/install.sh | bash

# Full install with web UI
curl -fsSL https://vibeframe.ai/install.sh | bash -s -- --full

# Start REPL - shows status
vibe
# Output: ● LLM: Ollama (Local)
```

---

### Fix: Export Command Uses System FFmpeg
Changed export command to use system FFmpeg instead of FFmpeg.wasm, which only works in browsers.

**Problem:**
- `vibe export` failed with `ffmpeg.wasm does not support nodejs`
- FFmpeg.wasm is designed for browser environments only

**Solution:**
- Replaced `@ffmpeg/ffmpeg` with `child_process.spawn` to call system FFmpeg
- Added FFmpeg installation check with helpful error messages
- Properly builds filter_complex for clip concatenation and effects

**Features:**
- Checks if FFmpeg is installed, shows install instructions if missing
- Reports encoding progress percentage
- Supports fadeIn/fadeOut effects via FFmpeg fade filters
- Quality presets: draft, standard, high, ultra

**Files Modified:**
- `packages/cli/src/commands/export.ts` - Complete rewrite using system FFmpeg
- `packages/cli/package.json` - Removed @ffmpeg/ffmpeg, @ffmpeg/util dependencies

**Usage:**
```bash
# Export project to video
vibe export project.vibe.json -o output.mp4 -p standard -y

# Output:
# ✔ Exported: output.mp4
#   Duration: 15.0s
#   Clips: 3
#   Format: mp4
#   Preset: standard
#   Resolution: 1280x720
```

**FFmpeg Installation:**
```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg

# Windows
winget install ffmpeg
```

---

### Feature: Ollama Provider for Local LLM Support
Added OllamaProvider to enable local LLM support for natural language timeline commands without requiring external API keys.

**Features:**
- Uses Ollama's `/api/chat` endpoint (default: `http://localhost:11434`)
- Default model: `llama3.2` (2GB), also supports `mistral` (4GB), `phi` (1.6GB), `tinyllama` (0.6GB)
- No API key required - runs completely locally
- Full `parseCommand` implementation with same capabilities as OpenAI/Claude providers
- Fallback pattern matching when Ollama server is unavailable

**MCP Type Safety Improvements:**
- Fixed `as any` type cast to proper `EffectType` import in MCP tools
- Added `duration` parameter to `timeline_add_source` tool schema
- Removed unused `setCurrentProject()` function from resources

**Files Created:**
- `packages/ai-providers/src/ollama/OllamaProvider.ts` - Ollama provider implementation
- `packages/ai-providers/src/ollama/index.ts` - Export file

**Files Modified:**
- `packages/ai-providers/src/index.ts` - Added OllamaProvider export
- `packages/cli/src/repl/executor.ts` - Added Ollama to provider selection
- `packages/mcp-server/src/tools/index.ts` - Fixed EffectType, added duration param
- `packages/mcp-server/src/resources/index.ts` - Removed unused function

**Usage:**
```bash
# Install and run Ollama
ollama serve
ollama pull llama3.2  # default model (or mistral for better quality)

# Configure VibeFrame to use Ollama
vibe setup --full  # Select "Ollama" as LLM provider

# Use natural language commands locally
vibe
vibe> new test
vibe> add video.mp4
vibe> trim the clip to 5 seconds  # Uses local Ollama!
```

**Recommended Ollama Models:**
| Model | Size | Notes |
|-------|------|-------|
| llama3.2 | 2GB | Default, good balance |
| phi | 1.6GB | Lightweight, fast |
| tinyllama | 0.6GB | Smallest |
| mistral | 4.1GB | Best quality |

---

### Feature: Use Configured LLM Provider for Natural Language Commands
Fixed architecture issue where natural language commands only worked with OpenAI.

**Problem:**
- User selects Claude in `vibe setup`
- But natural language commands ("trim clip to 5s") require OpenAI
- This was an architectural inconsistency

**Solution:**
- Added `parseCommand` method to ClaudeProvider
- Updated REPL executor to use the user's configured LLM provider
- Now Claude users can use natural language commands without configuring OpenAI

**Files Modified:**
- `packages/ai-providers/src/claude/ClaudeProvider.ts` - Added parseCommand method
- `packages/cli/src/repl/executor.ts` - Use configured LLM provider instead of hardcoded OpenAI

**Verification:**
```bash
vibe setup    # Select Claude
vibe
vibe> new test
vibe> add video.mp4
vibe> trim the clip to 5 seconds  # Now uses Claude!
```

---

### Fix: Install Script Hanging After `vibe setup`
Fixed the install script hanging after `vibe setup` completes.

**Problem:**
- After running `curl ... | bash` installation
- User selects "Y" to run setup
- Setup completes successfully
- But the process doesn't exit, causing the terminal to hang

**Root Cause:**
When `vibe setup` is run from the install script with `< /dev/tty` redirection, the TTY stream opened via `getTTYInputStream()` keeps the Node.js event loop alive. Even though `closeTTYStream()` calls `destroy()` on the stream, the process doesn't exit automatically.

**Solution:**
Explicitly call `process.exit(0)` after setup completes successfully to ensure clean termination.

**Files Modified:**
- `packages/cli/src/commands/setup.ts` - Added explicit `process.exit(0)` after setup completes

**Code Change:**
```typescript
try {
  await runSetupWizard(options.full);
  closeTTYStream();
  // Explicitly exit to ensure clean termination when run from install script
  process.exit(0);
} catch (err) {
  closeTTYStream();
  throw err;
}
```

**Verification:**
```bash
rm -rf ~/.vibeframe
curl -fsSL https://vibeframe.ai/install.sh | bash
# Select Y for setup → Should complete and return to shell prompt
vibe           # REPL should start normally
```

---

### Fix: REPL Hanging & API Key Masking Issues
Fixed two issues with CLI interactive mode:

**Issue 1: REPL Hangs on Startup**
- Running `vibe` without arguments would hang with no output (while `vibe --help` worked fine)
- Root cause: Custom `createTTYInterface` using `/dev/tty` stream caused readline to hang
- Solution: Switched to standard Node.js `readline.createInterface` with `process.stdin`

**Issue 2: API Key Masking Shows Single Asterisk**
- When pasting API keys during `vibe setup`, only one `*` was displayed regardless of key length
- Root cause: Raw mode `onData` callback receives all pasted characters at once, but code assumed single char
- Solution: Changed `process.stdout.write("*")` to `process.stdout.write("*".repeat(char.length))`

**Files Modified:**
- `packages/cli/src/repl/index.ts` - Use standard readline instead of custom TTY, removed debug logs
- `packages/cli/src/utils/tty.ts` - Fixed asterisk masking for pasted text, removed unused import

**Verification:**
```bash
pnpm --filter @vibeframe/cli build
vibe           # Should show logo and prompt
vibe setup     # Pasting API key shows correct number of asterisks
```

---

### Fix: vibe setup fails when called from install.sh
Fixed `vibe setup` failing with "Interactive setup requires a terminal" when run via `curl ... | bash`.

**Root Cause:**
- `install.sh` line 160 used `read -p "..." < /dev/tty` for the Y/n prompt (works correctly)
- But line 165 called `vibe setup` without redirecting stdin, so it inherited the exhausted curl pipe

**Solution:**
- Changed `vibe setup` to `vibe setup < /dev/tty` in install.sh
- This ensures the Node.js process receives terminal input directly

**Files Modified:**
- `scripts/install.sh` - Added `/dev/tty` redirect for vibe setup command

**Verification:**
1. `rm -rf ~/.vibeframe`
2. `curl -fsSL https://vibeframe.ai/install.sh | bash`
3. Select "Y" when asked to run setup
4. Setup wizard should now work correctly

---

### Fix: ESM Module Resolution for CLI Installation
Fixed `vibe setup` failing after curl installation with `ERR_MODULE_NOT_FOUND`.

**Root Cause:**
- CLI symlink pointed to compiled JS: `~/.vibeframe/packages/cli/dist/index.js`
- But `@vibeframe/ai-providers` and `@vibeframe/core` package.json exports pointed to TypeScript source (`.ts`)
- Node.js cannot execute `.ts` files directly, causing module resolution failure

**Solution:**
- Updated package.json exports in both packages to point to compiled `./dist/*.js` files
- Changed `moduleResolution` from `bundler` to `NodeNext` in tsconfig.json
- Added `.js` extensions to all relative imports in source files (ESM requirement)

**Files Modified:**
- `packages/ai-providers/package.json` - Updated exports to `./dist/*.js`
- `packages/core/package.json` - Updated exports to `./dist/*.js`
- `packages/ai-providers/tsconfig.json` - Changed to `module: NodeNext`
- `packages/core/tsconfig.json` - Changed to `module: NodeNext`
- `packages/ai-providers/src/**/*.ts` - Added `.js` extensions to imports
- `packages/core/src/**/*.ts` - Added `.js` extensions to imports

**Verification:**
- `pnpm build` - All packages build successfully
- `node packages/cli/dist/index.js setup --help` - CLI works without errors
- 51 CLI tests pass

---

### Interactive Mode & Install Script
Added curl-installable setup and interactive REPL mode for VibeFrame.

**Install Script:**
- `curl -fsSL https://vibeframe.ai/install.sh | bash` - One-line installation
- Checks for Node.js 18+, git, FFmpeg (optional)
- Clones repo, installs dependencies, builds, creates symlink
- Runs setup wizard automatically

**Setup Command (`vibe setup`):**
- Interactive wizard for configuring LLM provider (Claude/OpenAI/Gemini/Ollama)
- Secure API key input with masking
- Optional video generation provider setup (Runway, Kling, Stability, Replicate)
- Default settings configuration (aspect ratio, export quality)
- Saves config to `~/.vibeframe/config.yaml`

**Interactive REPL Mode:**
- Run `vibe` without arguments to start interactive mode
- Built-in commands: new, open, save, info, list, add, export, undo, help, exit
- Natural language editing: "trim clip to 5 seconds", "add fade in effect"
- Auto-save after each command (configurable)
- Undo support with state history

**Config System:**
- YAML-based configuration at `~/.vibeframe/config.yaml`
- Stores LLM provider preference, API keys, defaults
- Integrated with existing API key system (config > .env > prompt)

**New Files:**
- `scripts/install.sh` - Installation script
- `packages/cli/src/config/schema.ts` - Config types
- `packages/cli/src/config/index.ts` - Config loader/saver
- `packages/cli/src/commands/setup.ts` - Setup wizard
- `packages/cli/src/repl/session.ts` - Session state manager
- `packages/cli/src/repl/executor.ts` - Command executor
- `packages/cli/src/repl/prompts.ts` - ASCII logo, help text
- `packages/cli/src/repl/index.ts` - REPL entry point

**Files Modified:**
- `packages/cli/src/index.ts` - REPL by default, added setup command
- `packages/cli/src/utils/api-key.ts` - Config integration
- `packages/cli/src/commands/ai.ts` - Exported executeCommand
- `packages/cli/package.json` - Added yaml dependency

**New Tests:** 63 tests added (total: 220 tests)
- Config schema tests
- Config loader tests
- REPL prompts tests
- REPL session tests
- REPL executor tests

**Usage:**
```bash
# Install
curl -fsSL https://vibeframe.ai/install.sh | bash

# Configure
vibe setup

# Start interactive mode
vibe
vibe> new my-project
vibe> add intro.mp4
vibe> trim the clip to 5 seconds
vibe> add fade in
vibe> export
vibe> exit
```

---

### Smart Editing Features
Added 8 new AI-powered smart editing commands for Phase 4.

**New Commands:**
- `vibe ai duck` - Auto-duck background music when voice is present (FFmpeg sidechain compress)
- `vibe ai grade` - AI color grading with style prompts or presets (Claude + FFmpeg)
- `vibe ai speed-ramp` - Content-aware speed ramping (Whisper + Claude + FFmpeg)
- `vibe ai reframe` - Auto-reframe to different aspect ratios (Claude Vision + FFmpeg)
- `vibe ai auto-shorts` - Generate shorts from long-form video (highlights + reframe + captions)
- `vibe ai style-transfer` - Apply artistic style transfer to video (Replicate)
- `vibe ai track-object` - Track objects in video using SAM-2 or co-tracker (Replicate)

**Enhanced Natural Language Timeline Control:**
- Extended `vibe ai edit` with 4 new actions: speed-change, reverse, crop, position
- Examples: "speed up the middle part by 2x", "reverse the second clip", "crop to 9:16 portrait"

**ClaudeProvider Enhancements:**
- Added `analyzeColorGrade()` method - generates FFmpeg filters from style descriptions
- Added `analyzeForSpeedRamp()` method - identifies emotional peaks for speed keyframes
- Added `analyzeFrameForReframe()` method - Claude Vision for subject tracking

**ReplicateProvider Enhancements:**
- Added `styleTransferVideo()` method for video style transfer
- Added `trackObject()` method for point/box/prompt-based tracking
- Added `getTrackingResult()` method for tracking result retrieval

**OpenAIProvider Enhancements:**
- Extended parseCommand with speed-change, reverse, crop, position actions
- Enhanced fallback parser for offline capability

**New Types:**
- Added 6 new AICapability types: `color-grading`, `speed-ramping`, `auto-reframe`, `auto-shorts`, `object-tracking`, `audio-ducking`
- Extended TimelineCommand.action with: `speed-change`, `reverse`, `crop`, `position`

**Built-in Color Grade Presets:**
- film-noir, vintage, cinematic-warm, cool-tones
- high-contrast, pastel, cyberpunk, horror

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added 6 capabilities, 4 timeline actions
- `packages/ai-providers/src/claude/ClaudeProvider.ts` - Added 3 analysis methods (~350 lines)
- `packages/ai-providers/src/replicate/ReplicateProvider.ts` - Added style/tracking methods (~180 lines)
- `packages/ai-providers/src/openai/OpenAIProvider.ts` - Extended command parsing (~100 lines)
- `packages/cli/src/commands/ai.ts` - Added 8 new commands (~800 lines)
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Audio Ducking (FFmpeg, free)
pnpm vibe ai duck bgm.mp3 --voice narration.mp3 -o ducked.mp3
pnpm vibe ai duck bgm.mp3 --voice vo.mp3 --threshold -25 --ratio 4

# Color Grading (Claude + FFmpeg)
pnpm vibe ai grade video.mp4 --style "sunset warm glow" -o graded.mp4
pnpm vibe ai grade video.mp4 --preset cyberpunk -o styled.mp4
pnpm vibe ai grade video.mp4 --preset film-noir --analyze-only  # Preview only

# Speed Ramping (Whisper + Claude + FFmpeg)
pnpm vibe ai speed-ramp video.mp4 -o ramped.mp4
pnpm vibe ai speed-ramp video.mp4 --style dramatic --analyze-only
pnpm vibe ai speed-ramp video.mp4 --min-speed 0.25 --max-speed 4

# Auto Reframe (Claude Vision + FFmpeg)
pnpm vibe ai reframe video.mp4 --aspect 9:16 -o portrait.mp4
pnpm vibe ai reframe video.mp4 --focus face --keyframes crop.json

# Auto Shorts
pnpm vibe ai auto-shorts video.mp4 -d 60 -o short.mp4
pnpm vibe ai auto-shorts video.mp4 --count 3 --output-dir ./shorts

# Style Transfer (Replicate)
pnpm vibe ai style-transfer https://example.com/video.mp4 --style "anime style"

# Object Tracking (Replicate SAM-2)
pnpm vibe ai track-object https://example.com/video.mp4 --point 500,300

# Enhanced NL Timeline
pnpm vibe ai edit project.json "speed up by 2x"
pnpm vibe ai edit project.json "reverse the clip"
pnpm vibe ai edit project.json "crop to portrait"
```

---

## 2026-02-01

### Voice & Audio Features
Added 4 new AI-powered audio processing commands for Phase 4.

**New Commands:**
- `vibe ai voice-clone` - Clone voices from audio samples using ElevenLabs
- `vibe ai music` - Generate background music from prompts using MusicGen (Replicate)
- `vibe ai music-status` - Check music generation status
- `vibe ai audio-restore` - Restore audio quality (denoise, enhance) with Replicate or FFmpeg
- `vibe ai dub` - Multi-provider dubbing pipeline (Whisper + Claude + ElevenLabs)

**ElevenLabsProvider Enhancements:**
- Added `cloneVoice()` method for voice cloning from audio samples
- Added `deleteVoice()` method for removing cloned voices
- Added `voice-clone` capability

**ReplicateProvider Enhancements:**
- Added `generateMusic()` method using MusicGen model
- Added `getMusicStatus()` and `waitForMusic()` methods
- Added `restoreAudio()` method for AI audio restoration
- Added `getAudioRestorationStatus()` and `waitForAudioRestoration()` methods
- Added `music-generation` and `audio-restoration` capabilities

**New Types:**
- `VoiceCloneOptions`, `VoiceCloneResult` - Voice cloning interfaces
- `MusicGenerationOptions`, `MusicGenerationResult` - Music generation interfaces
- `AudioRestorationOptions`, `AudioRestorationResult` - Audio restoration interfaces

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added `voice-clone`, `dubbing`, `music-generation`, `audio-restoration` capabilities
- `packages/ai-providers/src/elevenlabs/ElevenLabsProvider.ts` - Added cloneVoice, deleteVoice methods
- `packages/ai-providers/src/replicate/ReplicateProvider.ts` - Added music and audio restoration methods
- `packages/ai-providers/src/index.ts` - Exported new types
- `packages/cli/src/commands/ai.ts` - Added 5 new commands (~400 lines)
- `packages/cli/src/commands/ai.test.ts` - Added tests for new commands
- `docs/roadmap.md` - Marked Voice & Audio features complete
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Voice Clone
pnpm vibe ai voice-clone sample1.mp3 sample2.mp3 -n "MyVoice" -d "Professional narrator"
pnpm vibe ai voice-clone --list  # List all voices

# Music Generation
pnpm vibe ai music "upbeat electronic" -d 10 -o bgm.mp3
pnpm vibe ai music "cinematic orchestral" -d 30 --model stereo-large -o theme.mp3
pnpm vibe ai music "lofi hip-hop" --no-wait  # Async mode, returns task ID
pnpm vibe ai music-status <task-id>  # Check status

# Audio Restoration
pnpm vibe ai audio-restore noisy.mp3 --ffmpeg -o clean.mp3  # Free FFmpeg fallback
pnpm vibe ai audio-restore noisy.mp3 --denoise --enhance -o restored.mp3

# AI Dubbing (multi-provider pipeline)
pnpm vibe ai dub video.mp4 -l es -o video-spanish.mp4
pnpm vibe ai dub podcast.mp3 -l ko -v <voice-id> -o dubbed.mp3
pnpm vibe ai dub video.mp4 -l ja --analyze-only -o timing.json
```

**FFmpeg Audio Restoration Filters (Free):**
```bash
# Basic noise reduction
ffmpeg -i input.mp3 -af "afftdn=nf=-30" output.mp3

# Full restoration chain
ffmpeg -i input.mp3 -af "highpass=f=80,lowpass=f=12000,afftdn=nf=-30,loudnorm=I=-16:TP=-1.5:LRA=11" output.mp3
```

---

### Video Understanding & Generation Features
Added 4 new AI-powered video processing commands for Phase 4.

**New Commands:**
- `vibe ai video-extend` - Extend video duration using Kling AI
- `vibe ai video-upscale` - AI upscaling with Replicate or FFmpeg fallback
- `vibe ai video-interpolate` - Frame interpolation for slow motion (FFmpeg minterpolate)
- `vibe ai video-inpaint` - Object removal using Replicate ProPainter

**New Provider:**
- `ReplicateProvider` - Video upscaling and inpainting via Replicate API
  - Supports Real-ESRGAN for video upscaling
  - Supports ProPainter for video inpainting

**KlingProvider Enhancements:**
- Added `extendVideo()` method for video extension
- Added `getExtendStatus()` and `waitForExtendCompletion()` methods

**Files created:**
- `packages/ai-providers/src/replicate/ReplicateProvider.ts` - New provider
- `packages/ai-providers/src/replicate/index.ts` - Exports

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added `video-extend`, `video-inpaint`, `video-upscale`, `frame-interpolation` capabilities
- `packages/ai-providers/src/kling/KlingProvider.ts` - Added video extend methods
- `packages/ai-providers/src/index.ts` - Exported ReplicateProvider
- `packages/cli/src/commands/ai.ts` - Added 4 new commands (~400 lines)
- `packages/cli/src/commands/ai.test.ts` - Added tests for new commands
- `docs/roadmap.md` - Marked Video Understanding features complete
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Video Extend
pnpm vibe ai video-extend video.mp4 -o extended.mp4
pnpm vibe ai video-extend video.mp4 --prompt "continue smoothly" -d 10

# Video Upscale
pnpm vibe ai video-upscale video.mp4 --scale 2 -o hd.mp4
pnpm vibe ai video-upscale video.mp4 --ffmpeg -o hd-ffmpeg.mp4  # Free FFmpeg fallback

# Frame Interpolation (Slow Motion)
pnpm vibe ai video-interpolate video.mp4 --factor 2 -o slow.mp4
pnpm vibe ai video-interpolate video.mp4 --factor 4 --fps 120 -o ultra-slow.mp4

# Video Inpaint (Object Removal)
pnpm vibe ai video-inpaint https://example.com/video.mp4 --mask https://example.com/mask.mp4 -o clean.mp4
```

---

### MCP Documentation Enhancement
- Completely rewrote `packages/mcp-server/README.md` with comprehensive documentation
- Created `docs/mcp.md` - Detailed MCP integration guide

**README.md improvements:**
- Quick start guide with step-by-step setup
- Configuration options for Claude Desktop (macOS/Windows/Linux) and Cursor
- Complete tool reference with all parameters and descriptions
- Resource reference with example responses
- Prompt reference with argument documentation
- Usage examples (basic workflow, complex edit, prompts)
- Troubleshooting section with common issues
- Architecture diagram
- Development commands

**docs/mcp.md includes:**
- Detailed setup instructions for all platforms
- Core concepts (project files, ID system, time units, media types)
- 5 complete workflow examples:
  1. Create a Simple Video
  2. Multi-Clip Montage
  3. Split and Rearrange
  4. Color Grading
  5. Short-Form Content
- Tool, Resource, and Prompt reference tables
- Advanced usage (combining with CLI, batch operations, AI pipelines)
- Comprehensive troubleshooting guide

**Files modified:**
- `packages/mcp-server/README.md` - Complete rewrite (~500 lines)
- `docs/mcp.md` - New comprehensive guide (~600 lines)

---

### Phase 4: Viral Optimizer Implementation
- Added `vibe ai viral` command for platform-specific video optimization
- Full AI pipeline orchestration:
  1. **Whisper** - Transcribes video content for analysis
  2. **Claude** - Analyzes viral potential (hook strength, emotional peaks, pacing)
  3. **Claude** - Generates platform-specific cuts
  4. **Claude** - Generates social-media styled captions
  5. **Project Engine** - Creates platform variant projects

**Features:**
- Viral potential analysis with scoring (0-100)
- Hook strength assessment
- Emotional peak detection
- Pacing evaluation (slow/moderate/fast)
- Platform suitability scores (YouTube, YouTube Shorts, TikTok, Instagram Reels, Instagram Feed, Twitter)
- Platform-specific project generation with optimized cuts
- Caption generation (minimal, bold, animated styles)
- Analyze-only mode for quick assessment
- JSON output with detailed analysis results

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added PlatformSpec, ViralAnalysis, PlatformCut, and related types
- `packages/ai-providers/src/claude/ClaudeProvider.ts` - Added analyzeViralPotential, suggestPlatformCuts, generateViralCaptions methods
- `packages/ai-providers/src/index.ts` - Exported new types
- `packages/cli/src/commands/ai.ts` - Added viral command (~400 lines)
- `packages/cli/src/commands/ai.test.ts` - Added tests
- `docs/roadmap.md` - Marked Viral Optimizer complete
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Analyze viral potential only
pnpm vibe ai viral project.vibe.json --analyze-only

# Generate for specific platforms
pnpm vibe ai viral project.vibe.json -p tiktok,instagram-reels

# Full pipeline with custom options
pnpm vibe ai viral project.vibe.json -p youtube-shorts,tiktok -o ./optimized --caption-style bold

# All platforms
pnpm vibe ai viral project.vibe.json -o ./viral-output

# Export generated variant
pnpm vibe export viral-output/tiktok.vibe.json -o tiktok.mp4
```

**CLI Output Example:**
```
🚀 Viral Optimizer Pipeline
────────────────────────────────────────────────────────────

✓ Loaded project: My Video (2:34, 5 clips)
✓ Transcribed 45 segments

📊 Analyzing viral potential...
✓ Analysis complete

Viral Potential Summary
────────────────────────────────────────────────────────────
  Overall Score: 78%
  Hook Strength: 85%
  Pacing: moderate

  Platform Suitability:
    TikTok           ████████░░ 82%
    YouTube Shorts   ███████░░░ 75%
    Instagram Reels  ████████░░ 80%
    YouTube          █████████░ 92%

  Emotional Peaks:
    0:45.2 - excitement (90%)
    2:15.3 - humor (85%)

🎬 Generating platform variants...
  ✔ youtube.vibe.json (2:34, 16:9)
  ✔ youtube-shorts.vibe.json (0:58, 9:16)
  ✔ tiktok.vibe.json (0:45, 9:16)
  ✔ instagram-reels.vibe.json (0:52, 9:16)

────────────────────────────────────────────────────────────
✅ Viral optimization complete!
   4 platform variants generated

💾 Saved to: ./viral-output/

Next steps:
  vibe export viral-output/tiktok.vibe.json -o tiktok.mp4
  vibe export viral-output/youtube-shorts.vibe.json -o shorts.mp4
```

---

### Phase 4: B-Roll Matcher Implementation
- Added `vibe ai b-roll` command for automatic B-roll to narration matching
- Full AI pipeline orchestration:
  1. **Whisper** - Transcribes narration audio to text with timestamps
  2. **Claude Vision** - Analyzes B-roll video frames for visual content
  3. **Claude** - Analyzes narration for visual requirements and matches B-roll
  4. **Project Engine** - Creates project with matched B-roll clips

**Features:**
- Audio narration transcription with Whisper
- Script text input support (from file or direct text)
- B-roll discovery from file list or directory
- Claude Vision analysis of B-roll content (description + tags)
- AI-powered narration analysis for visual requirements
- Semantic matching between narration and B-roll
- Configurable confidence threshold filtering (default: 0.6)
- Analyze-only mode for testing
- Project generation with source-offset clips
- JSON output with detailed match analysis

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added BrollClipInfo, NarrationSegment, BrollMatch, BrollMatchResult types
- `packages/ai-providers/src/claude/ClaudeProvider.ts` - Added analyzeBrollContent, analyzeNarrationForVisuals, matchBrollToNarration methods
- `packages/ai-providers/src/index.ts` - Exported new types
- `packages/cli/src/commands/ai.ts` - Added b-roll command (~300 lines)
- `packages/cli/src/commands/ai.test.ts` - Added tests
- `docs/roadmap.md` - Marked B-Roll Matcher complete
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Match B-roll files to audio narration
vibe ai b-roll podcast.mp3 -b clip1.mp4,clip2.mp4 -o project.vibe.json

# Use B-roll directory
vibe ai b-roll narration.mp3 --broll-dir ./broll -o project.vibe.json

# From script file
vibe ai b-roll script.txt -f -b clip.mp4 -o project.vibe.json

# Direct text input
vibe ai b-roll "Our product solves..." -b demo.mp4,office.mp4 -o project.vibe.json

# Custom confidence threshold
vibe ai b-roll audio.mp3 --broll-dir ./assets -t 0.7 -o project.vibe.json

# Analyze only (no project generation)
vibe ai b-roll audio.mp3 --broll-dir ./broll --analyze-only

# Specify transcription language
vibe ai b-roll korean-audio.mp3 --broll-dir ./broll -l ko -o project.vibe.json
```

**CLI Output Example:**
```
🎬 B-Roll Matcher Pipeline
────────────────────────────────────────────────────────────

✓ Found 5 B-roll file(s)

✓ Processed 12 narration segments (2:30 total)

✓ Analyzed 5 B-roll clips
  → office.mp4: "People working at desks with computers"
    [office, technology, teamwork, workspace, indoor]
  → product-demo.mp4: "Close-up of mobile app interface"
    [technology, mobile, app, close-up, user-interface]
  ...

✓ Narration analysis complete

✓ Found 10 matches (83% coverage)

📊 Match Summary
────────────────────────────────────────────────────────────

  Segment 1 [0:00 - 0:15]
    "Our team has been working hard on..."
    → office.mp4 (92%)
    Office environment matches discussion of team work

  Segment 2 [0:15 - 0:30]
    "The new app features..."
    → product-demo.mp4 (88%)
    App demo footage matches feature discussion
  ...

  ⚠ 2 unmatched segment(s): [8, 11]

────────────────────────────────────────────────────────────
Total: 10/12 segments matched, 83% coverage

✓ Created project: project.vibe.json
  → Analysis saved: project-analysis.json

✅ B-Roll matching complete!

Next steps:
  vibe project info project.vibe.json
  vibe export project.vibe.json -o final.mp4
  Consider adding more B-roll clips for unmatched segments
```

---

### Phase 4: Auto Highlights Implementation
- Added `vibe ai highlights` command for extracting highlights from long-form content
- Full AI pipeline orchestration:
  1. **FFmpeg** - Extracts audio from video files
  2. **Whisper** - Transcribes audio to text with timestamps
  3. **Claude** - Analyzes transcript and identifies engaging moments
  4. **Filtering** - Ranks and filters by confidence threshold
  5. **Project Engine** - Creates project with highlight clips

**Features:**
- Automatic audio extraction for video files
- AI-powered highlight detection with Claude
- Configurable criteria: emotional, informative, funny, or all
- Confidence threshold filtering (default: 0.7)
- Target duration and max count options
- JSON output with detailed highlight metadata
- Project generation with source-offset clips

**Files modified:**
- `packages/ai-providers/src/interface/types.ts` - Added Highlight types
- `packages/ai-providers/src/claude/ClaudeProvider.ts` - Added analyzeForHighlights method
- `packages/ai-providers/src/index.ts` - Exported new types
- `packages/cli/src/commands/ai.ts` - Added highlights command (~200 lines)
- `packages/cli/src/commands/ai.test.ts` - Added tests
- `docs/roadmap.md` - Marked Auto Highlights complete
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Extract highlights from video
vibe ai highlights video.mp4 -o highlights.json

# Create highlight reel project
vibe ai highlights podcast.mp3 -p highlights.vibe.json

# Specify target duration and criteria
vibe ai highlights lecture.mp4 -d 60 --criteria informative -o best-moments.json

# Filter by confidence and count
vibe ai highlights interview.mp4 -t 0.8 -n 5 -o top5.json

# Korean language transcription
vibe ai highlights korean-video.mp4 -l ko -o highlights.json
```

**CLI Output Example:**
```
🎬 Highlight Extraction Pipeline
────────────────────────────────────────────────────────────

✓ Extracted audio (45:32 total duration)

✓ Transcribed 324 segments

✓ Found 12 potential highlights

✓ Selected 8 highlights (58.5s total)

Highlights Summary
────────────────────────────────────────────────────────────

  1. [02:00 - 02:25] informative, 92%
     Key insight about the main topic
     "This is important because..."

  2. [05:45 - 06:10] funny, 88%
     Amusing anecdote about...
     "And then I realized..."
  ...

────────────────────────────────────────────────────────────
Total: 8 highlights, 58.5 seconds

💾 Saved highlights to: highlights.json

✅ Highlight extraction complete!
```

---

### Phase 4: Script-to-Video Implementation
- Added `vibe ai script-to-video` command for end-to-end video generation from text
- Full AI pipeline orchestration:
  1. **Claude** - Analyzes script and generates storyboard segments
  2. **ElevenLabs** - Generates voiceover narration from script
  3. **DALL-E** - Creates visual assets for each scene
  4. **Runway/Kling** - Generates video clips from images (image-to-video)
  5. **Project Engine** - Assembles all assets into .vibe.json project

**Features:**
- Automatic storyboard generation with timing
- Multi-scene visual generation with DALL-E
- Optional voiceover with ElevenLabs TTS
- Video generation with Runway Gen-3 or Kling AI
- Aspect ratio support: 16:9, 9:16, 1:1
- Images-only mode for faster iteration
- Output directory for all generated assets

**Files modified:**
- `packages/cli/src/commands/ai.ts` - Added script-to-video command (~300 lines)
- `docs/roadmap.md` - Updated Phase 4 with new GenAI features
- `CLAUDE.md` - Added CLI documentation

**Usage:**
```bash
# Simple text input
vibe ai script-to-video "A day in the life of a developer..." -o project.vibe.json

# From script file
vibe ai script-to-video script.txt -f -o project.vibe.json

# With options
vibe ai script-to-video "..." -d 60 -v <voice-id> -a 9:16 -g kling

# Images only (faster, no video generation)
vibe ai script-to-video "..." --images-only -o test.vibe.json

# Skip voiceover
vibe ai script-to-video "..." --no-voiceover -o silent.vibe.json

# Custom output directory
vibe ai script-to-video "..." --output-dir ./my-assets -o project.vibe.json
```

**CLI Output Example:**
```
🎬 Script-to-Video Pipeline
────────────────────────────────────────────────────────────

✓ Generated 5 scenes (total: 45s)
  → Saved: script-video-output/storyboard.json

✓ Voiceover generated (342 chars)
  → Saved: script-video-output/voiceover.mp3

✓ Generated 5/5 images

✓ Generated 5/5 videos

✓ Project assembled

✅ Script-to-Video complete!
────────────────────────────────────────────────────────────

  📄 Project: script-video.vibe.json
  🎬 Scenes: 5
  ⏱️  Duration: 45s
  📁 Assets: script-video-output/
  🎙️  Voiceover: voiceover.mp3
  🖼️  Images: 5 scene-*.png
  🎥 Videos: 5 scene-*.mp4

Next steps:
  vibe project info script-video.vibe.json
  vibe export script-video.vibe.json -o final.mp4
```

---

### Phase 2 AI Provider Extensions
- Added ElevenLabs Sound Effects generation (`vibe ai sfx`)
  - Text-to-sound effect using ElevenLabs API
  - Duration (0.5-22 seconds) and prompt influence options
- Added ElevenLabs Audio Isolation (`vibe ai isolate`)
  - Separates vocals from background audio
- Added Stability AI Search & Replace (`vibe ai sd-replace`)
  - AI-powered object replacement in images
  - Search for objects/text and replace with new content
- Added Stability AI Outpainting (`vibe ai sd-outpaint`)
  - Extend image canvas in any direction (left/right/up/down)
  - Optional prompt for extended area content
  - Creativity level control

**Files modified:**
- `packages/ai-providers/src/elevenlabs/ElevenLabsProvider.ts`
  - Added `generateSoundEffect()` method
  - Added `isolateVocals()` method
  - Added `sound-generation`, `audio-isolation` capabilities
- `packages/ai-providers/src/stability/StabilityProvider.ts`
  - Added `searchAndReplace()` method
  - Added `outpaint()` method
  - Added `search-replace`, `outpaint` capabilities
- `packages/ai-providers/src/interface/types.ts`
  - Added new AI capabilities: sound-generation, audio-isolation, search-replace, outpaint
- `packages/cli/src/commands/ai.ts`
  - Added `sfx`, `isolate`, `sd-replace`, `sd-outpaint` commands

**Usage:**
```bash
# Generate sound effect
vibe ai sfx "explosion" -o boom.mp3
vibe ai sfx "footsteps on gravel" --duration 5 -o steps.mp3
vibe ai sfx "gentle rain" --prompt-influence 0.5 -o rain.mp3

# Isolate vocals from audio
vibe ai isolate song.mp3 -o vocals.mp3

# Search and replace objects in image
vibe ai sd-replace image.png "cat" "dog" -o output.png
vibe ai sd-replace photo.jpg "old car" "sports car" -n "blurry" -o replaced.jpg

# Outpaint - extend image canvas
vibe ai sd-outpaint image.png --left 512 --right 512 -o wider.png
vibe ai sd-outpaint portrait.png --up 200 --down 200 --prompt "blue sky" -o taller.png
vibe ai sd-outpaint photo.png --right 256 --creativity 0.7 -o extended.png
```

---

### MCP (Model Context Protocol) Integration
- Created `packages/mcp-server/` - MCP server for AI assistant integration
- Enables Claude Desktop, Cursor, and other MCP clients to control VibeFrame

**Tools (12):**
- Project: `project_create`, `project_info`
- Timeline: `timeline_add_source`, `timeline_add_clip`, `timeline_split_clip`, `timeline_trim_clip`, `timeline_move_clip`, `timeline_delete_clip`, `timeline_duplicate_clip`, `timeline_add_effect`, `timeline_add_track`, `timeline_list`

**Resources (5):**
- `vibe://project/current` - Full project state
- `vibe://project/clips` - Clip list
- `vibe://project/sources` - Media sources
- `vibe://project/tracks` - Track list
- `vibe://project/settings` - Project settings

**Prompts (7):**
- `edit_video` - Natural language editing
- `create_montage` - Auto montage creation
- `add_transitions` - Batch transitions
- `color_grade` - Color grading presets
- `generate_subtitles` - AI transcription
- `create_shorts` - Short-form generation
- `sync_to_music` - Beat-synced editing

**Files created:**
- `packages/mcp-server/package.json`
- `packages/mcp-server/tsconfig.json`
- `packages/mcp-server/src/index.ts` - MCP server entry
- `packages/mcp-server/src/tools/index.ts` - Timeline tools
- `packages/mcp-server/src/resources/index.ts` - Project resources
- `packages/mcp-server/src/prompts/index.ts` - Prompt templates
- `packages/mcp-server/README.md` - Setup guide

**Claude Desktop Configuration:**
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

---

### Stability AI (Stable Diffusion) Integration
- Added `vibe ai sd` command for Stable Diffusion image generation
  - SD3.5 Large, Medium, and Ultra models
  - Aspect ratio presets (16:9, 1:1, 9:16, 21:9, etc.)
  - Style presets (photographic, anime, cinematic, etc.)
  - Negative prompts support
  - Seed for reproducibility
- Added `vibe ai sd-upscale` command for image upscaling
  - Fast, conservative, and creative upscale modes
- Added `vibe ai sd-remove-bg` command for background removal
- Added `vibe ai sd-img2img` command for image-to-image transformation
  - Adjustable strength parameter
- Created StabilityProvider with methods:
  - `generateImage()` - Text-to-image with SD3.5
  - `generateImageSDXL()` - Legacy SDXL generation
  - `imageToImage()` - Image transformation
  - `upscaleImage()` - Image upscaling
  - `removeBackground()` - Background removal
  - `inpaint()` - Inpainting/outpainting

**Files created:**
- `packages/ai-providers/src/stability/StabilityProvider.ts`
- `packages/ai-providers/src/stability/index.ts`

**Usage:**
```bash
# Generate image with Stable Diffusion
vibe ai sd "A majestic mountain landscape at sunset" -o landscape.png

# With style preset
vibe ai sd "Portrait of a warrior" --style cinematic -r 9:16 -o portrait.png

# With negative prompt
vibe ai sd "A cat" -n "blurry, low quality, distorted" -o cat.png

# Upscale image
vibe ai sd-upscale input.png -o upscaled.png -t creative

# Remove background
vibe ai sd-remove-bg photo.jpg -o no-bg.png

# Image-to-image transformation
vibe ai sd-img2img sketch.png "detailed oil painting style" -t 0.5 -o painting.png
```

---

### Kling AI Video Generation
- Added `vibe ai kling` command for AI video generation
  - Text-to-video with Kling v1.5 model
  - Image-to-video with reference image support
  - Duration options: 5 or 10 seconds
  - Aspect ratio: 16:9, 9:16, 1:1
  - Standard/Pro generation modes
  - Negative prompts support
- Added `vibe ai kling-status` command to check generation status
  - Separate tracking for text2video and image2video tasks
  - Video download when complete
- Updated KlingProvider with full API implementation:
  - JWT token authentication (ACCESS_KEY:SECRET_KEY format)
  - `generateVideo()` - Text/image to video
  - `generateFromImage()` - Image-to-video helper
  - `getGenerationStatus()` - Task status polling
  - `waitForCompletion()` - Async polling with callback

**Files modified:**
- `packages/ai-providers/src/kling/KlingProvider.ts` - Full API implementation
- `packages/cli/src/commands/ai.ts` - Added kling commands

**Usage:**
```bash
# Generate video from text
vibe ai kling "A beautiful sunset over the ocean" -o sunset.mp4

# Generate with options
vibe ai kling "Dynamic city timelapse" -d 10 -r 16:9 -m pro -o city.mp4

# Image-to-video (animate an image)
vibe ai kling "Camera slowly panning" -i photo.jpg -o animated.mp4

# With negative prompt
vibe ai kling "Person walking" -n "blurry, low quality" -o walk.mp4

# Start without waiting (get task ID)
vibe ai kling "Flying through clouds" --no-wait

# Check status (text2video)
vibe ai kling-status <task-id>

# Check status (image2video)
vibe ai kling-status <task-id> --type image2video

# Wait and download when complete
vibe ai kling-status <task-id> -w -o output.mp4
```

---

### Runway Gen-3 Video Generation
- Added `vibe ai video` command for AI video generation
  - Text-to-video with Gen-3 Alpha Turbo model
  - Image-to-video with reference image support
  - Duration options: 5 or 10 seconds
  - Aspect ratio: 16:9 or 9:16
  - Seed for reproducibility
- Added `vibe ai video-status` command to check generation status
  - Progress tracking with polling
  - Video download when complete
- Added `vibe ai video-cancel` command to cancel in-progress generation
- Updated RunwayProvider with full API implementation:
  - `generateVideo()` - Text/image to video
  - `generateFromImage()` - Image-to-video helper
  - `getGenerationStatus()` - Task status polling
  - `cancelGeneration()` - Cancel task
  - `waitForCompletion()` - Async polling with progress callback
- Uses Runway Gen-3 Alpha Turbo API with proper versioning

**Files modified:**
- `packages/ai-providers/src/runway/RunwayProvider.ts` - Full API implementation
- `packages/cli/src/commands/ai.ts` - Added video commands

**Usage:**
```bash
# Generate video from text
vibe ai video "A serene ocean sunset" -o sunset.mp4

# Generate with options
vibe ai video "Dynamic city timelapse" -d 10 -r 16:9 -o city.mp4

# Image-to-video (animate an image)
vibe ai video "Camera slowly zooming in" -i photo.jpg -o animated.mp4

# Start without waiting (get task ID)
vibe ai video "Flying through clouds" --no-wait

# Check status
vibe ai video-status <task-id>

# Wait and download when complete
vibe ai video-status <task-id> -w -o output.mp4

# Cancel generation
vibe ai video-cancel <task-id>
```

---

### DALL-E Image Generation
- Added `vibe ai image` command for general image generation
- Added `vibe ai thumbnail` command for video thumbnails
  - Platform style presets: YouTube, Instagram, TikTok, Twitter
  - Automatic size optimization for each platform
- Added `vibe ai background` command for video backgrounds
  - Aspect ratio support: 16:9, 9:16, 1:1
- DalleProvider with methods:
  - `generateImage()` - General image generation
  - `generateThumbnail()` - Platform-optimized thumbnails
  - `generateBackground()` - Video backgrounds
  - `createVariation()` - Image variations
- Uses DALL-E 3 model with configurable size, quality, and style

**Files created:**
- `packages/ai-providers/src/dalle/DalleProvider.ts`
- `packages/ai-providers/src/dalle/index.ts`

**Usage:**
```bash
# Generate image
vibe ai image "abstract gradient background" -o bg.png

# With options
vibe ai image "cat in space" -s 1792x1024 -q hd --style natural

# Generate YouTube thumbnail
vibe ai thumbnail "coding tutorial intro" -s youtube -o thumb.png

# Generate TikTok thumbnail
vibe ai thumbnail "day in the life" -s tiktok -o cover.png

# Generate video background
vibe ai background "soft blue gradient" -a 16:9 -o bg.png
```

---

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

### Claude Integration (Motion Graphics & Storyboarding)
- Added `vibe ai motion` command for AI-generated motion graphics
  - Natural language → Remotion code generation
  - Configurable duration, size, FPS, style presets
  - Outputs ready-to-render TSX component
- Added `vibe ai storyboard` command for content analysis
  - Breaks content into video segments
  - Suggests visuals, audio, text overlays
  - Outputs structured JSON storyboard
- Created ClaudeProvider with:
  - generateMotion() - Remotion code generation
  - analyzeContent() - Storyboard generation
  - autoEdit() - Edit suggestions

**Files created:**
- `packages/ai-providers/src/claude/ClaudeProvider.ts`
- `packages/ai-providers/src/claude/index.ts`

**Usage:**
```bash
# Generate motion graphic
vibe ai motion "bouncing logo intro animation" -o intro.tsx

# With style preset
vibe ai motion "title fade in" -s cinematic -d 3

# Generate storyboard from text
vibe ai storyboard "Product launch video script..." -o storyboard.json

# From file
vibe ai storyboard script.txt -f -d 60 -o storyboard.json
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
vibe ai tts "Welcome to VibeFrame" -v <voice-id> -o intro.mp3

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
pnpm --filter @vibeframe/cli test
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
