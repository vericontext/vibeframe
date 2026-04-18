# Phase 1 Part B — Hyperframes Adapter Implementation Plan

**Target release**: v0.47.0 (experimental `--backend hyperframes`)
**Tracking issue**: [#37](https://github.com/vericontext/vibeframe/issues/37)
**Status**: ready to execute in a fresh session
**Prereqs**: `docs/discovery/lottie-hyperframes.md`, `docs/design/hyperframes-adapter.md`

This document is the **single source of truth** for Part B. A new session should be able to open this file and start at Module 1, Step 1B.1 without rereading prior context.

---

## Context brief (read this first if you're a fresh session)

Part A already landed (`33dbc93`):
- Discovery validated `@hyperframes/producer@0.4.4` — library API is clean, ESM, full TS types, 5.2s to render 120 frames in the probe. License is Apache 2.0 (npm `package.json` wrongly says "Proprietary" — metadata bug, ignore).
- Design doc `docs/design/hyperframes-adapter.md` has the full wiring plan, effect mapping table, HTML template skeleton, and phased delivery (v0.47 → v0.50).
- Scaffold exists at `packages/cli/src/pipeline/renderers/{types,hyperframes}.ts`. Both files compile but `render()` returns a not-implemented error. `aspectToResolution()` and `qualityToCrf()` helpers are already correct.
- Probe project at `~/dev/vibe-probes/hf-probe/` has a working minimal render — reuse as a reference implementation.

What Part B delivers:
- Real `renderToHtmlProject(state)` → writes `<tmp>/index.html` + assets
- Real `render()` → calls `createRenderJob` / `executeRenderJob` and returns `RenderResult`
- CLI flag `vibe export --backend hyperframes` and YAML `render.backend: hyperframes`
- `vibe doctor` detects Chrome
- Tests (unit + integration)
- v0.47.0 release

**Non-goals this phase**: Lottie overlay (Phase 2), text-heavy layouts (Phase 2), transitions (Phase 3), default-backend switch (Phase 4).

---

## Work breakdown — 6 modules, 20 sub-tasks

Estimated total: **10–17 engineering days** (1.5–2.5 weeks).

| Module | Sub-tasks | Days |
|---|---|---|
| M1 HTML generator | 1B.1 – 1B.7 | 3–5 |
| M2 Asset resolution | 2B.1 – 2B.4 | 1–2 |
| M3 Adapter real impl | 3B.1 – 3B.5 | 2–3 |
| M4 CLI integration | 4B.1 – 4B.4 | 1–2 |
| M5 Testing | 5B.1 – 5B.3 | 2–3 |
| M6 Docs + release | 6B.1 – 6B.5 | 1–2 |

---

## Module 1 — HTML generator (3–5 days)

Goal: pure `generateCompositionHtml(state: TimelineState) → string` that produces a self-contained HTML document implementing `window.__hf`.

### 1B.1 — Fixture timeline
File: `packages/cli/src/pipeline/renderers/__tests__/fixtures/simple-2clip.vibe.json`

Minimal project: two image clips back-to-back (0–3s, 3–6s), one with fadeIn effect (0–0.5s), total duration 6s, aspect 16:9, 30fps. No video/audio clips — start easy.

DoD: `Project.fromJSON()` loads without errors; `state.project.duration === 6`.

### 1B.2 — Template renderer
File: `packages/cli/src/pipeline/renderers/html-template.ts`

```ts
export function generateCompositionHtml(state: TimelineState): string {
  const { width, height } = aspectToResolution(state.project.aspectRatio);
  const clipMarkup = buildClipElements(state);
  const mediaJson = JSON.stringify(buildMediaDeclarations(state));
  const clipsJson = JSON.stringify(buildClipRuntimeData(state));
  return BASE_TEMPLATE
    .replace("{W}", String(width))
    .replace("{H}", String(height))
    .replace("{CLIPS_HTML}", clipMarkup)
    .replace("{DURATION}", String(state.project.duration))
    .replace("{MEDIA_JSON}", mediaJson)
    .replace("{CLIPS_JSON}", clipsJson);
}
```

`BASE_TEMPLATE` is the HTML string from `docs/design/hyperframes-adapter.md` section "HTML generation". Keep it as a const at the top of the file, no templating library.

DoD: given fixture, returns a string that contains `<!DOCTYPE html>`, one `<div class="clip">` per clip, `window.__hf = {`, and valid JSON for `clips` and `media`.

### 1B.3 — Clip DOM markup
File: `packages/cli/src/pipeline/renderers/html-clips.ts`

```ts
export function buildClipElements(state: TimelineState): string {
  return state.clips
    .map(clip => {
      const source = state.sources.find(s => s.id === clip.sourceId)!;
      const track = state.tracks.find(t => t.id === clip.trackId)!;
      const zIndex = track.order;
      switch (source.type) {
        case "image": return `<div id="${clip.id}" class="clip" style="z-index:${zIndex};"><img src="${relAsset(source)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
        case "video": return `<div id="${clip.id}" class="clip" style="z-index:${zIndex};"><video id="${clip.id}-media" src="${relAsset(source)}" style="width:100%;height:100%;object-fit:cover;"></video></div>`;
        case "audio": return `<audio id="${clip.id}-media" src="${relAsset(source)}"></audio>`;
        default: return `<!-- unsupported source type: ${source.type} -->`;
      }
    })
    .join("\n");
}
```

`relAsset(source)` returns `assets/<basename-of-source.url>` — the M2 asset-copy step makes sure that path resolves.

DoD: For each clip in the fixture, a DOM element is emitted with correct id, z-index, and asset src.

### 1B.4 — Seek function payload
File: `packages/cli/src/pipeline/renderers/html-runtime.ts`

The actual JS that runs in the browser. Embedded into the HTML as a `<script>` block. Two functions:

1. `interpolateKeyframes(keyframes, elapsedInEffect)` — handles linear/easeIn/easeOut/easeInOut. Reference: `@vibeframe/core` already has an easing util; if not, write 5 lines.
2. `applyEffects(el, effects, clipTime)` — iterate active effects, compose CSS `filter` string + `opacity`.

Main `seek(t)`:
```js
for (const c of CLIPS) {
  const el = document.getElementById(c.id);
  const active = t >= c.startTime && t < c.startTime + c.duration;
  el.style.display = active ? 'block' : 'none';
  if (active) applyEffects(el, c.effects, t - c.startTime);
}
```

DoD: Given a fixture clip with a fadeIn 0–0.5s, `seek(0.0)` puts opacity=0, `seek(0.25)` ≈ 0.5, `seek(0.5)` = 1.0. Unit-testable in Node via jsdom.

### 1B.5 — Media declarations
```ts
export function buildMediaDeclarations(state: TimelineState): HfMediaElement[] {
  return state.clips
    .map(c => ({ clip: c, source: state.sources.find(s => s.id === c.sourceId)! }))
    .filter(({ source }) => source.type === "video" || source.type === "audio")
    .map(({ clip, source }) => ({
      elementId: source.type === "audio" ? `${clip.id}-media` : `${clip.id}-media`,
      src: relAsset(source),
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
      mediaOffset: clip.sourceStartOffset ?? 0,
      volume: 1,
      hasAudio: true,
    }));
}
```

DoD: for a fixture with one video + one audio, returns 2-element array with correct offsets.

### 1B.6 — Keyframe interpolation correctness
This is the highest-risk piece — visual output depends on it being deterministic and matching the existing FFmpeg backend's expectations where possible.

- Single-source-of-truth for easing math: extract to `packages/core/src/effects/easing.ts` if not already there, then import in both browser runtime (via string template) and Node unit tests.
- For fadeIn/fadeOut the FFmpeg backend applies them as video-level `fade` filter — replicate exact opacity curve so users get the same result across backends.

DoD: Property-based test: `applyEffects` with a known keyframe set and 60 sample times matches a reference table ±0.001.

### 1B.7 — Unit tests
File: `packages/cli/src/pipeline/renderers/html-template.test.ts`

Tests:
- `generateCompositionHtml(fixture)` produces valid HTML (parseable by a tolerant parser)
- Contains the right number of `.clip` elements
- `window.__hf.duration` matches `state.project.duration`
- JSON-embedded `clips` array has all clip ids
- jsdom-loaded HTML exposes `window.__hf` with `seek` function
- After `seek(1.5)` with a fixture, only the expected clip is `display: block`

DoD: `pnpm -F @vibeframe/cli test html-template` → all pass, ≥80% line coverage on the three new files.

---

## Module 2 — Asset resolution (1–2 days)

Goal: when `render()` is called, materialize a temp project directory with `index.html` + all referenced media.

### 2B.1 — Temp project builder
File: `packages/cli/src/pipeline/renderers/project-builder.ts`

```ts
export async function buildTempProject(state: TimelineState): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibeframe-hf-"));
  await mkdir(path.join(dir, "assets"), { recursive: true });
  for (const source of state.sources) {
    const dest = path.join(dir, "assets", path.basename(source.url));
    await copyFile(resolveSourceUrl(source.url), dest);
  }
  const html = generateCompositionHtml(state);
  await writeFile(path.join(dir, "index.html"), html, "utf-8");
  return dir;
}
```

### 2B.2 — URL resolver
`resolveSourceUrl(url)`:
- `file://path` → absolute path
- `http(s)://...` → download to temp, return local path (reuse `utils/downloadVideo` or similar if available)
- Plain absolute path → as-is
- Relative → resolve against project file's dir

### 2B.3 — Cleanup strategy
Return a handle:
```ts
export interface TempProject {
  dir: string;
  cleanup: () => Promise<void>;   // rm -rf dir
}
```

Caller (adapter) defers cleanup until after `executeRenderJob` resolves OR fails. On failure, keep the dir and log its path so users can inspect.

### 2B.4 — Deduplication
If two clips reference the same source, copy once. Use a `Map<sourceId, destPath>` during copy.

DoD: for fixture with 2 image clips + 1 shared audio, temp dir has exactly 3 files in `assets/`. HTML references work when the dir is served locally.

---

## Module 3 — Adapter real implementation (2–3 days)

### 3B.1 — Add dependency
```bash
pnpm -F @vibeframe/cli add @hyperframes/producer
```

Watch for:
- ESM import resolution in our TSC output (we're already `"type": "module"` in cli's build)
- Chromium **not bundled** — Puppeteer is a peer. We don't add full `puppeteer` — we add a resolver (see 3B.2).

### 3B.2 — `preflight()` — Chrome resolution
```ts
async preflight() {
  const fromEnv = process.env.HYPERFRAMES_CHROME_PATH || process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return { ok: true };

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { ok: true };
  }
  return {
    ok: false,
    reason: "Chrome not found. Set HYPERFRAMES_CHROME_PATH, or install Chrome (macOS: brew install --cask google-chrome).",
  };
}
```

### 3B.3 — `render()` full pipeline
```ts
async render(options: RenderOptions) {
  const pre = await this.preflight();
  if (!pre.ok) return { success: false, error: pre.reason };

  const { buildTempProject } = await import("./project-builder.js");
  const { createRenderJob, executeRenderJob } = await import("@hyperframes/producer");

  const project = await buildTempProject(options.projectState);
  const job = createRenderJob({
    fps: options.fps ?? 30,
    quality: options.quality ?? "standard",
    format: options.format ?? "mp4",
    entryFile: "index.html",
    crf: qualityToCrf(options.quality),
  });

  const start = Date.now();
  try {
    await executeRenderJob(job, project.dir, options.outputPath, (j, msg) => {
      options.onProgress?.(j.progress ?? 0, j.currentStage ?? msg);
    }, options.signal);
    return {
      success: true,
      outputPath: options.outputPath,
      durationMs: Date.now() - start,
      framesRendered: job.framesRendered,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Only clean up on success — keep temp dir on failure for inspection
    if (job.status === "complete") await project.cleanup();
  }
}
```

### 3B.4 — Progress translation
Hyperframes emits stages `compiling → extracting → preprocessing → capture → encoding → assembling → complete`. Map each to VibeFrame's usual 0-100 progress with human-readable stage label. Spinner logic lives in `run.ts` / `export.ts` — adapter just forwards.

### 3B.5 — Error taxonomy
Common failures and how to surface them:

| Failure | How detected | Surfaced as |
|---|---|---|
| Chrome missing | `preflight()` fails | `authError`-style structured error with suggestion |
| Source file not found | `buildTempProject` throws on copyFile | `notFoundError(path)` |
| Composition duration === 0 | engine probe returns 0 | `usageError("window.__hf.duration was 0 — check timeline has clips")` |
| Frame capture timeout | `executeRenderJob` throws `RenderCancelledError` w/ `reason=timeout` | `apiError(msg, retryable=true)` |
| User cancels (signal) | `RenderCancelledError` w/ `reason=user_cancelled` | exit code 0, no error |

DoD: Adapter returns structured `RenderResult`, never throws up to caller. All 5 failure modes covered by unit tests using mock producer.

---

## Module 4 — CLI integration (1–2 days)

### 4B.1 — `vibe export --backend`
File: `packages/cli/src/commands/export.ts`

Add option:
```ts
.option("--backend <name>", "Render backend: ffmpeg (default) | hyperframes (experimental)", "ffmpeg")
```

In the action: if `backend === "hyperframes"`, skip the existing FFmpeg path and instead:
```ts
const { createHyperframesBackend } = await import("../pipeline/renderers/hyperframes.js");
const backend = createHyperframesBackend();
const result = await backend.render({ projectState, outputPath, onProgress: spinnerCb });
```

DoD: `vibe export project.vibe.json -o out.mp4` unchanged behavior. `vibe export project.vibe.json -o out.mp4 --backend hyperframes` runs through adapter.

### 4B.2 — YAML `render` block
File: `packages/cli/src/pipeline/types.ts`

Add:
```ts
export interface PipelineRenderConfig {
  backend?: "ffmpeg" | "hyperframes";
  fps?: 24 | 30 | 60;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
}

export interface PipelineManifest {
  // ...existing
  render?: PipelineRenderConfig;
}
```

File: `packages/cli/src/commands/run.ts`

When an export/render step runs, read `manifest.render.backend` and forward to the backend factory.

Note: in Phase 1, `vibe run` pipelines don't currently emit a final export step as a first-class action — this is a good moment to add `action: export` to the pipeline executor so `render.backend` has a place to apply. Add to `PipelineAction` union and `ACTION_HANDLERS`.

### 4B.3 — CLI flags override YAML
Same pattern as budget: CLI flag `--backend xxx` overrides `manifest.render.backend`.

### 4B.4 — `vibe doctor` Chrome check
File: `packages/cli/src/commands/doctor.ts`

Add a new section `OPTIONAL_TOOLS.chrome`:
```ts
chrome: {
  commands: ["export --backend hyperframes", "run with render.backend=hyperframes"],
  install: "macOS: brew install --cask google-chrome · Linux: apt install chromium",
}
```

Detection logic reuses the `preflight()` candidate list. Include the resolved path in `--json` output.

DoD: `vibe doctor --json` returns a structured section showing whether Chrome is available and where.

---

## Module 5 — Testing (2–3 days)

### 5B.1 — Unit
- `html-template.test.ts` — already drafted in 1B.7
- `project-builder.test.ts` — asset copy, dedup, cleanup
- `hyperframes.test.ts` — `preflight` candidate resolution, `render` error handling (mock producer via vi.mock)

### 5B.2 — Integration (non-probe, inside repo)
File: `packages/cli/src/pipeline/renderers/__tests__/integration.test.ts`

Skip if Chrome not present (`beforeAll` calls preflight). Test:
```ts
it("renders a 2-image composition to mp4", async () => {
  const state = loadFixture("simple-2clip.vibe.json");
  const backend = createHyperframesBackend();
  const out = tempPath("out.mp4");
  const result = await backend.render({ projectState: state, outputPath: out, fps: 30, quality: "draft" });
  expect(result.success).toBe(true);
  expect(existsSync(out)).toBe(true);
  const { duration } = await ffprobe(out);
  expect(duration).toBeCloseTo(state.project.duration, 1);
});
```

Draft quality + 2 image clips → <10 seconds runtime on dev machine.

### 5B.3 — Regression
Run full existing test suite (`pnpm test`) after changes — ensure FFmpeg backend still passes all export tests. Ensure no new lint errors (`pnpm lint`).

DoD: all 231 existing tests still pass, +≥10 new tests covering the new path.

---

## Module 6 — Docs + release (1–2 days)

### 6B.1 — README additions
Add a short "Render backends" section under Quick Start, mark Hyperframes as **experimental in v0.47**.

### 6B.2 — Examples
- `examples/hyperframes-demo.yaml` — minimal 2-step pipeline (generate-image × 2) that renders via hyperframes backend
- `examples/simple-2clip.vibe.json` — the fixture, shipped so users can run it
- `docs/how-to/hyperframes-backend.md` — 1-page how-to with Chrome install

### 6B.3 — Release v0.47.0
Standard flow: `npm version minor` across packages, `git-cliff --tag v0.47.0`, commit, tag, push, verify CI + npm publish.

### 6B.4 — Changelog entry
One paragraph in `CHANGELOG.md` under `## [0.47.0]`:
> Adds experimental `--backend hyperframes` for HTML-native rendering. Composes VibeFrame timelines through Hyperframes' Chrome BeginFrame engine, unlocking CSS animations, GSAP, and Lottie overlays (Phase 2). Opt-in only; FFmpeg remains default.

### 6B.5 — #37 close / #36 subsume
- Comment on #37 with release summary
- Close #36 with a pointer: "Lottie overlay support lands on top of this in v0.48 (Phase 2 in `docs/plans/phase2-lottie.md`)" — or keep #36 open and pivot its scope to "Lottie via Hyperframes" once Phase 2 plan is drafted.

DoD: v0.47.0 live on npm, CI green, #37 closed, README/landing reflect the new feature.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Chromium resolution varies per machine | High | High | `preflight()` checked early; `vibe doctor` surfaces; env var escape hatch |
| `HfMediaElement.mediaOffset` behaves unexpectedly with trimmed clips | Medium | High | Isolate in 5B.2 integration test with a 10s source trimmed to 3–7s; inspect audio sync in output |
| `@hyperframes/producer` bundles 27MB of fonts | Certain | Medium | Document; consider peer-dep pattern in v0.48 if install time is a complaint |
| Chrome BeginFrame is flaky on macOS headless shell | Medium | Medium | Adapter forwards `forceScreenshot: true` config if `HYPERFRAMES_FORCE_SCREENSHOT=1` set |
| Text/transition coverage absent | High | Low | Marked experimental; `vibe doctor` warns when user runs `--backend hyperframes` on a project containing unsupported effects |
| CI runners don't have Chrome | Certain | Medium | Integration test gated on preflight; `CI=1` skips; standalone CI job installs Chrome via action |

---

## Dependencies to add

```json
// packages/cli/package.json — dependencies
"@hyperframes/producer": "^0.4.4"
```

No other new deps. `puppeteer-core` comes transitively.

---

## Success criteria (v0.47.0 ship gate)

- [ ] All 20 sub-tasks closed
- [ ] `vibe export project.vibe.json -o out.mp4 --backend hyperframes` renders a real mp4 from the fixture
- [ ] `vibe run pipeline-with-render.yaml` (YAML backend select) works end-to-end
- [ ] `vibe doctor --json` shows Chrome section
- [ ] Existing 231+ tests pass; ≥10 new tests
- [ ] CI green, npm published, v0.47.0 tag
- [ ] README and landing updated
- [ ] #37 comment explaining what landed

---

## How to start the next session

```
/compact
# open this file
cat docs/plans/phase1b-hyperframes-implementation.md | head -60
# start at Module 1, Step 1B.1
```

Prompt for the fresh session: *"Pick up Phase 1 Part B from `docs/plans/phase1b-hyperframes-implementation.md`. Start at 1B.1 (fixture). Work through modules in order. Don't rework Part A. Prereq: verify Chrome is installed (`which "google-chrome" || ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`). If not, stop and ask."*

### User preparation checklist (before next session)

- [ ] Chrome installed (`brew install --cask google-chrome` on macOS)
- [ ] Optional: `HYPERFRAMES_CHROME_PATH` in `~/.env` if using non-default location
- [ ] `pnpm install` to make sure lockfile clean
- [ ] ~2 free hours for Module 1 (HTML generator is the meatiest piece)

---

## Out of scope (tracked for later phases)

- Phase 2: Lottie overlay via `<dotlottie-player>` (Module 1B.3 already leaves room for it — new `source.type === "lottie"`)
- Phase 3: Text clips with rich typography, transitions
- Phase 4: Default-backend switch + deprecate FFmpeg path for AI-generated content

Follow-up issue drafts to open when v0.47 ships:
- "Phase 2: Lottie overlay via Hyperframes adapter"
- "Phase 3: Text + transitions for Hyperframes backend"
- "Windows Chrome path verification"
