/**
 * @module _shared/compose-prompts
 *
 * Agentic compose primitive. Reads `STORYBOARD.md` + `DESIGN.md`
 * from a scene project and emits a structured plan for the host agent
 * (Claude Code, Cursor, Codex, Aider) to author per-beat HTML files
 * itself. **No LLM call from inside the CLI** — that's the point. The
 * CLI is the deterministic toolbelt; the host agent is the sole reasoner.
 *
 * Output shape:
 *
 *   {
 *     "projectDir": "<abs>",
 *     "designReference":     "DESIGN.md",
 *     "storyboardReference": "STORYBOARD.md",
 *     "skillReference":      ".agents/skills/hyperframes/SKILL.md",
 *     "compositionsDir":     "compositions",
 *     "beats": [
 *       { "id": "hook", "outputPath": "compositions/scene-hook.html",
 *         "userPrompt": "...", "body": "...", "cues": {...}, "exists": false }
 *     ],
 *     "instructions": [...]
 *   }
 *
 * Pairs with `vibe scene install-skill` — the host agent reads the
 * Hyperframes rules, `DESIGN.md` for visual identity, then
 * writes each `compositions/scene-<id>.html`. After authoring, runs
 * `vibe build <project> --stage sync` to assemble the root composition,
 * `vibe scene lint <project> --fix` to verify, and `vibe render` for MP4.
 *
 * This is the only model-authored compose path: the host agent writes each
 * file. `--composer template` is the deterministic alternative.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import {
  parseStoryboard,
  STORYBOARD_CUE_KEYS,
  type Beat,
  type BeatCues,
} from "./storyboard-parse.js";
import { buildUserPrompt } from "./compose-beat-prompt.js";
import { resolveProjectBeatDurations } from "./root-sync.js";
import {
  HYPERFRAMES_SKILL_INSTALL_COMMAND,
  hyperframesSkillAvailable,
  resolveSkillReference,
} from "./install-skill.js";
import { readBeatTranscript, beatTranscriptRelPath } from "./transcribe-narration.js";

export interface ComposePromptsBeat {
  /** Stable beat id from `parseStoryboard().deriveBeatId()`. */
  id: string;
  /** Original `## …` heading line (without the `## ` prefix). */
  heading: string;
  /** Path the agent should write the composition to (relative to projectDir). */
  outputPath: string;
  /** Storyboard beat duration in seconds (the MINIMUM — see finalDurationSec). */
  duration?: number;
  /**
   * Narration-synced FINAL beat duration in seconds — the storyboard duration
   * stretched to cover generated narration audio. Use THIS for
   * `data-duration` and timeline anchors when present; using the storyboard
   * `duration` produces scenes that end early and render black tails.
   */
  finalDurationSec?: number;
  /** Per-beat YAML cues parsed from the leading code block of the body. */
  cues?: BeatCues;
  /** Beat body markdown (with the leading `\`\`\`yaml` cue block stripped). */
  body: string;
  /**
   * Pre-built user prompt — the same shape `composeBeatHtml` would send to
   * Claude / OpenAI / Gemini. The host agent consumes this directly so the
   * the host agent and the template composer produce equivalent structure.
   */
  userPrompt: string;
  /**
   * Project-relative path to the beat's Whisper word-level transcript
   * (`assets/transcript-<id>.json`), present only when the asset stage
   * transcribed this beat's narration. The host agent can read it for exact
   * word timings; the same timings are already summarised in `userPrompt`.
   */
  transcriptPath?: string;
  /** True when `compositions/scene-<id>.html` already exists on disk. */
  exists: boolean;
}

export interface ComposePromptsResult {
  success: boolean;
  /** Absolute project directory. */
  projectDir: string;
  /** Project-root-relative path to DESIGN.md (always "DESIGN.md"). */
  designReference: string;
  /**
   * Project-root-relative path to the optional COMPOSITION.md structural
   * contract (`"COMPOSITION.md"`), or `null` when the project doesn't have one.
   * Parallel to {@link designReference}: DESIGN.md is the visual hard-gate,
   * COMPOSITION.md is the structural hard-gate (layout system, GSAP timeline
   * conventions, element/track rules). The host agent must honor it when present.
   */
  compositionReference: string | null;
  /** Project-root-relative path to STORYBOARD.md (always "STORYBOARD.md"). */
  storyboardReference: string;
  /**
   * Project-root-relative path to the universal Hyperframes SKILL.md.
   * `null` when the skill hasn't been installed — the
   * `warnings` field then carries an actionable hint.
   */
  skillReference: string | null;
  /** Project-root-relative compositions directory (always "compositions"). */
  compositionsDir: string;
  /** Per-beat plan, ordered by source document position. */
  beats: ComposePromptsBeat[];
  /** Step-by-step instructions for the host agent. */
  instructions: string[];
  /** Non-fatal hints surfaced to the agent (e.g. missing SKILL.md). */
  warnings: string[];
  /** Set when {@link success} is false. */
  error?: string;
}

export interface ComposePromptsOptions {
  /** Project directory containing STORYBOARD.md / DESIGN.md. */
  projectDir: string;
  /**
   * Restrict output to a single beat id. When unset, every beat in the
   * storyboard is emitted.
   */
  beatId?: string;
}

/**
 * Build the agent compose plan from a scene project on disk. Pure I/O —
 * no network, no LLM, no mutation. Caller (CLI handler / manifest tool /
 * MCP surface) decides how to surface the result.
 */
export async function getComposePrompts(opts: ComposePromptsOptions): Promise<ComposePromptsResult> {
  const projectDir = resolve(opts.projectDir);
  const designPath = join(projectDir, "DESIGN.md");
  const compositionPath = join(projectDir, "COMPOSITION.md");
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const compositionsDir = join(projectDir, "compositions");

  // The optional structural contract — surfaced as a hard-gate reference only
  // when the project actually carries one (COMPOSITION.md is bespoke, never scaffolded).
  const compositionReference = existsSync(compositionPath) ? "COMPOSITION.md" : null;

  const warnings: string[] = [];
  const baseError = (msg: string): ComposePromptsResult => ({
    success: false,
    projectDir,
    designReference: "DESIGN.md",
    compositionReference,
    storyboardReference: "STORYBOARD.md",
    skillReference: resolveSkillReference(projectDir),
    compositionsDir: "compositions",
    beats: [],
    instructions: [],
    warnings,
    error: msg,
  });

  if (!existsSync(designPath)) {
    return baseError(`DESIGN.md not found at ${designPath}. Run \`vibe init <dir>\` first.`);
  }
  if (!existsSync(storyboardPath)) {
    return baseError(`STORYBOARD.md not found at ${storyboardPath}. Run \`vibe init <dir>\` to create a starter, or add STORYBOARD.md with per-beat cues.`);
  }

  if (!hyperframesSkillAvailable(projectDir)) {
    warnings.push(
      "Hyperframes composition rules are not installed — you will be authoring without them in context. " +
        `Run \`vibe scene install-skill\` (or \`${HYPERFRAMES_SKILL_INSTALL_COMMAND}\`) first.`,
    );
  }

  const storyboardMd = await readFile(storyboardPath, "utf-8");
  const parsed = parseStoryboard(storyboardMd);

  if (parsed.beats.length === 0) {
    return baseError(`STORYBOARD.md has no \`## Beat …\` headings.`);
  }

  // Filter to one beat if requested.
  let beats: Beat[];
  if (opts.beatId !== undefined) {
    const match = parsed.beats.find((b) => b.id === opts.beatId);
    if (!match) {
      return baseError(
        `Beat "${opts.beatId}" not found. Available: ${parsed.beats.map((b) => b.id).join(", ")}`,
      );
    }
    beats = [match];
  } else {
    beats = parsed.beats;
  }

  // Pin prompts to the narration-synced FINAL durations when resolvable
  // (assets stage already ran → narration files exist). Failure here must
  // not block the plan; the storyboard durations remain a valid fallback.
  let finalDurations = new Map<string, number>();
  try {
    finalDurations = await resolveProjectBeatDurations(projectDir);
  } catch {
    // best-effort only
  }

  const result: ComposePromptsBeat[] = await Promise.all(
    beats.map(async (beat) => {
      const outputPathAbs = join(compositionsDir, `scene-${beat.id}.html`);
      const outputPathRel = relative(projectDir, outputPathAbs);
      const finalDurationSec = finalDurations.get(beat.id);
      // Word-level timings, when the asset stage transcribed this beat's
      // narration. Surfaced in the prompt AND exposed as a path for hosts
      // that want the raw data. Missing → undefined → prompt omits timings.
      const transcript = await readBeatTranscript(projectDir, beat.id);
      const userPrompt = buildUserPrompt({
        beat,
        storyboardGlobal: parsed.global,
        finalDurationSec,
        transcript,
      });
      return {
        id: beat.id,
        heading: beat.heading,
        outputPath: outputPathRel,
        duration: beat.duration,
        finalDurationSec,
        cues: beat.cues,
        body: beat.body,
        userPrompt,
        transcriptPath: transcript ? beatTranscriptRelPath(beat.id) : undefined,
        exists: existsSync(outputPathAbs),
      };
    })
  );

  const skillRef = resolveSkillReference(projectDir);
  const instructions = buildInstructions({
    skillRef,
    compositionRef: compositionReference,
    beatCount: result.length,
    filtered: opts.beatId !== undefined,
  });

  return {
    success: true,
    projectDir,
    designReference: "DESIGN.md",
    compositionReference,
    storyboardReference: "STORYBOARD.md",
    skillReference: skillRef,
    compositionsDir: "compositions",
    beats: result,
    instructions,
    warnings,
  };
}

function buildInstructions(args: {
  skillRef: string | null;
  compositionRef: string | null;
  beatCount: number;
  filtered: boolean;
}): string[] {
  const lines: string[] = [];
  if (args.skillRef) {
    lines.push(`1. Read \`${args.skillRef}\` for the Hyperframes framework rules + house style. This is the visual-identity hard-gate.`);
  } else {
    // Point at the project's own AGENTS.md first: `vibe init` writes the
    // "Key Rules (for hand-authored scene HTML)" section, and unlike the
    // installed skill it is present and complete offline. Upstream's
    // installer writes a ROUTER whose actual contract sits behind
    // `/hyperframes-core`, which only resolves in a host that has upstream's
    // domain skills - so an agent that follows install-skill alone can end up
    // authoring blind.
    lines.push(
      `1. Read this project's \`AGENTS.md\` section "Key Rules (for hand-authored scene HTML)" - written by \`vibe init\`, and the authoritative local contract. \`vibe scene install-skill\` adds Hyperframes' house style on top, but note it installs a ROUTER whose full contract sits behind \`/hyperframes-core\`, which resolves only in a host that has upstream's Hyperframes skills.`
    );
  }
  lines.push(`2. Read \`DESIGN.md\` for project-specific palette, typography, motion signature.`);
  if (args.compositionRef) {
    lines.push(`2b. Read \`${args.compositionRef}\` for the project STRUCTURAL contract (layout system, GSAP timeline conventions, element/track rules) — a HARD-GATE parallel to DESIGN.md; every composition must satisfy it.`);
  }
  // The cue list is rendered from the SSOT rather than restated. The old
  // hand-typed "(narration, duration, backdrop, voice)" named 4 of 15, so the
  // agent was handed `motion`, `characters`, `keyframe` and the lower-third
  // cues in the payload without ever being told they were there.
  lines.push(`3. For each beat in the \`beats\` array below, author HTML at \`outputPath\` matching the \`userPrompt\`. The beat \`body\` carries the narrative intent; \`cues\` carries machine-readable per-beat overrides (${STORYBOARD_CUE_KEYS.join(", ")}).`);
  lines.push(`   The \`motion\` cue, when present, is the animation direction for this beat - treat it as binding on how elements enter, hold, and leave, the same way \`narration\` is binding on the audio.`);
  lines.push(`3b. Use each beat's \`finalDurationSec\` (narration-synced) for \`data-duration\` and timeline anchors when present — NOT the storyboard \`duration\`, which is only the minimum. Scenes composed at the storyboard duration end early and render black tails.`);
  lines.push(`3c. Never give inner \`.clip\` elements a non-zero \`data-start\` — the renderer does not toggle internal clip visibility inside sub-compositions, so phased clips render all phases at once (overlapping text). Use full-window clips and GSAP autoAlpha phase transitions instead. Also keep beats 6-15s; split anything longer in the storyboard first.`);
  lines.push(`3d. If your environment cannot write files (e.g. Claude Desktop / MCP-only hosts), author each beat's HTML and submit it with the \`scene_submit\` tool (beat id + html). It validates with the same Hyperframes lint and writes the file for you; on lint errors it returns the findings without writing — fix and resubmit.`);
  lines.push(`3e. Hard requirements the linter fails on, so satisfy them even without the full contract. A scene file is a \`<template id="scene-<id>-template">\` wrapping ONE \`<div data-composition-id="scene-<id>" data-start="0" data-duration="<sec>" data-width="1920" data-height="1080">\` — not a standalone \`<!doctype html>\` document. Register the paused GSAP timeline on the registry OBJECT keyed by composition id: \`window.__timelines = window.__timelines || {}; window.__timelines["scene-<id>"] = tl;\` — it is not an array, and \`.push()\` leaves the timeline undiscovered, which renders a black frame because \`gsap.from\` holds elements at their start state. Also put \`class="clip"\` on every timed element and give timeline-visible elements a stable \`id\`. Generate a reference scene with \`vibe scene add <id> --style <preset> --no-audio --no-image\` and match its shape.`);
  if (args.beatCount > 1) {
    lines.push(`4. After authoring all ${args.beatCount} beat(s), run \`vibe build <project> --stage sync --json\` to assemble the root composition (index.html) from the fragments. Lint needs that root, so sync comes first.`);
  } else if (args.filtered) {
    lines.push(`4. After authoring this beat, author the remaining beats with the same flow (re-call this command without \`--beat\`), then run \`vibe build <project> --stage sync --json\` to assemble the root composition.`);
  } else {
    lines.push(`4. After authoring, run \`vibe build <project> --stage sync --json\` to assemble the root composition (index.html). Lint needs that root, so sync comes first.`);
  }
  lines.push(`5. Run \`vibe scene lint <project> --fix\` to validate. Fix any remaining errors by editing the HTML directly.`);
  lines.push(`6. Run \`vibe render <project>\` to produce the final MP4.`);
  return lines;
}
