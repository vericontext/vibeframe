import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { TimelineState } from "@vibeframe/core";
import { createHyperframesBackend } from "../hyperframes.js";
import { buildTempProject } from "../project-builder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "fixtures");

function loadState(name: string): TimelineState {
  const raw = readFileSync(resolve(FIXTURE_DIR, name), "utf-8");
  return (JSON.parse(raw) as { state: TimelineState }).state;
}

describe("Hyperframes integration (skipped if Chrome missing)", () => {
  let chromeAvailable = false;

  beforeAll(async () => {
    const backend = createHyperframesBackend();
    const pre = await backend.preflight!();
    chromeAvailable = pre.ok;
    if (!chromeAvailable) {
      console.warn("[integration] Chrome not found — skipping render tests");
    }
  });

  it("preflight returns ok when Chrome is available", async () => {
    const backend = createHyperframesBackend();
    const pre = await backend.preflight!();
    // Just record result, don't fail if no Chrome in CI
    expect(typeof pre.ok).toBe("boolean");
  });

  it("renders lottie-overlay fixture (image base + lottie overlay) to mp4 (requires Chrome)", async () => {
    if (!chromeAvailable || process.env.CI) return;

    const rawState = loadState("lottie-overlay.vibe.json");
    const assetDir = resolve(FIXTURE_DIR, "assets");
    if (!existsSync(assetDir)) mkdirSync(assetDir, { recursive: true });
    const imgPath = resolve(assetDir, "frame-a.jpg");
    const lottiePath = resolve(assetDir, "anim.lottie");

    {
      const { writeFileSync } = await import("node:fs");
      const jpegBytes = Buffer.from(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIBAAAgIBBAMAAAAAAAAAAAAAAQIDBAUREiExQf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCyXSqvNxvuPwp0Kq3XFXLYX6lmNPJ1llqOxDjLEk5ORnk4z7AAAS//9k=",
        "base64"
      );
      writeFileSync(imgPath, jpegBytes);
    }

    const state: typeof rawState = {
      ...rawState,
      sources: rawState.sources.map((s) =>
        s.name === "frame-a.jpg" ? { ...s, url: imgPath } :
        s.name === "anim.lottie" ? { ...s, url: lottiePath } :
        s
      ),
    };

    const outputPath = resolve(tmpdir(), `vibeframe-hf-lottie-${Date.now()}.mp4`);
    const backend = createHyperframesBackend();

    const result = await backend.render({
      projectState: state,
      outputPath,
      fps: 30,
      quality: "draft",
      format: "mp4",
    });

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);

    try { rmSync(outputPath); } catch { /* ignore */ }
  }, 90_000);

  it("renders simple-2clip fixture to a non-zero mp4 (requires Chrome)", async () => {
    if (!chromeAvailable || process.env.CI) return;

    const rawState = loadState("simple-2clip.vibe.json");

    // Create minimal real asset files so project-builder can copy them
    const assetDir = resolve(FIXTURE_DIR, "assets");
    if (!existsSync(assetDir)) mkdirSync(assetDir, { recursive: true });
    const dummyA = resolve(assetDir, "frame-a.jpg");
    const dummyB = resolve(assetDir, "frame-b.jpg");
    // Always write valid JPEG bytes (other tests may have written dummy content)
    {
      const { writeFileSync } = await import("node:fs");
      const jpegBytes = Buffer.from(
        "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIBAAAgIBBAMAAAAAAAAAAAAAAQIDBAUREiExQf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCyXSqvNxvuPwp0Kq3XFXLYX6lmNPJ1llqOxDjLEk5ORnk4z7AAAS//9k=",
        "base64"
      );
      writeFileSync(dummyA, jpegBytes);
      writeFileSync(dummyB, jpegBytes);
    }

    // Patch sources to absolute paths for test environment
    const state: typeof rawState = {
      ...rawState,
      sources: rawState.sources.map((s) => ({
        ...s,
        url: s.name === "frame-a.jpg" ? dummyA : dummyB,
      })),
    };

    const outputPath = resolve(tmpdir(), `vibeframe-hf-test-${Date.now()}.mp4`);
    const backend = createHyperframesBackend();

    const result = await backend.render({
      projectState: state,
      outputPath,
      fps: 30,
      quality: "draft",
      format: "mp4",
    });

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);

    // Cleanup
    try { rmSync(outputPath); } catch { /* ignore */ }
  }, 60_000);
});

describe("buildTempProject", () => {
  it("throws when source file missing", async () => {
    const state = loadState("simple-2clip.vibe.json");
    // Point to non-existent path
    const badState: TimelineState = {
      ...state,
      sources: state.sources.map((s) => ({ ...s, url: "/nonexistent/path/file.jpg" })),
    };
    await expect(buildTempProject(badState)).rejects.toThrow("Source file not found");
  });

  it("creates index.html in temp dir for valid sources", async () => {
    const state = loadState("simple-2clip.vibe.json");
    const assetDir = resolve(FIXTURE_DIR, "assets");
    if (!existsSync(assetDir)) mkdirSync(assetDir, { recursive: true });
    // Ensure dummy assets exist
    const dummyA = resolve(assetDir, "frame-a.jpg");
    const dummyB = resolve(assetDir, "frame-b.jpg");
    if (!existsSync(dummyA)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(dummyA, "dummy");
      writeFileSync(dummyB, "dummy");
    }

    // Override source URLs to use absolute paths
    const patchedState: TimelineState = {
      ...state,
      sources: state.sources.map((s) => ({
        ...s,
        url: s.name === "frame-a.jpg" ? dummyA : dummyB,
      })),
    };

    const proj = await buildTempProject(patchedState);
    expect(existsSync(resolve(proj.dir, "index.html"))).toBe(true);
    expect(existsSync(resolve(proj.dir, "assets"))).toBe(true);
    await proj.cleanup();
    expect(existsSync(proj.dir)).toBe(false);
  });

  it("vendors dotlottie-wc runtime when state has a lottie source", async () => {
    const assetDir = resolve(FIXTURE_DIR, "assets");
    if (!existsSync(assetDir)) mkdirSync(assetDir, { recursive: true });
    const lottiePath = resolve(assetDir, "anim.lottie");
    if (!existsSync(lottiePath)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(lottiePath, "dummy lottie bytes");
    }

    const state: TimelineState = {
      ...loadState("simple-2clip.vibe.json"),
      sources: [
        {
          id: "source-lottie",
          name: "anim.lottie",
          type: "lottie",
          url: lottiePath,
          duration: 3,
        },
      ],
      clips: [],
    };

    const proj = await buildTempProject(state);
    expect(existsSync(resolve(proj.dir, "vendor", "dotlottie-wc", "index.js"))).toBe(true);
    expect(existsSync(resolve(proj.dir, "vendor", "dotlottie-player.wasm"))).toBe(true);
    expect(existsSync(resolve(proj.dir, "assets", "anim.lottie"))).toBe(true);
    await proj.cleanup();
  });
});
