import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeStoryboardRevision,
  type StoryboardRevisionChat,
} from "./storyboard-revise.js";

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

describe("executeStoryboardRevision", () => {
  it("revises an existing storyboard and writes the validated result", async () => {
    const dir = await project();
    const revised = STORYBOARD.replace("Old hook.", "Sharper hook.");
    const chat: StoryboardRevisionChat = async () => response(revised);

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Make the hook sharper.",
      composer: "claude",
      chat,
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
    const chat: StoryboardRevisionChat = async () => response(revised, "Updated proof.");

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Make proof more specific.",
      composer: "gemini",
      dryRun: true,
      chat,
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
    const calls: string[] = [];
    const chat: StoryboardRevisionChat = async (messages) => {
      calls.push(messages.map((message) => message.content).join("\n"));
      return calls.length === 1 ? response(invalid) : response(repaired, "Repaired durations.");
    };

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Revise narration and keep it ten seconds.",
      durationSec: 10,
      composer: "openai",
      chat,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("TARGET_DURATION_MISMATCH");
    expect(result.success).toBe(true);
    expect(result.validation.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("self-repair");
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toContain("New proof.");
  });

  it("does not write when the repaired storyboard is still invalid", async () => {
    const dir = await project();
    const invalid = STORYBOARD.replace("duration: 5", "duration: nope");
    const chat: StoryboardRevisionChat = async () => response(invalid);

    const result = await executeStoryboardRevision({
      projectDir: dir,
      request: "Break duration.",
      durationSec: 10,
      composer: "claude",
      chat,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("STORYBOARD_REVISION_INVALID");
    expect(result.wrote).toBe(false);
    expect(result.retryWith).toContain(`vibe storyboard validate ${dir} --json`);
    expect(await readFile(join(dir, "STORYBOARD.md"), "utf-8")).toBe(STORYBOARD);
  });
});
