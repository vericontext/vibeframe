/**
 * CLI ↔ MCP ↔ Agent sync hook.
 *
 * VibeFrame ships three surfaces that wrap the same engine: the `vibe` CLI,
 * the MCP server (this package), and the in-process agent (`vibe agent`
 * REPL). They must stay in sync. Whenever a CLI subcommand is added,
 * removed, or renamed, both the MCP tool and the agent tool need matching
 * updates. This test fails CI on drift in any direction:
 *
 *   1. A CLI subcommand exists with no entry in SYNC_TABLE → fail (must
 *      either be wired into both MCP & Agent or explicitly marked with
 *      `null` per surface for a tracked TODO).
 *   2. A registered MCP/Agent tool that no SYNC_TABLE row points at and
 *      isn't in the corresponding *_ONLY set → fail (orphan).
 *   3. SYNC_TABLE claims a tool exists but it isn't actually registered →
 *      fail (broken mapping).
 *
 * Set a value to `null` on either side to track a known gap. The test still
 * passes but the gap surfaces in CI. Close the gap by registering the tool
 * and flipping the null to its name.
 */

import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { sceneCommand } from "@vibeframe/cli/commands/scene";
import { generateCommand } from "@vibeframe/cli/commands/generate";
import { ToolRegistry, registerAllTools } from "@vibeframe/cli/agent";
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

// SYNC_TABLE: per-CLI-subcommand expected MCP and Agent tool names.
// `null` on either side = tracked TODO (test passes, CI surfaces gap).
// Close the gap by registering the tool, then flip null → "<name>".
type SyncEntry = { mcp: string | null; agent: string | null };

const SYNC_TABLE: Record<string, SyncEntry> = {
  // scene
  "scene init":         { mcp: "scene_init",        agent: "scene_init" },
  "scene styles":       { mcp: "scene_styles",      agent: "scene_styles" },
  "scene add":          { mcp: "scene_add",         agent: "scene_add" },
  "scene lint":         { mcp: "scene_lint",        agent: "scene_lint" },
  "scene render":       { mcp: "scene_render",      agent: "scene_render" },
  "scene build":        { mcp: "scene_build",       agent: "scene_build" },

  // generate
  "generate image":         { mcp: "generate_image",        agent: "generate_image" },
  "generate video":         { mcp: "generate_video",        agent: "generate_video" },
  "generate speech":        { mcp: "generate_speech",       agent: "generate_speech" },
  "generate sound-effect":  { mcp: "generate_sound_effect", agent: "generate_sound_effect" },
  "generate music":         { mcp: "generate_music",        agent: "generate_music" },
  "generate storyboard":    { mcp: "generate_storyboard",   agent: "generate_storyboard" },
  "generate motion":        { mcp: "generate_motion",       agent: "generate_motion" },
  "generate thumbnail":     { mcp: "generate_thumbnail",    agent: "generate_thumbnail" },
  "generate background":    { mcp: "generate_background",   agent: "generate_background" },
  "generate video-status":  { mcp: "generate_video_status", agent: "generate_video_status" },
  "generate video-cancel":  { mcp: "generate_video_cancel", agent: "generate_video_cancel" },
  "generate video-extend":  { mcp: "generate_video_extend", agent: "generate_video_extend" },
  "generate music-status":  { mcp: null, agent: null }, // TODO async music job status everywhere

  // edit
  "edit silence-cut":       { mcp: "edit_silence_cut",   agent: "edit_silence_cut" },
  "edit caption":           { mcp: "edit_caption",       agent: "edit_caption" },
  "edit noise-reduce":      { mcp: "edit_noise_reduce",  agent: "edit_noise_reduce" },
  "edit fade":              { mcp: "edit_fade",          agent: "edit_fade" },
  "edit translate-srt":     { mcp: "edit_translate_srt", agent: "edit_translate_srt" },
  "edit jump-cut":          { mcp: "edit_jump_cut",      agent: "edit_jump_cut" },
  "edit fill-gaps":         { mcp: null, agent: null },  // TODO: extract executeFillGaps + wire both
  "edit grade":             { mcp: "edit_grade",         agent: "edit_grade" },
  "edit text-overlay":      { mcp: "edit_text_overlay",  agent: "edit_text_overlay" },
  "edit speed-ramp":        { mcp: "edit_speed_ramp",    agent: "edit_speed_ramp" },
  "edit reframe":           { mcp: "edit_reframe",       agent: "edit_reframe" },
  "edit image":             { mcp: "edit_image",         agent: "edit_image" },
  "edit interpolate":       { mcp: "edit_interpolate",   agent: "edit_interpolate" },
  "edit upscale-video":     { mcp: "edit_upscale",       agent: "edit_upscale" },

  // audio
  "audio transcribe":   { mcp: "audio_transcribe",  agent: "audio_transcribe" },
  "audio voices":       { mcp: null, agent: null },               // diagnostic — CLI-only by design
  "audio isolate":      { mcp: "audio_isolate",     agent: "audio_isolate" },
  "audio voice-clone":  { mcp: "audio_voice_clone", agent: "audio_voice_clone" },
  "audio dub":          { mcp: "audio_dub",         agent: "audio_dub" },
  "audio duck":         { mcp: "audio_duck",        agent: "audio_duck" },

  // pipeline
  "pipeline highlights":       { mcp: "pipeline_highlights",      agent: "pipeline_highlights" },
  "pipeline auto-shorts":      { mcp: "pipeline_auto_shorts",     agent: "pipeline_auto_shorts" },
  "pipeline animated-caption": { mcp: "edit_animated_caption",    agent: "pipeline_animated_caption" }, // naming inconsistency tracked
  "pipeline script-to-video":  { mcp: "pipeline_script_to_video", agent: "pipeline_script_to_video" }, // [DEPRECATED v0.63]

  // detect
  "detect scenes":  { mcp: "detect_scenes",  agent: "detect_scenes" },
  "detect silence": { mcp: "detect_silence", agent: "detect_silence" },
  "detect beats":   { mcp: "detect_beats",   agent: "detect_beats" },

  // timeline — agent uses short names (timeline_split), MCP uses _clip suffix.
  // Tracked as known naming drift — TODO unify in v0.64 (Phase D follow-up).
  "timeline add-source":  { mcp: "timeline_add_source",     agent: "timeline_add_source" },
  "timeline add-clip":    { mcp: "timeline_add_clip",       agent: "timeline_add_clip" },
  "timeline add-track":   { mcp: "timeline_add_track",      agent: "timeline_add_track" },
  "timeline add-effect":  { mcp: "timeline_add_effect",     agent: "timeline_add_effect" },
  "timeline trim":        { mcp: "timeline_trim_clip",      agent: "timeline_trim" },
  "timeline list":        { mcp: "timeline_list",           agent: "timeline_list" },
  "timeline split":       { mcp: "timeline_split_clip",     agent: "timeline_split" },
  "timeline duplicate":   { mcp: "timeline_duplicate_clip", agent: "timeline_duplicate" },
  "timeline delete":      { mcp: "timeline_delete_clip",    agent: "timeline_delete" },
  "timeline move":        { mcp: "timeline_move_clip",      agent: "timeline_move" },

  // project
  "project create": { mcp: "project_create", agent: "project_create" },
  "project info":   { mcp: "project_info",   agent: "project_info" },
  "project set":    { mcp: null, agent: null }, // CLI-only config writer

  // analyze
  "analyze media":   { mcp: "analyze_media",  agent: "analyze_media" },
  "analyze video":   { mcp: "analyze_video",  agent: "analyze_video" },
  "analyze review":  { mcp: "analyze_review", agent: "analyze_review" },
  "analyze suggest": { mcp: null, agent: null }, // TODO: ai-suggest-edit not exposed anywhere
};

// MCP tools that have no direct CLI subcommand by design — namespace shifts,
// top-level commands surfaced under a category prefix, etc. Each entry needs
// a one-line justification so future readers know it's not just an oversight.
const MCP_ONLY = new Map<string, string>([
  ["pipeline_regenerate_scene",  "MCP-only render path; CLI uses scene_build re-run"],
  ["pipeline_run",               "wraps the top-level `vibe run <pipeline>` command (different namespace)"],
  ["export_video",               "wraps top-level `vibe export <project>`"],
]);

// Agent tools that have no CLI subcommand — agent-internal helpers
// (filesystem IO, batch ops, in-process media probes, REPL niceties).
const AGENT_ONLY = new Map<string, string>([
  ["fs_read",              "in-process file IO — agent reads project files directly"],
  ["fs_write",             "in-process file IO"],
  ["fs_list",              "in-process file IO"],
  ["fs_exists",            "in-process file IO"],
  ["media_info",           "in-process ffprobe wrapper for the agent loop"],
  ["media_convert",        "in-process ffmpeg wrapper"],
  ["media_concat",         "in-process ffmpeg wrapper"],
  ["media_compress",       "in-process ffmpeg wrapper"],
  ["batch_import",         "agent batch helper — wraps vibe batch import"],
  ["batch_concat",         "agent batch helper"],
  ["batch_apply_effect",   "agent batch helper"],
  ["export_audio",         "agent-only — extract audio track to file"],
  ["export_subtitles",     "agent-only — extract subtitles track to file"],
  ["export_video",         "agent loop variant of top-level `vibe export <project>`"],
  ["project_open",         "REPL session state — load .vibe.json into context"],
  ["project_save",         "REPL session state — flush context back to .vibe.json"],
  ["project_set",          "agent helper — wraps vibe project set; CLI surface is for humans"],
  ["timeline_clear",       "REPL session state — discard in-memory edits"],
  ["pipeline_regenerate_scene",  "agent-only render path; mirrors MCP_ONLY entry"],
]);

async function getAgentToolNames(): Promise<Set<string>> {
  const registry = new ToolRegistry();
  await registerAllTools(registry);
  return new Set(registry.getAll().map((t) => t.name));
}

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
    for (const [cli, entry] of Object.entries(SYNC_TABLE)) {
      if (entry.mcp !== null && !registered.has(entry.mcp)) {
        broken.push({ cli, mcp: entry.mcp });
      }
    }
    expect(broken, `SYNC_TABLE points at MCP tools that are not registered: ${JSON.stringify(broken)}`).toEqual([]);
  });

  it("every mapped Agent tool name in SYNC_TABLE is actually registered", async () => {
    const registered = await getAgentToolNames();
    const broken: Array<{ cli: string; agent: string }> = [];
    for (const [cli, entry] of Object.entries(SYNC_TABLE)) {
      if (entry.agent !== null && !registered.has(entry.agent)) {
        broken.push({ cli, agent: entry.agent });
      }
    }
    expect(broken, `SYNC_TABLE points at Agent tools that are not registered: ${JSON.stringify(broken)}`).toEqual([]);
  });

  it("every registered MCP tool is either mapped from a CLI command or explicitly MCP-only", () => {
    const mapped = new Set(
      Object.values(SYNC_TABLE)
        .map((entry) => entry.mcp)
        .filter((v): v is string => v !== null),
    );
    const orphans: string[] = [];
    for (const t of tools) {
      if (!mapped.has(t.name) && !MCP_ONLY.has(t.name)) orphans.push(t.name);
    }
    expect(orphans, `MCP tools with no CLI mapping and not in MCP_ONLY: ${orphans.join(", ")}. Either map to a CLI command or add to MCP_ONLY with justification.`).toEqual([]);
  });

  it("every registered Agent tool is either mapped from a CLI command or explicitly Agent-only", async () => {
    const registered = await getAgentToolNames();
    const mapped = new Set(
      Object.values(SYNC_TABLE)
        .map((entry) => entry.agent)
        .filter((v): v is string => v !== null),
    );
    const orphans: string[] = [];
    for (const name of registered) {
      if (!mapped.has(name) && !AGENT_ONLY.has(name)) orphans.push(name);
    }
    expect(orphans, `Agent tools with no CLI mapping and not in AGENT_ONLY: ${orphans.join(", ")}. Either map to a CLI command or add to AGENT_ONLY with justification.`).toEqual([]);
  });

  it("MCP_ONLY entries are real registered MCP tools", () => {
    const registered = new Set(tools.map((t) => t.name));
    const dead: string[] = [];
    for (const tool of MCP_ONLY.keys()) {
      if (!registered.has(tool)) dead.push(tool);
    }
    expect(dead, `MCP_ONLY references unregistered tools: ${dead.join(", ")}`).toEqual([]);
  });

  it("AGENT_ONLY entries are real registered Agent tools", async () => {
    const registered = await getAgentToolNames();
    const dead: string[] = [];
    for (const tool of AGENT_ONLY.keys()) {
      if (!registered.has(tool)) dead.push(tool);
    }
    expect(dead, `AGENT_ONLY references unregistered tools: ${dead.join(", ")}`).toEqual([]);
  });

  it("CLI_ONLY_TOP_LEVEL is sane (no overlap with mapped CLI commands)", () => {
    const mappedTopGroups = new Set(Object.keys(CLI_TREE));
    const overlap = [...CLI_ONLY_TOP_LEVEL].filter((c) => mappedTopGroups.has(c));
    expect(overlap, `CLI_ONLY_TOP_LEVEL overlaps groups that have subcommand mappings: ${overlap.join(", ")}`).toEqual([]);
  });
});
