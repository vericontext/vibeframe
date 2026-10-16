import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TextGenerator, TextRequest } from "@vibeframe/ai-providers";

import { FakeProviderNetwork, jsonResponse } from "../../testing/fake-provider-network.js";
import { executeStoryboardRevision } from "./storyboard-revise.js";
import { draftStoryboardFromBrief } from "./storyboard-draft.js";
import { scaffoldSceneProject } from "./scene-project.js";
import { rewriteBundleFromMarkdown } from "./storyboard-source.js";

const STORYBOARD = `---
title: Demo
duration: 10
aspect: 16:9
---

# Demo

## Beat hook - Hook

\`\`\`yaml
duration: 5
narration: "Old hook."
backdrop: "Old hook backdrop."
\`\`\`

Open with the problem.

## Beat proof - Proof

\`\`\`yaml
duration: 5
narration: "Old proof."
backdrop: "Old proof backdrop."
\`\`\`

Show the mechanism.
`;

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vibe-storyboard-revise-"));
  dirs.push(dir);
  await writeFile(join(dir, "STORYBOARD.md"), STORYBOARD, "utf-8");
  await writeFile(join(dir, "DESIGN.md"), "# Design\n\nKeep it restrained.\n", "utf-8");
  return dir;
}

function response(storyboardMd: string, summary = "Updated hook."): string {
  return JSON.stringify({
    storyboardMd,
    summary,
    changedBeats: ["hook"],
    warnings: [],
  });
}

/** A text generator that answers each request with the next reply. */
function generator(...replies: string[]): TextGenerator & { requests: TextRequest[] } {
  const requests: TextRequest[] = [];
  return {
    textProvider: "fake",
    requests,
    async generateText(request) {
      requests.push(request);
      return { text: replies[Math.min(requests.length, replies.length) - 1], model: "fake-model" };
    },
  };
}

describe("executeStoryboardRevision", () => {
  it("revises an existing storyboard and writes the validated result", async () => {
    const dir = await project();
    const revised = STORYBOARD.replace("Old hook.", "Sharper hook.");

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Make the hook sharper.",
      composer: "claude",
      generator: generator(response(revised)),
    });

    expect(result.success).toBe(true);
    expect(result.kind).toBe("storyboard-revision");
    expect(result.wrote).toBe(true);
    expect(result.changedBeats).toContain("hook");
    expect(result.validation.ok).toBe(true);
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toContain("Sharper hook.");
  });

  it("dry-runs without writing and returns the revised storyboard", async () => {
    const dir = await project();
    const revised = STORYBOARD.replace("Old proof.", "Specific proof.");

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Make proof more specific.",
      composer: "gemini",
      dryRun: true,
      generator: generator(response(revised, "Updated proof.")),
    });

    expect(result.success).toBe(true);
    expect(result.wrote).toBe(false);
    expect(result.storyboard).toContain("Specific proof.");
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toContain("Old proof.");
  });

  it("self-repairs once when the first revision misses the target duration", async () => {
    const dir = await project();
    const invalid = STORYBOARD
      .replace("duration: 5\nnarration: \"Old hook.\"", "duration: 2\nnarration: \"New hook.\"")
      .replace("duration: 5\nnarration: \"Old proof.\"", "duration: 2\nnarration: \"New proof.\"");
    const repaired = STORYBOARD
      .replace("Old hook.", "New hook.")
      .replace("Old proof.", "New proof.");
    const fake = generator(response(invalid), response(repaired, "Repaired durations."));

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Revise narration and keep it ten seconds.",
      durationSec: 10,
      composer: "openai",
      generator: fake,
    });

    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1].messages[0].content).toContain("TARGET_DURATION_MISMATCH");
    expect(result.success).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("self-repair");
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toContain("New proof.");
  });

  it("does not write when the repaired storyboard is still invalid", async () => {
    const dir = await project();
    const invalid = STORYBOARD.replace("duration: 5", "duration: nope");

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Break duration.",
      durationSec: 10,
      composer: "claude",
      generator: generator(response(invalid)),
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("STORYBOARD_REVISION_INVALID");
    expect(result.wrote).toBe(false);
    expect(result.retryWith).toContain(`vibe storyboard validate ${dir} --json`);
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toBe(STORYBOARD);
  });

  it("asks the composer for the revision schema through the text contract", async () => {
    const dir = await project();
    const revised = STORYBOARD.replace("Old hook.", "Sharper hook.");
    const net = new FakeProviderNetwork();
    net.on("POST", "api.anthropic.com", /^\/v1\/messages$/, () =>
      jsonResponse({ content: [{ type: "text", text: response(revised) }], stop_reason: "end_turn" })
    );
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    net.install();
    try {
      const result = await executeStoryboardRevision({ projectDir: dir, request: "Sharper hook.", composer: "claude" });

      expect(result).toMatchObject({ success: true, provider: "claude", wrote: true });
      const body = net.requests[0].body as { system: string; output_config: { format: { schema: { required: string[] } } } };
      expect(body.system).toContain("You revise VibeFrame STORYBOARD.md files.");
      expect(body.output_config.format.schema.required).toEqual(["storyboardMd", "summary", "changedBeats", "warnings"]);
      expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toContain("Sharper hook.");
    } finally {
      net.uninstall();
      vi.unstubAllEnvs();
    }
  });

  it("reports a provider failure with its own code and leaves the storyboard alone", async () => {
    const dir = await project();
    const net = new FakeProviderNetwork();
    net.on("POST", "api.anthropic.com", /^\/v1\/messages$/, () =>
      jsonResponse({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401)
    );
    vi.stubEnv("ANTHROPIC_API_KEY", "bad-key");
    net.install();
    try {
      const result = await executeStoryboardRevision({ projectDir: dir, request: "Anything.", composer: "claude" });

      expect(result).toMatchObject({ success: false, code: "STORYBOARD_REVISION_PROVIDER_ERROR", wrote: false });
      expect(result.suggestion).toContain("vibe setup");
      expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toBe(STORYBOARD);
    } finally {
      net.uninstall();
      vi.unstubAllEnvs();
    }
  });

  it("drafts from a brief over the offline skeleton, replacing its scenes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vibe-storyboard-draft-"));
    dirs.push(dir);
    await scaffoldSceneProject({ dir, name: "boats", aspect: "16:9", duration: 10 });
    const brief = "A 10-second explainer on why paper boats float: hook, buoyancy.";
    const skeleton = draftStoryboardFromBrief({ name: "boats", brief, durationSec: 10 });
    await rewriteBundleFromMarkdown(dir, skeleton.storyboardMd);
    expect((await readdir(join(dir, "scenes"))).sort()).toEqual(["01-hook.md", "02-buoyancy.md"]);

    const drafted = skeleton.storyboardMd
      .replace(/## Beat hook - Hook[\s\S]*$/, "")
      .concat(
        "## Beat question - Question\n\n```yaml\nduration: 4\nnarration: \"Why does paper float?\"\nbackdrop: \"paper boat on a pond\"\n```\n\nAsk.\n\n",
        "## Beat air - Trapped air\n\n```yaml\nduration: 6\nnarration: \"Trapped air makes it lighter than the water it pushes aside.\"\nbackdrop: \"cutaway of a paper hull\"\n```\n\nExplain.\n"
      );
    const fake = generator(JSON.stringify({ storyboardMd: drafted, summary: "Drafted.", changedBeats: ["question", "air"], warnings: [] }));

    const result = await executeStoryboardRevision({ projectDir: dir, request: brief, durationSec: 10, mode: "draft", generator: fake });

    expect(result).toMatchObject({ success: true, wrote: true });
    expect(fake.requests[0].system).toContain("from a brief");
    expect(fake.requests[0].messages[0].content).toContain(`Brief:\n${brief}`);
    expect((await readdir(join(dir, "scenes"))).sort()).toEqual(["01-question.md", "02-air.md"]);
    expect(await readFile(join(dir, "scenes", "02-air.md"), "utf-8")).toContain("Trapped air");
  });
});
