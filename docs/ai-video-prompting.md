# AI video prompting playbook — character sheet → image storyboard → multi-scene video

A practical, copy-paste guide for the workflow that produces consistent,
directed multi-scene AI video:

1. **Character sheet** — lock the character once (image model).
2. **Image storyboard** — generate one keyframe still per scene, editing the
   sheet so the character stays consistent (image model).
3. **Animate** — turn each keyframe into a clip with Seedance **image-to-video**.
4. **Assemble** — compose the scenes into one cut and render.

> **Why image-to-video, not text-to-video, for every scene after the first?**
> Lock the composition as a still you can review, then animate it. You get far
> more control over framing, character, and continuity than letting the video
> model invent each shot from text.
> ([seedance.tv](https://www.seedance.tv/blog/seedance-character-consistency-guide-2026),
> [deepfiction.ai](https://www.deepfiction.ai/blog/ai-filmmaking-pipeline-script-to-screen-2026))

These map directly onto VibeFrame primitives:

| Step | Hand-run command | Storyboard build |
| --- | --- | --- |
| Character sheet | `vibe generate image "<sheet>" -p openai -o assets/character-nova.png` | `characters:` frontmatter (auto-generated once) |
| Scene keyframe | `vibe edit image assets/character-nova.png "<scene>" -o assets/keyframe-s1.png` | per-beat `keyframe:` cue (+ `characters:`) |
| Animate | `vibe generate video "<motion>" -i assets/keyframe-s1.png -p seedance` | `keyframe:` + `video:` cues, run by `vibe build` |
| Assemble | compose + `vibe render` | `vibe build` |

---

## Part 1 — Image model (GPT Image 2 / Nano Banana Pro)

GPT Image 2 (`-p openai`, default) is the workhorse. **Nano Banana Pro** (Gemini
3 Pro Image, `-p gemini`) is the most-requested image model on fal and a strong
pick for hero keyframes when quality matters most.
([fal.ai](https://fal.ai/learn/tools/prompting-gpt-image-2),
[dev.to](https://dev.to/juddiy/nano-banana-from-image-consistency-to-high-quality-video-generation-2hhe))

### Prompt structure (order matters)

```
[purpose/context] → [scene/background] → [subject/character] →
[key details: materials, wardrobe, expression] → [style/medium] →
[quality cues: lighting, mood, depth] → [constraints: keep / exclude]
```
([OpenAI cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide))

### Template A — character sheet (do this once)

```
Character turnaround reference sheet of an original fictional character named NOVA:
<age, build, face, hair color + style, wardrobe head-to-toe, demeanor>.
Show front view, side profile, and back view side by side on one clean canvas,
plus four facial-expression thumbnails and a small color-palette swatch row.
Identical outfit, hairstyle, hair color, and body proportions across all views.
Plain light-grey studio background, even neutral lighting, no props.
Photorealistic, professional character-design-sheet layout, readable labels.
```

### Template B — scene keyframe by editing the sheet (the storyboard panel)

Feed the sheet as a reference and **restate the identity invariants** — the model
does not carry character design forward on its own; say it every time.
([OpenAI cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide),
[laozhang.ai](https://blog.laozhang.ai/ai-tools/mastering-character-consistency-chatgpt-image-generator/))

```
Image 1 is the NOVA character sheet. Place NOVA — same face, same hair, same
<wardrobe> — into this scene: <location, time of day, what she is doing>.
Framing: <e.g. low-angle hero shot, waist-up three-quarter>.
Lighting: <one strong lighting idea>. Mood: <…>. Cinematic, photorealistic.
Keep her exact likeness, hairstyle, wardrobe, and proportions. Change only the
setting and pose.
```

- **`vibe edit image` accepts multiple input images** — pass the sheet (and, if
  you have them, a couple of extra angles) so identity is well-anchored. GPT
  Image 2 accepts up to ~8 reference images.
- For identity-sensitive edits on `gpt-image-1.5/1`, the API exposes
  `input_fidelity="high"`; on `gpt-image-2` lean on explicit preservation
  language + a clean sheet instead.

### Consistency checklist (image)

- **Restate invariants every time** (face, hair, wardrobe, proportions). Never
  assume context carries over.
- **Fixed seed + fixed identity phrasing** → stable composition/identity across
  runs.
- **Index your references** ("Image 1: …, Image 2: …") and state what to
  **preserve** vs **change**.
- `quality: high` for identity-sensitive frames; keep size edges multiples of 16,
  aspect ≤ 3:1, ≤ 2560×1440.
- Put any on-screen text in `"quotes"`/ALL CAPS.

---

## Part 2 — Video model (Seedance 2.0)

Seedance wants **cinematic direction, not image keywords** — write the prompt
like a shot list for a DP, not a tag soup.
([fal.ai](https://fal.ai/learn/tools/how-to-use-seedance-2-0),
[apiyi](https://help.apiyi.com/en/seedance-2-0-prompt-guide-video-generation-camera-style-tips-en.html))

### The 6-step formula (60–100 words)

```
[Subject] , [Action: specific verb + intensity] , in [Environment + lighting] ,
camera [ONE movement] , style [specific reference] , avoid [unwanted effects]
```

### The 8 camera moves (pick exactly ONE)

push-in/dolly-in · pull-out/dolly-out · pan · tracking/follow · orbit/arc ·
aerial/drone · handheld · fixed/locked-off.
**Multiple conflicting camera instructions = jitter.**

### Template C — image-to-video (animating a keyframe)

Describe **motion only** — do not redescribe the still.

```
Animate the provided image. Preserve composition, character, and colors.
<one motion: e.g. slow cinematic push-in as she looks up; heat haze rising>.
Camera: <one move>. Consistent lighting. 5 seconds, 16:9.
Avoid jitter, bent limbs, temporal flicker, identity drift.
```

### Template D — reference-to-video (keep one look across shots)

Reuse the **same reference image** across shots instead of new references each
time. Start with **one** reference type and add control gradually — too many
references degrades results.
([magichour.ai](https://magichour.ai/blog/seedance-20-reference-guide))

```
The character is the person in the reference image (identity locked).
<subject>, <action>, in <environment + lighting>, camera <one move>,
style <reference>, avoid identity drift and temporal flicker.
```

In VibeFrame: `-i <img>` drives **image-to-video** (the keyframe as first frame);
`--ref-images a.png b.png` drives **reference-to-video** (appearance reference).

### Parameter cheat-sheet

- Duration **4–15 s** · resolution up to **2K** · aspect from your project (16:9…).
- Audio: up to 3 clips, < 15 s / < 15 MB each · max **12** reference files total.
- Cost scales with resolution × duration; image-to-video uses standard pricing
  (no reference discount). Always `vibe build --dry-run` and cap with `--max-cost`.

### Do / don't

- ✅ One camera move · one strong **lighting** idea (highest-impact lever) ·
  change one variable per iteration.
- ❌ "fast" unqualified · stacked vague adjectives ("epic", "amazing") ·
  photography jargon (f/2.8, ISO, focal length) · real identifiable faces ·
  multiple simultaneous camera moves.
- Useful negative prompts: `avoid jitter, bent limbs, temporal flicker, identity drift`.

---

## Part 3 — Multi-scene continuity recipe

The craft that separates a one-off clip from a coherent piece: **scene 1
establishes the character; every later scene repeats the same identity anchors
and animates a locked keyframe.**
([seedance.tv](https://www.seedance.tv/blog/seedance-character-consistency-guide-2026))

### 1. Write a character bible

Face, hair, wardrobe rules, expression style, movement style, and explicit
**do-not-change** rules. This text becomes your reusable **identity block**:

```
NOVA — the same woman from the reference: late-20s racing engineer, low ponytail,
teal team jacket over a dark shirt, dark trousers, calm focused expression.
```

### 2. Plan the full shot list before generating

5+ scenes, each with: location, action, framing, camera move. Start identity on
**low-risk angles** (medium / three-quarter / slow push-in); avoid extreme
close-ups, silhouettes, backlight, and fast motion until the look is established.

### 3. Per-scene prompt = 6 blocks

```
1. Identity block      — the exact reusable phrasing above
2. Scene block         — location + context
3. Action block        — what she does
4. Camera block        — one framing + one move
5. Continuity statement — "the same person as the previous scene"
6. Negative prompt      — "no different person, no face morph, no age/hair/outfit change"
```

### 4. Generate in sequence, then repair

- Generate the **keyframe still** for each scene (Template B), then **animate**
  it (Template C). Generate scenes **in order**, not in isolation.
- Run a continuity check before approving each shot.
- **Repair only weak scenes, one variable at a time** (clarify the identity
  block, tighten the negative prompt, reduce scene complexity, or swap to a
  cleaner reference).

### End-to-end with VibeFrame today

```bash
# 1. character sheet (once)
vibe generate image "<Template A>" -p openai -o assets/character-nova.png

# per scene: 2. keyframe still   3. animate it
vibe edit image assets/character-nova.png "<Template B for scene 1>" -o assets/keyframe-s1.png
vibe generate video "<Template C motion>" -i assets/keyframe-s1.png -p seedance -o assets/video-s1.mp4
# …repeat for s2, s3, … reusing the same identity block …

# Or drive it from a storyboard: each beat gets `characters: [nova]` + a
# `keyframe:` cue (the still) + a `video:` cue (the motion), then:
vibe build my-film --dry-run            # review per-scene keyframe + clip cost
vibe build my-film --max-cost <budget>  # generate + compose + render
```

See `docs/projects.md` → "Keyframe → image-to-video" for the storyboard cue.

---

## Sources

- [OpenAI — GPT image models prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)
- [fal.ai — prompting GPT Image 2](https://fal.ai/learn/tools/prompting-gpt-image-2) · [How to use Seedance 2.0](https://fal.ai/learn/tools/how-to-use-seedance-2-0)
- [Seedance 2.0 official prompt guide (6-step formula, camera moves, pitfalls)](https://help.apiyi.com/en/seedance-2-0-prompt-guide-video-generation-camera-style-tips-en.html)
- [Seedance character-consistency guide](https://www.seedance.tv/blog/seedance-character-consistency-guide-2026) · [Seedance reference guide](https://magichour.ai/blog/seedance-20-reference-guide)
- [Mastering character consistency (ChatGPT image)](https://blog.laozhang.ai/ai-tools/mastering-character-consistency-chatgpt-image-generator/)
- [AI filmmaking pipeline 2026](https://www.deepfiction.ai/blog/ai-filmmaking-pipeline-script-to-screen-2026) · [Nano Banana → video](https://dev.to/juddiy/nano-banana-from-image-consistency-to-high-quality-video-generation-2hhe)
