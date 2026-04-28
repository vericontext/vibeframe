/**
 * CLI ↔ manifest sync hook (post-v0.65).
 *
 * Pre-v0.65 this file maintained a SYNC_TABLE mapping every CLI subcommand
 * to its MCP and Agent tool names. After C6 (legacy collapse) the manifest
 * is the single source of truth for both MCP and Agent surfaces, so the
 * 3-way mapping collapsed to a 2-way one: CLI ↔ manifest.
 *
 * The test still fires when:
 * - A new CLI subcommand is added without a manifest entry → fail (or add to
 *   CLI_ONLY_TOP_LEVEL if it's CLI-ergonomics-only).
 * - A manifest entry's name doesn't match the CLI command's expected
 *   `<group>_<sub>` pattern → fail.
 * - The manifest exposes a tool with no surfaces → fail.
 *
 * MCP↔Agent symmetry is no longer in scope — the manifest's `surfaces`
 * field is the source of truth. The `manifest.test.ts` invariants check
 * adapter consistency.
 */

import { describe, expect, it } from "vitest";
import { sceneCommand } from "@vibeframe/cli/commands/scene";
import { generateCommand } from "@vibeframe/cli/commands/generate";
import { manifest } from "@vibeframe/cli/tools/manifest";
import { tools } from "./index.js";

interface CommanderLike {
  commands: ReadonlyArray<{ name(): string }>;
}

// Hand-maintained mirror of the CLI surface. Each row is a
// `<group> <subname>` CLI invocation paired with the canonical manifest
// tool name (or null if explicitly CLI-only).
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

// Top-level CLI commands with no manifest equivalent — pure ergonomics
// (interactive flows, REPLs, schema dumps) that don't fit the
// "manifest-as-tool" mold.
const CLI_ONLY_TOP_LEVEL = new Set([
  "setup", "init", "doctor", "demo", "agent", "run", "batch", "schema",
  "context", "media", "help", "export",
]);

// CLI subcommands → expected manifest tool name (or null = intentionally
// CLI-only). Renames happen here (e.g., `pipeline animated-caption` →
// manifest `edit_animated_caption`; `edit upscale-video` → `edit_upscale`).
const CLI_TO_MANIFEST: Record<string, string | null> = {
  // scene
  "scene init":   "scene_init",
  "scene styles": "scene_styles",
  "scene add":    "scene_add",
  "scene lint":   "scene_lint",
  "scene render": "scene_render",
  "scene build":  "scene_build",
  // generate
  "generate image":         "generate_image",
  "generate video":         "generate_video",
  "generate video-status":  "generate_video_status",
  "generate video-cancel":  "generate_video_cancel",
  "generate video-extend":  "generate_video_extend",
  "generate speech":        "generate_speech",
  "generate sound-effect":  "generate_sound_effect",
  "generate music":         "generate_music",
  "generate music-status":  "generate_music_status",
  "generate storyboard":    "generate_storyboard",
  "generate motion":        "generate_motion",
  "generate thumbnail":     "generate_thumbnail",
  "generate background":    "generate_background",
  // edit
  "edit silence-cut":   "edit_silence_cut",
  "edit caption":       "edit_caption",
  "edit noise-reduce":  "edit_noise_reduce",
  "edit fade":          "edit_fade",
  "edit translate-srt": "edit_translate_srt",
  "edit jump-cut":      "edit_jump_cut",
  "edit fill-gaps":     "edit_fill_gaps",
  "edit grade":         "edit_grade",
  "edit text-overlay":  "edit_text_overlay",
  "edit speed-ramp":    "edit_speed_ramp",
  "edit reframe":       "edit_reframe",
  "edit image":         "edit_image",
  "edit interpolate":   "edit_interpolate",
  "edit upscale-video": "edit_upscale",
  // audio
  "audio transcribe":  "audio_transcribe",
  "audio voices":      null, // CLI-only: ElevenLabs voice list dump
  "audio isolate":     "audio_isolate",
  "audio voice-clone": "audio_voice_clone",
  "audio dub":         "audio_dub",
  "audio duck":        "audio_duck",
  // pipeline
  "pipeline highlights":       "pipeline_highlights",
  "pipeline auto-shorts":      "pipeline_auto_shorts",
  "pipeline animated-caption": "edit_animated_caption",
  "pipeline script-to-video":  "pipeline_script_to_video",
  // detect
  "detect scenes":  "detect_scenes",
  "detect silence": "detect_silence",
  "detect beats":   "detect_beats",
  // timeline
  "timeline add-source": "timeline_add_source",
  "timeline add-clip":   "timeline_add_clip",
  "timeline add-track":  "timeline_add_track",
  "timeline add-effect": "timeline_add_effect",
  "timeline trim":       "timeline_trim_clip",
  "timeline list":       "timeline_list",
  "timeline split":      "timeline_split_clip",
  "timeline duplicate":  "timeline_duplicate_clip",
  "timeline delete":     "timeline_delete_clip",
  "timeline move":       "timeline_move_clip",
  // project
  "project create": "project_create",
  "project info":   "project_info",
  "project set":    null, // CLI-only: vibe.project.yaml writer; agents use fs_write
  // analyze
  "analyze media":   "analyze_media",
  "analyze video":   "analyze_video",
  "analyze review":  "analyze_review",
  "analyze suggest": "analyze_suggest",
};

describe("CLI ↔ manifest sync", () => {
  it("CLI_TREE matches Commander's actual subcommand list (sample)", () => {
    const sceneSubs = (sceneCommand as unknown as CommanderLike).commands.map((c) => c.name()).sort();
    const generateSubs = (generateCommand as unknown as CommanderLike).commands.map((c) => c.name()).sort();
    expect(sceneSubs).toEqual([...CLI_TREE.scene].sort());
    expect(generateSubs).toEqual([...CLI_TREE.generate].sort());
  });

  it("every CLI subcommand has a CLI_TO_MANIFEST entry (mapped or null)", () => {
    const missing: string[] = [];
    for (const [group, subs] of Object.entries(CLI_TREE)) {
      for (const sub of subs) {
        const key = `${group} ${sub}`;
        if (!(key in CLI_TO_MANIFEST)) missing.push(key);
      }
    }
    expect(missing, `New CLI commands found with no CLI_TO_MANIFEST entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("every mapped manifest tool name in CLI_TO_MANIFEST exists in the manifest", () => {
    const manifestNames = new Set(manifest.map((t) => t.name));
    const broken: Array<{ cli: string; tool: string }> = [];
    for (const [cli, tool] of Object.entries(CLI_TO_MANIFEST)) {
      if (tool !== null && !manifestNames.has(tool)) broken.push({ cli, tool });
    }
    expect(broken, `CLI_TO_MANIFEST points at manifest tools that do not exist: ${JSON.stringify(broken)}`).toEqual([]);
  });

  it("every MCP-surfaced manifest entry shows up in mcp-server's tools array", () => {
    const registered = new Set(tools.map((t) => t.name));
    const expected = manifest
      .filter((t) => !t.surfaces || t.surfaces.includes("mcp"))
      .map((t) => t.name);
    const missing = expected.filter((n) => !registered.has(n));
    expect(missing, `MCP-surfaced manifest entries missing from tools array: ${missing.join(", ")}`).toEqual([]);
  });

  it("every manifest entry has at least one surface", () => {
    const orphans = manifest.filter((t) => t.surfaces && t.surfaces.length === 0);
    expect(orphans.map((t) => t.name)).toEqual([]);
  });

  it("agent-only manifest entries are NOT exposed via MCP", () => {
    // surfaces=["agent"] entries (fs_*, batch_*) must never end up in
    // mcp-server's tools array — MCP clients have host-side filesystem
    // affordances and these would be unsafe / out of scope. Regression
    // for v0.66 PR3.
    const registered = new Set(tools.map((t) => t.name));
    const agentOnly = manifest.filter((t) => t.surfaces && t.surfaces.length === 1 && t.surfaces[0] === "agent");
    const leaked = agentOnly.map((t) => t.name).filter((n) => registered.has(n));
    expect(leaked, `agent-only entries leaked into MCP tools array: ${leaked.join(", ")}`).toEqual([]);
  });

  it("CLI_ONLY_TOP_LEVEL has no overlap with CLI_TREE groups", () => {
    const overlap = [...CLI_ONLY_TOP_LEVEL].filter((c) => Object.prototype.hasOwnProperty.call(CLI_TREE, c));
    expect(overlap, `CLI_ONLY_TOP_LEVEL overlaps mapped groups: ${overlap.join(", ")}`).toEqual([]);
  });
});
