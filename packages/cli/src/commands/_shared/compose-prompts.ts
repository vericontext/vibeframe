/**
 * @module _shared/compose-prompts
 *
 * Phase H2 — agentic compose primitive. Reads `STORYBOARD.md` + `DESIGN.md`
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
 *     "skillReference":      "SKILL.md",        // present after `scene install-skill`
 *     "compositionsDir":     "compositions",
 *     "beats": [
 *       { "id": "hook", "outputPath": "compositions/scene-hook.html",
 *         "userPrompt": "...", "body": "...", "cues": {...}, "exists": false }
 *     ],
 *     "instructions": [...]
 *   }
 *
 * Pairs with H1 (`vibe scene install-skill`) — the host agent reads
 * `SKILL.md` for framework rules, `DESIGN.md` for visual identity, then
 * writes each `compositions/scene-<id>.html`. After authoring, runs
 * `vibe scene lint --fix` to verify and `vibe scene render` to produce MP4.
 *
 * The internal-LLM path (`vibe scene build`, PR #176) still works — it's
 * the batch / non-agent fallback. H3 will add mode dispatch so a single
 * entry point picks between agentic and batch depending on context.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { parseStoryboard, type Beat } from "./storyboard-parse.js";
import { buildUserPrompt } from "./compose-scenes-skills.js";
import { BUNDLE_VERSION } from "./hf-skill-bundle/bundle.js";

export interface ComposePromptsBeat {
  /** Stable beat id from `parseStoryboard().deriveBeatId()`. */
  id: string;
  /** Original `## …` heading line (without the `## ` prefix). */
  heading: string;
  /** Path the agent should write the composition to (relative to projectDir). */
  outputPath: string;
  /** Beat duration in seconds (from cues or `### Beat duration` subsection), if known. */
  duration?: number;
  /** Per-beat YAML cues parsed from the leading code block of the body. */
  cues?: Record<string, unknown>;
  /** Beat body markdown (with the leading `\`\`\`yaml` cue block stripped). */
  body: string;
  /**
   * Pre-built user prompt — the same shape `composeBeatHtml` would send to
   * Claude / OpenAI / Gemini. The host agent consumes this directly so the
   * agentic and batch paths produce equivalent HTML.
   */
  userPrompt: string;
  /** True when `compositions/scene-<id>.html` already exists on disk. */
  exists: boolean;
}

export interface ComposePromptsResult {
  success: boolean;
  /** Absolute project directory. */
  projectDir: string;
  /** Project-root-relative path to DESIGN.md (always "DESIGN.md"). */
  designReference: string;
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
  /** Hyperframes bundle version — informational; ties cache keys back to the internal-LLM path. */
  bundleVersion: string;
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
  const storyboardPath = join(projectDir, "STORYBOARD.md");
  const skillPath = join(projectDir, "SKILL.md");
  const compositionsDir = join(projectDir, "compositions");

  const warnings: string[] = [];
  const baseError = (msg: string): ComposePromptsResult => ({
    success: false,
    projectDir,
    designReference: "DESIGN.md",
    storyboardReference: "STORYBOARD.md",
    skillReference: existsSync(skillPath) ? "SKILL.md" : null,
    compositionsDir: "compositions",
    beats: [],
    instructions: [],
    bundleVersion: BUNDLE_VERSION,
    warnings,
    error: msg,
  });

  if (!existsSync(designPath)) {
    return baseError(`DESIGN.md not found at ${designPath}. Run \`vibe scene init <dir>\` first.`);
  }
  if (!existsSync(storyboardPath)) {
    return baseError(`STORYBOARD.md not found at ${storyboardPath}. Run \`vibe scene init <dir>\` first.`);
  }

  if (!existsSync(skillPath)) {
    warnings.push(
      "SKILL.md not installed — host agent won't have Hyperframes rules in context. " +
      "Run `vibe scene install-skill` to install it.",
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

  const result: ComposePromptsBeat[] = beats.map((beat) => {
    const outputPathAbs = join(compositionsDir, `scene-${beat.id}.html`);
    const outputPathRel = relative(projectDir, outputPathAbs);
    const userPrompt = buildUserPrompt({
      beat,
      storyboardGlobal: parsed.global,
    });
    return {
      id: beat.id,
      heading: beat.heading,
      outputPath: outputPathRel,
      duration: beat.duration,
      cues: beat.cues,
      body: beat.body,
      userPrompt,
      exists: existsSync(outputPathAbs),
    };
  });

  const skillRef = existsSync(skillPath) ? "SKILL.md" : null;
  const instructions = buildInstructions({
    skillRef,
    beatCount: result.length,
    filtered: opts.beatId !== undefined,
  });

  return {
    success: true,
    projectDir,
    designReference: "DESIGN.md",
    storyboardReference: "STORYBOARD.md",
    skillReference: skillRef,
    compositionsDir: "compositions",
    beats: result,
    instructions,
    bundleVersion: BUNDLE_VERSION,
    warnings,
  };
}

function buildInstructions(args: {
  skillRef: string | null;
  beatCount: number;
  filtered: boolean;
}): string[] {
  const lines: string[] = [];
  if (args.skillRef) {
    lines.push(`1. Read \`${args.skillRef}\` for the Hyperframes framework rules + house style. This is the visual-identity hard-gate.`);
  } else {
    lines.push(`1. Run \`vibe scene install-skill\` to install \`SKILL.md\` (Hyperframes rules) into this project, then re-read it.`);
  }
  lines.push(`2. Read \`DESIGN.md\` for project-specific palette, typography, motion signature.`);
  lines.push(`3. For each beat in the \`beats\` array below, author HTML at \`outputPath\` matching the \`userPrompt\`. The beat \`body\` carries the narrative + visual + animation intent; \`cues\` carries machine-readable per-beat overrides (narration, duration, backdrop, voice).`);
  if (args.beatCount > 1) {
    lines.push(`4. After authoring all ${args.beatCount} beat(s), run \`vibe scene lint --fix\` to validate. Fix any remaining errors by editing the HTML directly.`);
  } else if (args.filtered) {
    lines.push(`4. After authoring this beat, run \`vibe scene lint --fix\` to validate. Author the remaining beats with the same flow (re-call this command without \`--beat\`).`);
  } else {
    lines.push(`4. After authoring, run \`vibe scene lint --fix\` to validate.`);
  }
  lines.push(`5. Run \`vibe scene render\` to produce the final MP4.`);
  return lines;
}
