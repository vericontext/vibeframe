# VibeFrame — Claude Code Test

> Test VibeFrame in the Claude Code (terminal AI) environment.
> Covers CLI direct execution + Skills slash commands + MCP server integration.

**Difference from QUICK_TEST.md / FUNC_TEST.md:**
- QUICK_TEST: Run `vibe ...` commands directly in terminal
- FUNC_TEST: Verify landing page features via CLI
- **This file**: Claude Code executes CLI via Bash tool + uses Skills + MCP integration

---

## Prerequisites

```bash
# 1. Build (required)
pnpm install && pnpm build

# 2. Verify API keys in .env
cat .env | grep -c "API"   # At least 3

# 3. test-results directory
mkdir -p test-results
```

**Minimum required keys:** `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `KLING_API_KEY`
**Full test:** + `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RUNWAY_API_SECRET`

---

## Required API Keys

| Step | Feature | Required API Key |
|------|---------|-----------------|
| C1 | Build + unit tests | None |
| C2 | CLI `--help` verification | None |
| C3 | Image generation (Bash) | `GOOGLE_API_KEY` |
| C4 | Image editing (Bash) | `GOOGLE_API_KEY` |
| C5 | TTS voice generation (Bash) | `ELEVENLABS_API_KEY` |
| C6 | Video generation (Bash) | `KLING_API_KEY` |
| C7 | Project + timeline (Bash) | None |
| C8 | FFmpeg editing (Bash) | None (`ANTHROPIC_API_KEY` for grade) |
| C9 | Skill: API reference | Corresponding provider key |
| C10 | Skill: Remotion motion | `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY` |
| C11 | MCP server startup | None |
| C12 | Pipeline (script-to-video) | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET` |

---

## Phase 1: Basic Verification (No API Keys Required)

### C1. Build + Unit Tests

Ask Claude Code:

> "Run pnpm build and then run CLI unit tests"

**Expected result:**
- `pnpm build` — Completes without errors
- `pnpm -F @vibeframe/cli exec vitest run` — 240+ tests passing
- `pnpm -F @vibeframe/core exec vitest run` — 8 tests passing

```bash
pnpm build
CI=true pnpm -F @vibeframe/cli exec vitest run
CI=true pnpm -F @vibeframe/core exec vitest run
```

Pass: Build succeeds, all tests pass

---

### C2. CLI `--help` Full Verification

Ask Claude Code:

> "Verify that all top-level commands and ai subcommands respond correctly to --help"

**Expected result:**
- `vibe --version` — Prints current version
- `vibe --help` — Shows full command list
- `vibe ai --help` — Shows 56+ AI subcommands
- All subcommands respond to `--help`

```bash
vibe --version
vibe --help
vibe ai --help
vibe project --help
vibe timeline --help
vibe export --help
vibe batch --help
vibe detect --help
vibe agent --help
vibe setup --help
```

Pass: All commands print help output (exit code 0)

---

## Phase 2: AI Features (CLI via Bash Tool)

### C3. Image Generation

Ask Claude Code:

> "Generate a golden retriever on a beach image with Gemini. Save to test-results/dog.png"

**Expected behavior:** Claude Code runs via Bash tool:
```bash
vibe ai image "a golden retriever on a beach" -o test-results/dog.png
```

Pass: `test-results/dog.png` created, file size > 0

---

### C4. Image Editing

Ask Claude Code:

> "Put sunglasses on the dog in the image we just made"

**Expected behavior:** Claude Code remembers the previous output path and runs:
```bash
vibe ai gemini-edit test-results/dog.png "put sunglasses on the dog" -o test-results/dog-cool.png
```

Pass: `test-results/dog-cool.png` created, different from original

---

### C5. TTS Voice Generation

Ask Claude Code:

> "Create a narration describing the beach scene"

**Expected behavior:**
```bash
vibe ai tts "A golden retriever is playing on a sunny beach." -o test-results/dog-narration.mp3
```

Pass: `test-results/dog-narration.mp3` created, playable MP3

---

### C6. Video Generation

Ask Claude Code:

> "Generate a 5-second video of a golden retriever running on a beach with Kling"

**Expected behavior:**
```bash
vibe ai kling "a golden retriever running on a sunny beach, cinematic slow motion" -o test-results/dog.mp4 -d 5
```

Pass: `test-results/dog.mp4` created (1-2 min generation, silent video)

---

### C7. Project + Timeline + Export

Ask Claude Code:

> "Create a new project, combine dog.mp4 and dog-narration.mp3, and export to test-results/dog-final.mp4"

**Expected behavior:** Claude Code runs multi-step autonomously:
```bash
# Create project
vibe project create dog-video -o test-results/dog-project.vibe.json

# Add sources (parse IDs from output)
vibe timeline add-source test-results/dog-project.vibe.json test-results/dog.mp4
vibe timeline add-source test-results/dog-project.vibe.json test-results/dog-narration.mp3

# Add clips (using parsed source IDs)
vibe timeline add-clip test-results/dog-project.vibe.json <video-source-id>
vibe timeline add-clip test-results/dog-project.vibe.json <audio-source-id>

# Export
vibe export test-results/dog-project.vibe.json -o test-results/dog-final.mp4 -y
```

**Key verification points:**
- Claude Code parses source IDs from command output and uses them in subsequent commands
- Handles errors and retries autonomously if needed

Pass: `test-results/dog-final.mp4` — Final file with video + audio combined

---

### C8. FFmpeg Editing Tools

Ask Claude Code:

> "Apply cinematic-warm color grading to dog-final.mp4, and add 1-second fade in/out"

**Expected behavior:**
```bash
vibe ai grade test-results/dog-final.mp4 -p cinematic-warm -o test-results/dog-warm.mp4
vibe ai fade test-results/dog-warm.mp4 --fade-in 1 --fade-out 1 -o test-results/dog-faded.mp4
```

Pass: Video generated with color correction + fade effects applied

---

## Phase 3: Skills Slash Commands

### C9. API Reference Skill Usage

Invoke slash command in Claude Code:

> `/gemini-image`

**Expected behavior:**
- SKILL.md API reference is loaded into context
- Claude Code can discuss Gemini image API parameters, model options, and error handling
- `disable-model-invocation: true` means it only loads when explicitly invoked

**Verification:**
```
/gemini-image
→ "What's the difference between Gemini Nano Banana Flash and Pro models?"
→ Accurate response based on skill documentation
```

Also verify other skills:
```
/elevenlabs-tts
→ "What voices are available and what speed options exist?"

/kling-video
→ "What's the difference between v2.5 turbo and v2.6?"
```

Pass: Each skill provides accurate API information in context

---

### C10. Remotion Motion Graphics Skill

Ask Claude Code:

> `/remotion-motion`
> "Create a cinematic title card motion graphic over dog.png"

**Expected behavior:**
```bash
vibe ai motion "Animated title card with golden retriever theme" \
  --image test-results/dog.png \
  -o test-results/dog-motion.mp4 -d 5 -s cinematic
```

Pass: `test-results/dog-motion.tsx` + `test-results/dog-motion.mp4` created

---

## Phase 4: MCP Server

### C11. MCP Server Startup Verification

Ask Claude Code:

> "Verify that the MCP server works correctly"

**Expected behavior:**
```bash
# Verify MCP server build
pnpm -F @vibeframe/mcp-server build

# Server start test (3-second timeout)
timeout 3 pnpm mcp 2>&1 || true

# MCP unit tests
CI=true pnpm -F @vibeframe/mcp-server exec vitest run
```

Pass: MCP server builds successfully, tests passing

**MCP Tools (28):**

| Category | Tools |
|----------|-------|
| Project | `project_create`, `project_info` |
| Timeline | `timeline_add_source`, `timeline_add_clip`, `timeline_split_clip`, `timeline_trim_clip`, `timeline_move_clip`, `timeline_delete_clip`, `timeline_duplicate_clip`, `timeline_add_effect`, `timeline_add_track`, `timeline_list` |
| Export | `export_video` |
| AI Editing | `edit_silence_cut`, `edit_jump_cut`, `edit_caption`, `edit_noise_reduce`, `edit_fade`, `edit_text_overlay`, `edit_reframe` |
| AI Analysis | `ai_analyze`, `ai_gemini_video`, `ai_transcribe`, `ai_review` |
| AI Pipelines | `ai_script_to_video`, `ai_highlights`, `ai_auto_shorts`, `ai_viral` |

---

## Phase 5: Pipeline

### C12. Script-to-Video Full Pipeline

Ask Claude Code:

> "Create a 15-second ad about a golden retriever on a beach. Use Runway. Save to test-results/dog-ad/"

**Expected behavior:**
```bash
mkdir -p test-results/dog-ad
vibe ai script-to-video \
  "A 15-second ad featuring a golden retriever on a sunny beach" \
  -g runway -o test-results/dog-ad/

vibe export test-results/dog-ad/project.vibe.json \
  -o test-results/dog-ad/final.mp4 -y
```

**Verification:**
- `test-results/dog-ad/storyboard.json` — Scene breakdown
- `test-results/dog-ad/scene-*.png` — Scene images
- `test-results/dog-ad/scene-*.mp4` — Scene videos
- `test-results/dog-ad/narration-*.mp3` — Scene narrations
- `test-results/dog-ad/project.vibe.json` — Project file
- `test-results/dog-ad/final.mp4` — Final video

Pass: 5-10 minutes, full pipeline complete

---

## Claude Code-Specific Verification Points

Additional items to verify in the Claude Code environment, beyond QUICK_TEST/FUNC_TEST:

### A. Context Continuity

Verify with sequential requests:
1. "Generate an image" → dog.png created
2. "Edit the image we just made" → Remembers dog.png path and runs gemini-edit
3. "Turn that into a video" → Uses edited image as input for video generation

Pass: Claude Code maintains previous output paths and continues the workflow

### B. Error Recovery

Trigger an intentional error:
> "Analyze the file test-results/nonexistent.mp4"

Pass: Reads error message and explains the situation to the user (doesn't retry infinitely)

### C. Command Output Parsing

> "Create a project, add 2 sources, and add clips"

Pass: Parses IDs from each command's output and automatically uses them in subsequent commands

### D. Skills Context Isolation

> `/openai-api`

Pass: `disable-model-invocation: true` prevents skill from loading normally
Pass: Only loads API reference when explicitly invoked via slash command
Pass: No context waste

---

## Results

```
Phase 1: Basic Verification
C1   Build + unit tests:           PASS / FAIL
C2   CLI --help verification:      PASS / FAIL

Phase 2: AI Features (Bash)
C3   Image generation:             PASS / FAIL
C4   Image editing:                PASS / FAIL
C5   TTS voice generation:         PASS / FAIL
C6   Video generation:             PASS / FAIL
C7   Project+timeline+export:      PASS / FAIL
C8   FFmpeg editing tools:         PASS / FAIL

Phase 3: Skills
C9   API reference Skill:          PASS / FAIL
C10  Remotion motion Skill:        PASS / FAIL

Phase 4: MCP
C11  MCP server startup:           PASS / FAIL

Phase 5: Pipeline
C12  Script-to-Video pipeline:     PASS / FAIL

Claude Code-Specific
A    Context continuity:           PASS / FAIL
B    Error recovery:               PASS / FAIL
C    Command output parsing:       PASS / FAIL
D    Skills context isolation:     PASS / FAIL
```
