import { describe, expect, it } from "vitest";
import {
  AGENTS_MD,
  CLAUDE_MD,
  GITIGNORE_ADDITIONS,
  renderEnvExample,
  renderProjectYaml,
} from "./init-templates.js";

describe("AGENTS_MD template", () => {
  it("includes the self-discovery commands so agents can read the surface dynamically", () => {
    expect(AGENTS_MD).toContain("vibe schema --list");
    expect(AGENTS_MD).toContain("vibe schema --list --surface public");
    expect(AGENTS_MD).toContain("vibe doctor");
    expect(AGENTS_MD).toContain("vibe schema generate.video");
  });

  it("declares cost tiers so agents know when to confirm with the user", () => {
    expect(AGENTS_MD).toContain("Cost tiers");
    expect(AGENTS_MD).toMatch(/Free/);
    expect(AGENTS_MD).toMatch(/Very High/);
    expect(AGENTS_MD).toContain("generate image/motion");
    expect(AGENTS_MD).toContain("generate video");
    expect(AGENTS_MD).not.toContain("`inspect *`, `audio transcribe`, `generate image`");
    expect(AGENTS_MD).not.toContain("`generate video`, `edit image`");
  });

  it("states the agent invariants (--json, --dry-run, schema, --stdin)", () => {
    expect(AGENTS_MD).toContain("--json");
    expect(AGENTS_MD).toContain("--dry-run");
    expect(AGENTS_MD).toContain("--stdin");
  });

  it("declares ASSET, BUILD, and REMIX routing so agents route correctly", () => {
    expect(AGENTS_MD).toContain("ASSET");
    expect(AGENTS_MD).toContain("BUILD");
    expect(AGENTS_MD).toContain("REMIX");
    expect(AGENTS_MD).toContain('vibe generate image "..."');
    expect(AGENTS_MD).toContain("vibe edit motion-overlay");
    expect(AGENTS_MD).toContain("vibe edit text-overlay");
    expect(AGENTS_MD).toContain("Do **not** edit");
    // BUILD path canonical command
    expect(AGENTS_MD).toContain("vibe build");
    // REMIX path canonical commands (renamed from `pipeline` in v0.74)
    expect(AGENTS_MD).toContain("vibe remix highlights");
    expect(AGENTS_MD).toContain("vibe edit silence-cut");
    expect(AGENTS_MD).toContain("vibe audio dub");
    expect(AGENTS_MD).toContain("vibe generate narration");
    expect(AGENTS_MD).toContain("vibe inspect media");
    expect(AGENTS_MD).not.toContain("vibe inspect video");
  });

  it("tells agents to use project-scope config through vibe commands", () => {
    expect(AGENTS_MD).toContain("vibe setup --scope project");
    expect(AGENTS_MD).toContain(".vibeframe/config.yaml");
    expect(AGENTS_MD).toContain("data.scope.project.configPath");
    expect(AGENTS_MD).toContain("Do not switch to a host agent's built-in image/audio generation tool");
  });
});

describe("CLAUDE_MD template", () => {
  it("imports AGENTS.md as the canonical source on the first line", () => {
    expect(CLAUDE_MD.startsWith("@AGENTS.md")).toBe(true);
  });

  it("documents the two consolidated VibeFrame slash commands (v0.62 trim from 4 → 2)", () => {
    expect(CLAUDE_MD).toContain("/vibe-pipeline");
    expect(CLAUDE_MD).toContain("/vibe-scene");
    expect(CLAUDE_MD).toContain("ASSET / BUILD / REMIX");
    expect(CLAUDE_MD).toContain("vibe edit motion-overlay");
    expect(CLAUDE_MD).toContain("Do not invoke `/vibe-scene`");
    // v0.62 explicitly removed these — overview lives in AGENTS.md, walkthrough merged into vibe-scene.
    expect(CLAUDE_MD).not.toContain("/vibeframe ");
    expect(CLAUDE_MD).not.toContain("/vibe-script-to-video");
  });

  it("provides the install-skills curl command for later updates", () => {
    expect(CLAUDE_MD).toContain("install-skills.sh");
  });
});

describe("renderEnvExample", () => {
  it("includes the local fallback header by default", () => {
    const out = renderEnvExample();
    expect(out).toContain("Local fallbacks");
    expect(out).toContain("Kokoro TTS");
  });

  it("can omit the local fallback header", () => {
    const out = renderEnvExample({ withLocalFallbackHeader: false });
    expect(out).not.toContain("Local fallbacks");
  });

  it("lists every required provider key", () => {
    const out = renderEnvExample();
    const keys = [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "XAI_API_KEY",
      "ELEVENLABS_API_KEY",
      "FAL_API_KEY",
      "RUNWAY_API_SECRET",
      "KLING_API_KEY",
      "REPLICATE_API_TOKEN",
      "OPENROUTER_API_KEY",
    ];
    for (const k of keys) {
      expect(out).toContain(k);
    }
  });

  it("groups providers by tier so users skim the right one", () => {
    const out = renderEnvExample();
    expect(out).toContain("LLM provider");
    expect(out).toContain("Media providers");
  });
});

describe("GITIGNORE_ADDITIONS", () => {
  it("ignores the .env file and renders directory", () => {
    expect(GITIGNORE_ADDITIONS).toContain(".env");
    expect(GITIGNORE_ADDITIONS).toContain("renders/");
    expect(GITIGNORE_ADDITIONS).toContain(".pipeline-state.yaml");
  });

  it("starts with the marker comment used by the merger to detect prior install", () => {
    expect(GITIGNORE_ADDITIONS).toContain("# VibeFrame");
  });
});

describe("renderProjectYaml", () => {
  it("interpolates the project name", () => {
    expect(renderProjectYaml({ name: "my-promo" })).toContain("name: my-promo");
  });

  it("commented-out provider + budget blocks are present (informational, not active)", () => {
    const out = renderProjectYaml({ name: "x" });
    expect(out).toContain("# providers:");
    expect(out).toContain("# budget:");
    expect(out).toContain("# Optional");
  });
});
