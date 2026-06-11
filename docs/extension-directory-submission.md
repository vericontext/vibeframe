# Claude Extension Directory Submission — VibeFrame

Working notes + reviewer guide for submitting the VibeFrame Desktop Extension
to the Anthropic Connectors Directory.

- Submission form: <https://clau.de/desktop-extention-submission>
- Artifact: `vibeframe-<version>.mcpb`, attached to every
  [GitHub Release](https://github.com/vericontext/vibeframe/releases) and
  reproducible with `pnpm -F @vibeframe/mcp-server build:mcpb`.

## Form answers (draft)

| Field | Value |
|---|---|
| Extension name | VibeFrame |
| Description | AI-native video editing for Claude Desktop: storyboard → narration/backdrops → HTML/GSAP scenes → rendered MP4, all inside a local workspace folder. |
| Icon | `icon.png` inside the bundle (400×400, also `apps/web/public/logo-400.png`) |
| Documentation | <https://github.com/vericontext/vibeframe/blob/main/packages/mcp-server/README.md> |
| Privacy policy | <https://vibeframe.ai/privacy> (source: repo `PRIVACY.md`) |
| Support | <https://github.com/vericontext/vibeframe/issues> |
| Repository | <https://github.com/vericontext/vibeframe> (MIT) |

## Reviewer quickstart

1. Install the `.mcpb`, set the **Workspace folder** to any empty directory.
2. Machine requirements for the full flow: Google Chrome + `ffmpeg` on PATH.
3. **Test credentials:** all provider keys are reviewer-supplied (extension
   settings fields or a `.env` in the workspace). No VibeFrame account exists.
   A large share of tools needs **no key at all** — the free end-to-end path:
   - `init {"dir":"demo"}` → `storyboard_set` narration → run `npm i kokoro-js`
     once in the workspace → `build {"projectDir":"demo","ttsProvider":"kokoro","skipBackdrop":true}`
     → `render {"projectDir":"demo"}` produces an MP4 with zero paid calls.
   - Provider-backed tools (`generate_*`, `storyboard_revise`, AI edits) need
     the matching key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
     `GOOGLE_API_KEY`, or `ELEVENLABS_API_KEY`.
4. Long `build`/`render` calls return `{promoted: true, jobId}` after ~45s —
   poll `status_job` until completed (by design, not a hang).
5. On hosts with the elicitation capability, `build` asks the user a form
   (narration provider / backdrop images / cost cap) before spending.

For sample media to exercise edit/detect/timeline tools, any short MP4 works:
`ffmpeg -f lavfi -i testsrc=duration=8:size=640x360:rate=30 -f lavfi -i sine=frequency=440:duration=8 -shortest sample.mp4`

## Tool inventory (84) with safety annotations and working examples

Hints legend: **RO** = readOnlyHint:true · **W** = writes (destructiveHint:true
unless noted) · **OW** = openWorldHint:true (calls an external provider).

### Scene pipeline (project → MP4)

| Tool | Hints | Example |
|---|---|---|
| init | W (non-destructive, idempotent) | `{"dir":"demo","duration":30}` |
| storyboard_list | RO | `{"projectDir":"demo"}` |
| storyboard_validate | RO | `{"projectDir":"demo"}` |
| storyboard_get | RO | `{"projectDir":"demo","beat":"hook"}` |
| storyboard_set | W, idempotent | `{"projectDir":"demo","beat":"hook","key":"narration","value":"Hello world."}` |
| storyboard_move | W | `{"projectDir":"demo","beat":"close","after":"hook"}` |
| storyboard_revise | W, OW | `{"projectDir":"demo","request":"Make it 5 beats about coffee","dryRun":true}` |
| plan | RO | `{"projectDir":"demo"}` |
| build | W, OW | `{"projectDir":"demo","ttsProvider":"kokoro","skipBackdrop":true}` |
| render | W | `{"projectDir":"demo","quality":"draft"}` |
| scene_list_styles | RO | `{}` then `{"name":"swiss-pulse"}` |
| scene_add | W, OW | `{"projectDir":"demo","name":"intro","preset":"announcement","headline":"Hi","skipAudio":true,"skipImage":true}` |
| scene_lint | W (auto-fix), idempotent | `{"projectDir":"demo"}` |
| scene_repair | W, idempotent | `{"projectDir":"demo","dryRun":true}` |
| scene_compose_prompts | RO | `{"projectDir":"demo"}` |
| scene_submit | W, idempotent | `{"projectDir":"demo","beat":"hook","html":"<template …>"}` (lint-gated write) |
| scene_install_skill | W, idempotent | `{"projectDir":"demo"}` |
| inspect_project | W (writes review-report.json) | `{"projectDir":"demo"}` |
| inspect_render | W (report) | `{"projectDir":"demo","dryRun":true}` |
| status_project | W (refreshes job cache, non-destructive), OW | `{"projectDir":"demo"}` |
| status_job | W (job cache, non-destructive), OW | `{"jobId":"job_…","projectDir":"demo","wait":true}` |
| guide | RO | `{"topic":"scene"}` |

### Generation (provider keys required)

| Tool | Hints | Example |
|---|---|---|
| generate_speech / generate_narration | W, OW | `{"text":"Hello.","output":"hello.mp3"}` (ElevenLabs) |
| generate_sound_effect | W, OW | `{"prompt":"door knock","output":"knock.mp3"}` |
| generate_music | W, OW | `{"prompt":"calm lo-fi beat"}` |
| generate_music_status | RO, OW | `{"taskId":"<from generate_music>"}` |
| generate_image | W, OW | `{"prompt":"abstract blue gradient","output":"bg.png"}` |
| generate_background | W, OW | `{"description":"editorial background plate","output":"plate.png"}` |
| generate_storyboard | W, OW | `{"content":"A 30s video about tea"}` |
| generate_thumbnail | W, OW | `{"videoPath":"sample.mp4","outputPath":"thumb.png"}` |
| generate_motion | W, OW | `{"description":"counter counting to 100"}` |
| generate_video | W, OW | `{"prompt":"waves at sunset","duration":5}` (high cost — confirm spend) |
| generate_video_status | W (downloads on completion), OW | `{"taskId":"<id>"}` |
| generate_video_cancel | W, OW | `{"taskId":"<id>"}` |
| generate_video_extend | W, OW | `{"videoId":"<id>","prompt":"keep panning"}` |

### Editing (ffmpeg-local unless OW)

| Tool | Hints | Example |
|---|---|---|
| edit_fade | W | `{"videoPath":"sample.mp4","outputPath":"out.mp4","fadeIn":1}` |
| edit_text_overlay | W | `{"videoPath":"sample.mp4","outputPath":"out.mp4","texts":[{"text":"Hi","start":0,"end":3}]}` |
| edit_noise_reduce | W | `{"inputPath":"sample.mp4","outputPath":"out.mp4"}` |
| edit_reframe | W | `{"videoPath":"sample.mp4","aspect":"9:16"}` |
| edit_interpolate | W | `{"videoPath":"sample.mp4","factor":2}` |
| edit_upscale | W | `{"videoPath":"sample.mp4","scale":2}` |
| edit_silence_cut | W, OW (optional Gemini analysis) | `{"videoPath":"sample.mp4","outputPath":"out.mp4"}` |
| edit_caption | W, OW (Whisper) | `{"videoPath":"sample.mp4","outputPath":"out.mp4"}` |
| edit_animated_caption | W, OW (Whisper) | `{"videoPath":"sample.mp4","outputPath":"out.mp4"}` |
| edit_jump_cut | W, OW (Whisper) | `{"videoPath":"sample.mp4","outputPath":"out.mp4"}` |
| edit_speed_ramp | W, OW | `{"videoPath":"sample.mp4"}` |
| edit_grade | W, OW (custom styles use Claude) | `{"videoPath":"sample.mp4","style":"cinematic"}` |
| edit_motion_overlay | W, OW (generated overlays use LLM) | `{"videoPath":"sample.mp4","description":"confetti burst"}` |
| edit_translate_srt | W, OW | `{"srtPath":"subs.srt","outputPath":"subs.ko.srt","targetLanguage":"Korean"}` |
| edit_image | W, OW | `{"imagePaths":["bg.png"],"prompt":"make it warmer"}` |
| edit_fill_gaps | W, OW | `{"projectPath":"timeline.json","dryRun":true}` (high cost) |

### Audio

| Tool | Hints | Example |
|---|---|---|
| audio_duck | W | `{"musicPath":"music.mp3","voicePath":"voice.mp3"}` |
| audio_transcribe | W, OW (Whisper) | `{"audioPath":"sample.mp4","format":"srt"}` |
| audio_isolate | W, OW (ElevenLabs) | `{"audioPath":"sample.mp4"}` |
| audio_clone_voice | W (additive: creates a new remote voice), OW | `{"samplePaths":["voice.mp3"],"name":"Reviewer Test"}` |
| audio_dub | W, OW | `{"mediaPath":"sample.mp4","language":"Spanish"}` |

### Analysis & detection (key-free except AI inspects)

| Tool | Hints | Example |
|---|---|---|
| detect_scenes | W (optional report), idempotent | `{"videoPath":"sample.mp4"}` |
| detect_silence | W (report), idempotent | `{"mediaPath":"sample.mp4"}` |
| detect_beats | W (report), idempotent | `{"audioPath":"sample.mp4"}` |
| inspect_media | RO, OW (Gemini) | `{"source":"bg.png","prompt":"Describe this image"}` |
| inspect_video | RO, OW (Gemini) | `{"source":"sample.mp4","prompt":"Summarize"}` |
| inspect_review | W (autoApply), OW | `{"videoPath":"sample.mp4"}` |
| inspect_suggest | W (apply), OW | `{"projectPath":"timeline.json","instruction":"tighten pacing"}` |

### Timeline & export (key-free, fully local)

| Tool | Hints | Example |
|---|---|---|
| timeline_create | W | `{"name":"cut1"}` |
| timeline_info / timeline_list | RO | `{"projectPath":"timeline.json"}` |
| timeline_add_source | W | `{"projectPath":"timeline.json","mediaPath":"sample.mp4"}` |
| timeline_add_clip | W | `{"projectPath":"timeline.json","sourceId":"<id>"}` |
| timeline_split_clip | W | `{"projectPath":"timeline.json","clipId":"<id>","splitTime":2}` |
| timeline_trim_clip | W | `{"projectPath":"timeline.json","clipId":"<id>","end":4}` |
| timeline_move_clip | W | `{"projectPath":"timeline.json","clipId":"<id>","newStart":1}` |
| timeline_duplicate_clip | W | `{"projectPath":"timeline.json","clipId":"<id>"}` |
| timeline_delete_clip | W | `{"projectPath":"timeline.json","clipId":"<id>"}` |
| timeline_add_effect | W | `{"projectPath":"timeline.json","clipId":"<id>","effectType":"fade-in"}` |
| timeline_add_track | W | `{"projectPath":"timeline.json","trackType":"audio"}` |
| export_video | W | `{"projectPath":"timeline.json","outputPath":"final.mp4"}` |
| project_list | RO | `{}` (lists workspace projects) |
| project_create | W | `{"name":"demo-project"}` |
| project_info | RO | `{"projectPath":"timeline.json"}` |

### Pipelines

| Tool | Hints | Example |
|---|---|---|
| remix_highlights | W, OW | `{"media":"sample.mp4","count":2}` |
| remix_auto_shorts | W, OW | `{"video":"sample.mp4","count":1}` |
| remix_regenerate_scene | W, OW | `{"projectDir":"demo","scenes":[1],"dryRun":true}` |
| run | W, OW (very high cost) | `{"file":"pipeline.yaml","dryRun":true}` |

## Compliance checklist

- [x] manifest_version 0.3, `privacy_policies` (HTTPS), `icon`, `documentation`, `support`
- [x] Every tool ships `title` + `readOnlyHint`/`destructiveHint` (+ explicit `openWorldHint`); enforced by `packages/mcp-server/src/index.test.ts`
- [x] Privacy Policy in README + `PRIVACY.md` + <https://vibeframe.ai/privacy>
- [x] Setup/usage docs in `packages/mcp-server/README.md`
- [x] Support channel: GitHub issues
- [x] Human-in-the-loop: server instructions + elicitation gate paid choices before spend
