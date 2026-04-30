/**
 * @file project-resolver.test.ts
 *
 * Coverage for the timeline file resolver. The CLI accepts file paths,
 * directory paths, and unknown paths; the resolver normalizes all three
 * to a concrete file path that the caller can `readFile()`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveTimelineFile,
  detectSceneProject,
  TIMELINE_FILENAME,
  LEGACY_TIMELINE_FILENAME,
  SCENE_CONFIG_FILENAME,
} from "./project-resolver.js";

let workdir: string;

beforeEach(async () => {
  workdir = resolve(tmpdir(), `vibe-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workdir, { recursive: true });
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("resolveTimelineFile", () => {
  it("passes through a direct file path", async () => {
    const filePath = resolve(workdir, "custom.json");
    await writeFile(filePath, "{}");
    const result = await resolveTimelineFile(filePath);
    expect(result).toBe(filePath);
  });

  it("prefers timeline.json when both present in directory", async () => {
    await writeFile(resolve(workdir, TIMELINE_FILENAME), "{}");
    await writeFile(resolve(workdir, LEGACY_TIMELINE_FILENAME), "{}");
    const result = await resolveTimelineFile(workdir);
    expect(result).toBe(resolve(workdir, TIMELINE_FILENAME));
  });

  it("resolves to timeline.json when only canonical exists", async () => {
    await writeFile(resolve(workdir, TIMELINE_FILENAME), "{}");
    const result = await resolveTimelineFile(workdir);
    expect(result).toBe(resolve(workdir, TIMELINE_FILENAME));
  });

  it("falls back to project.vibe.json when only legacy exists", async () => {
    await writeFile(resolve(workdir, LEGACY_TIMELINE_FILENAME), "{}");
    const result = await resolveTimelineFile(workdir);
    expect(result).toBe(resolve(workdir, LEGACY_TIMELINE_FILENAME));
  });

  it("returns canonical path for empty directory (caller surfaces ENOENT)", async () => {
    const result = await resolveTimelineFile(workdir);
    expect(result).toBe(resolve(workdir, TIMELINE_FILENAME));
  });

  it("passes through a non-existent path unchanged", async () => {
    const ghostPath = resolve(workdir, "does-not-exist.json");
    const result = await resolveTimelineFile(ghostPath);
    expect(result).toBe(ghostPath);
  });

  it("respects the cwd parameter", async () => {
    await writeFile(resolve(workdir, TIMELINE_FILENAME), "{}");
    const result = await resolveTimelineFile(".", workdir);
    expect(result).toBe(resolve(workdir, TIMELINE_FILENAME));
  });
});

describe("detectSceneProject", () => {
  it("returns true when vibe.project.yaml is present", async () => {
    await writeFile(resolve(workdir, SCENE_CONFIG_FILENAME), "name: foo\n");
    expect(await detectSceneProject(workdir)).toBe(true);
  });

  it("returns false for empty directory", async () => {
    expect(await detectSceneProject(workdir)).toBe(false);
  });

  it("returns false when only timeline.json present", async () => {
    await writeFile(resolve(workdir, TIMELINE_FILENAME), "{}");
    expect(await detectSceneProject(workdir)).toBe(false);
  });

  it("returns false for non-existent directory", async () => {
    expect(await detectSceneProject(resolve(workdir, "ghost"))).toBe(false);
  });
});
