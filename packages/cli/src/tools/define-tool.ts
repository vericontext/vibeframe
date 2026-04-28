/**
 * @module define-tool
 * @description Single source of truth DSL for VibeFrame tool definitions.
 *
 * Each tool is declared once via `defineTool({...})` with a Zod schema, an
 * `execute` function, and metadata. The MCP server (`packages/mcp-server`)
 * and the in-process Agent (`packages/cli/src/agent/tools`) both consume the
 * manifest via thin adapters — no tool definition is ever duplicated across
 * surfaces.
 *
 * The CLI Commander tree (`packages/cli/src/commands/*.ts`) is intentionally
 * left hand-written. Its short flags, `--no-foo` negations, variadic args,
 * and custom validators don't fit cleanly into a metadata sidecar. The
 * Commander chains call the same `executeXxx` engine functions that the
 * manifest entries call, so the CLI stays in sync via the existing
 * `cli-sync.test.ts` invariant.
 *
 * See `/Users/kiyeonjeon/.claude/plans/logical-wibbling-sonnet.md` for the
 * full v0.65 migration plan.
 */

import { z, type ZodTypeAny } from "zod";

export type CostTier = "free" | "low" | "medium" | "high" | "very-high";
export type Surface = "mcp" | "agent";

export interface ExecuteContext {
  /** Resolves relative paths in tool args (`process.cwd()` for MCP/CLI; `AgentContext.workingDirectory` for Agent). */
  workingDirectory: string;
  /** The surface invoking the tool. Lets executes branch on JSON vs human output if needed. */
  surface: "cli" | Surface;
}

export interface ToolExecuteResult {
  success: boolean;
  /** JSON-stringifiable payload. MCP returns `JSON.stringify(data)`; Agent uses humanLines first, falls back to data. */
  data?: Record<string, unknown>;
  /** Human-readable lines for Agent REPL output. Optional — adapter falls back to JSON if absent. */
  humanLines?: readonly string[];
  error?: string;
}

export interface ToolDefinition<S extends ZodTypeAny = ZodTypeAny> {
  /** snake_case canonical name (used by MCP `tools/list` and Agent registry). */
  name: string;
  /** Group this tool belongs to ("scene" | "audio" | "edit" | …). Drives skill regen + sync-counts. */
  category: string;
  /** Cost tier from `.claude/rules/architecture.md` cost table. */
  cost: CostTier;
  /** Identical for MCP description and Agent description. One paragraph. */
  description: string;
  /** Single source of truth for argument shape. Must be a `z.object({...})`. */
  schema: S;
  /** Surfaces the tool lives on. Defaults to `["mcp", "agent"]` when omitted. */
  surfaces?: readonly Surface[];
  /** Engine fn. Receives Zod-validated args. */
  execute: (args: z.infer<S>, ctx: ExecuteContext) => Promise<ToolExecuteResult>;
}

/**
 * Type erasure helper for collecting tools into the manifest array.
 *
 * `ToolDefinition` is generic over the Zod schema type, so a heterogeneous
 * array of tools each with different schemas can't directly satisfy
 * `ToolDefinition<ZodTypeAny>[]` (Zod's generic is invariant). At the
 * manifest aggregation boundary we cast individual tools to this erased
 * shape — the adapters use `tool.schema.safeParse()` which doesn't need the
 * narrow type.
 */
export type AnyTool = ToolDefinition<ZodTypeAny>;

const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function validateToolDefinition<S extends ZodTypeAny>(t: ToolDefinition<S>): void {
  if (!NAME_PATTERN.test(t.name)) {
    throw new Error(`Tool name "${t.name}" must be snake_case (matches /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/)`);
  }
  if (!t.category || !/^[a-z-]+$/.test(t.category)) {
    throw new Error(`Tool "${t.name}" has invalid category "${t.category}" (must be lowercase, dash-separated)`);
  }
  // Schema must be a ZodObject so we can derive {properties, required}. We
  // accept any ZodTypeAny in the type sig for ergonomics, then runtime-check.
  const schemaTypeName = (t.schema as { _def?: { typeName?: string } })._def?.typeName;
  if (schemaTypeName !== "ZodObject") {
    throw new Error(`Tool "${t.name}" schema must be a z.object({...}); got ${schemaTypeName}`);
  }
  if (t.surfaces && t.surfaces.length === 0) {
    throw new Error(`Tool "${t.name}" has empty surfaces array; use [] only via explicit type override`);
  }
}

export function defineTool<S extends ZodTypeAny>(t: ToolDefinition<S>): ToolDefinition<S> {
  validateToolDefinition(t);
  return t;
}

/**
 * During the v0.65 migration (commits C1–C5), tools are moved from the legacy
 * hand-written definitions in `packages/cli/src/agent/tools/*.ts` and
 * `packages/mcp-server/src/tools/*.ts` into the manifest one group at a time.
 * Both legacy and manifest sources are wired up simultaneously; legacy paths
 * skip any tool whose name appears here (manifest takes over).
 *
 * After C6 (legacy collapse), this set is deleted — every registered tool
 * comes from the manifest.
 */
export const MIGRATED: Set<string> = new Set([
  // C2: scene
  "scene_init",
  "scene_add",
  "scene_lint",
  "scene_render",
  "scene_build",
  "scene_styles",
  // C3: audio
  "audio_transcribe",
  "audio_isolate",
  "audio_voice_clone",
  "audio_dub",
  "audio_duck",
  // C3: edit
  "edit_silence_cut",
  "edit_caption",
  "edit_fade",
  "edit_noise_reduce",
  "edit_jump_cut",
  "edit_text_overlay",
  "edit_translate_srt",
  "edit_grade",
  "edit_speed_ramp",
  "edit_reframe",
  "edit_interpolate",
  "edit_upscale",
  "edit_animated_caption",
  "edit_image",
  // C3: analyze
  "analyze_media",
  "analyze_video",
  "analyze_review",
  "analyze_suggest",
  // C4: generate
  "generate_motion",
  "generate_speech",
  "generate_sound_effect",
  "generate_music",
  "generate_music_status",
  "generate_image",
  "generate_storyboard",
  "generate_background",
  "generate_thumbnail",
  "generate_video",
  "generate_video_status",
  "generate_video_cancel",
  "generate_video_extend",
  // C4: pipeline
  "pipeline_script_to_video",
  "pipeline_highlights",
  "pipeline_auto_shorts",
  "pipeline_run",
  "pipeline_regenerate_scene",
  // C5: detect
  "detect_scenes",
  "detect_silence",
  "detect_beats",
  // C5: timeline
  "timeline_add_source",
  "timeline_add_clip",
  "timeline_split_clip",
  "timeline_trim_clip",
  "timeline_move_clip",
  "timeline_delete_clip",
  "timeline_duplicate_clip",
  "timeline_add_effect",
  "timeline_add_track",
  "timeline_list",
  // C5: project
  "project_create",
  "project_info",
  // C5: export
  "export_video",
  // v0.66 PR3: agent-only manifest entries (surfaces=["agent"])
  "fs_list",
  "fs_read",
  "fs_write",
  "fs_exists",
  "batch_import",
  "batch_concat",
  "batch_apply_effect",
  // v0.67 PR1: media_* / timeline_clear / export_* agent-only manifest entries
  "media_info",
  "media_compress",
  "media_convert",
  "media_concat",
  "timeline_clear",
  "export_audio",
  "export_subtitles",
]);
