/**
 * CLI ↔ MCP sync hook.
 *
 * The two surfaces — `vibe <verb> <noun>` (CLI) and `<verb>_<noun>` (MCP) —
 * must stay in sync. Whenever a CLI subcommand is added, removed, or renamed,
 * the corresponding MCP tool needs the same change. This test fails CI on
 * drift in either direction:
 *
 *   1. A CLI subcommand exists with no entry in SYNC_TABLE → fail (must
 *      either be wired into MCP or explicitly marked CLI-only with `null`).
 *   2. An MCP tool is registered that no SYNC_TABLE row points at and is not
 *      in MCP_ONLY → fail (orphaned MCP tool).
 *   3. SYNC_TABLE claims a tool exists but it isn't actually registered →
 *      fail (broken mapping).
 *
 * To track a known gap (a CLI command we have not yet exposed as MCP), set
 * its value to `null`. The test still passes, but the gap is visible. To
 * close the gap: register the MCP tool, then change the value to its name.
 */

import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { sceneCommand } from "@vibeframe/cli/commands/scene";
import { generateCommand } from "@vibeframe/cli/commands/generate";
import { tools } from "./index.js";

// Lazy: most CLI command modules don't pre-export their root Command instance.
// We inline the subcommand list rather than importing every command file —
// the test's purpose is the mapping invariant, not Commander introspection.
const CLI_TREE: Record<string, string[]> = {
  scene:    ["init", "styles", "add", "lint", "render", "build"],
  generate: ["image", "video", "video-status", "video-cancel", "video-extend", "speech", "sound-effect", "music", "music-status", "storyboard", "motion", "thumbnail", "background"],
  edit:     ["silence-cut", "caption", "noise-reduce", "fade", "translate-srt", "jump-cut", "fill-gaps", "grade", "text-overlay", "speed-ramp", "reframe", "image", "interpolate", "upscale-video"],
  audio:    ["transcribe", "voices", "isolate", "voice-clone", "dub", "duck"],
  pipeline: ["highlights", "auto-shorts", "animated-caption", "script-to-video"],
  detect:   ["scenes", "silence", "beats"],
  timeline: ["add-source", "add-clip", "add-track", "add-effect", "trim", "list", "split", "duplicate", "delete", "move"],
  project:  ["create", "info", "set"],
  analyze:  ["media", "video", "review", "suggest"],
};

// Top-level CLI commands that are pure ergonomics — no MCP equivalent.
const CLI_ONLY_TOP_LEVEL = new Set([
  "setup", "init", "doctor", "demo", "agent", "run", "batch", "schema",
  "context", "media", "help", "export",
]);

// Maps `<group> <subname>` → MCP tool name, or null when the gap is tracked
// (CLI command exists but MCP tool not yet implemented). The null entries are
// the live TODO list — close them by adding the MCP tool then flipping the
// value to its name.
const SYNC_TABLE: Record<string, string | null> = {
  // scene
  "scene init":         "scene_init",
  "scene styles":       "scene_styles",
  "scene add":          "scene_add",
  "scene lint":         "scene_lint",
  "scene render":       "scene_render",
  "scene build":        "scene_build",

  // generate
  "generate image":         "generate_image",
  "generate video":         "generate_video",
  "generate speech":        "generate_speech",
  "generate sound-effect":  "generate_sound_effect",
  "generate music":         "generate_music",
  "generate storyboard":    "generate_storyboard",
  "generate motion":        "generate_motion",
  "generate thumbnail":     "generate_thumbnail",
  "generate background":    "generate_background",
  "generate video-status":  "generate_video_status",
  "generate video-cancel":  "generate_video_cancel",
  "generate video-extend":  "generate_video_extend",
  "generate music-status":  null, // TODO: async music job status not yet exposed via MCP

  // edit
  "edit silence-cut":       "edit_silence_cut",
  "edit caption":           "edit_caption",
  "edit noise-reduce":      "edit_noise_reduce",
  "edit fade":              "edit_fade",
  "edit translate-srt":     "edit_translate_srt",
  "edit jump-cut":          "edit_jump_cut",
  "edit fill-gaps":         null, // TODO: extract executeFillGaps + add MCP tool
  "edit grade":             "edit_grade",
  "edit text-overlay":      "edit_text_overlay",
  "edit speed-ramp":        "edit_speed_ramp",
  "edit reframe":           "edit_reframe",
  "edit image":             "edit_image",
  "edit interpolate":       "edit_interpolate",
  "edit upscale-video":     "edit_upscale", // CLI is upscale-video, MCP is edit_upscale

  // audio
  "audio transcribe":   "audio_transcribe",
  "audio voices":       null, // CLI lists ElevenLabs voices — diagnostic only
  "audio isolate":      "audio_isolate",
  "audio voice-clone":  "audio_voice_clone",
  "audio dub":          "audio_dub",
  "audio duck":         "audio_duck",

  // pipeline
  "pipeline highlights":       "pipeline_highlights",
  "pipeline auto-shorts":      "pipeline_auto_shorts",
  "pipeline animated-caption": "edit_animated_caption", // surfaced via edit_ in MCP
  "pipeline script-to-video":  "pipeline_script_to_video", // [DEPRECATED v0.63]

  // detect
  "detect scenes":  "detect_scenes",
  "detect silence": "detect_silence",
  "detect beats":   "detect_beats",

  // timeline
  "timeline add-source":  "timeline_add_source",
  "timeline add-clip":    "timeline_add_clip",
  "timeline add-track":   "timeline_add_track",
  "timeline add-effect":  "timeline_add_effect",
  "timeline trim":        "timeline_trim_clip",
  "timeline list":        "timeline_list",
  "timeline split":       "timeline_split_clip",
  "timeline duplicate":   "timeline_duplicate_clip",
  "timeline delete":      "timeline_delete_clip",
  "timeline move":        "timeline_move_clip",

  // project
  "project create": "project_create",
  "project info":   "project_info",
  "project set":    null, // CLI-only config writer; MCP equivalent not designed yet

  // analyze
  "analyze media":   "analyze_media",
  "analyze video":   "analyze_video",
  "analyze review":  "analyze_review",
  "analyze suggest": null, // TODO: ai-suggest-edit not yet exposed as MCP
};

// MCP tools that have no direct CLI subcommand by design — namespace shifts,
// top-level commands surfaced under a category prefix, etc. Each entry needs
// a one-line justification so future readers know it's not just an oversight.
const MCP_ONLY = new Map<string, string>([
  ["pipeline_regenerate_scene",  "MCP-only render path; CLI uses scene_build re-run"],
  ["pipeline_run",               "wraps the top-level `vibe run <pipeline>` command (different namespace)"],
  ["export_video",               "wraps top-level `vibe export <project>`"],
]);

// ── Verifications ────────────────────────────────────────────────────────

describe("CLI ↔ MCP tool sync", () => {
  it("the live CLI command tree we hardcode here matches Commander's", () => {
    // Sanity-check that CLI_TREE matches reality for at least the two groups
    // we can import without dragging in every subcommand module. Catches
    // someone renaming a Commander subcommand without updating SYNC_TABLE.
    const sceneSubs = (sceneCommand as Command).commands.map((c) => c.name()).sort();
    const generateSubs = (generateCommand as Command).commands.map((c) => c.name()).sort();
    expect(sceneSubs).toEqual([...CLI_TREE.scene].sort());
    expect(generateSubs).toEqual([...CLI_TREE.generate].sort());
  });

  it("every CLI subcommand has a SYNC_TABLE entry (mapped or null)", () => {
    const missing: string[] = [];
    for (const [group, subs] of Object.entries(CLI_TREE)) {
      for (const sub of subs) {
        const key = `${group} ${sub}`;
        if (!(key in SYNC_TABLE)) missing.push(key);
      }
    }
    expect(missing, `New CLI commands found with no SYNC_TABLE entry. Add either an MCP tool name or null (with TODO comment): ${missing.join(", ")}`).toEqual([]);
  });

  it("every mapped MCP tool name in SYNC_TABLE is actually registered", () => {
    const registered = new Set(tools.map((t) => t.name));
    const broken: Array<{ cli: string; mcp: string }> = [];
    for (const [cli, mcp] of Object.entries(SYNC_TABLE)) {
      if (mcp !== null && !registered.has(mcp)) {
        broken.push({ cli, mcp });
      }
    }
    expect(broken, `SYNC_TABLE points at MCP tools that are not registered: ${JSON.stringify(broken)}`).toEqual([]);
  });

  it("every registered MCP tool is either mapped from a CLI command or explicitly MCP-only", () => {
    const mapped = new Set(
      Object.values(SYNC_TABLE).filter((v): v is string => v !== null),
    );
    const orphans: string[] = [];
    for (const t of tools) {
      if (!mapped.has(t.name) && !MCP_ONLY.has(t.name)) orphans.push(t.name);
    }
    expect(orphans, `MCP tools with no CLI mapping and not in MCP_ONLY: ${orphans.join(", ")}. Either map to a CLI command or add to MCP_ONLY with justification.`).toEqual([]);
  });

  it("MCP_ONLY entries are real registered tools", () => {
    const registered = new Set(tools.map((t) => t.name));
    const dead: string[] = [];
    for (const tool of MCP_ONLY.keys()) {
      if (!registered.has(tool)) dead.push(tool);
    }
    expect(dead, `MCP_ONLY references unregistered tools: ${dead.join(", ")}`).toEqual([]);
  });

  it("CLI_ONLY_TOP_LEVEL is sane (no overlap with mapped CLI commands)", () => {
    const mappedTopGroups = new Set(Object.keys(CLI_TREE));
    const overlap = [...CLI_ONLY_TOP_LEVEL].filter((c) => mappedTopGroups.has(c));
    expect(overlap, `CLI_ONLY_TOP_LEVEL overlaps groups that have subcommand mappings: ${overlap.join(", ")}`).toEqual([]);
  });
});
