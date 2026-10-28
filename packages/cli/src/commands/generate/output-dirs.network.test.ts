/**
 * Generators create the output's parent directory. `vibe build` runs the
 * music writer concurrently with the others, and when music finished first
 * `assets/` did not exist yet: the paid result was lost to ENOENT (seen as a
 * flaky scene-build network test). Here each writer gets a directory that
 * does not exist, so the race cannot hide a missing mkdir.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bytesResponse, createFakeProviderNetwork, type FakeProviderNetwork } from "../../testing/fake-provider-network.js";
import { executeMusic } from "./music.js";
import { executeSoundEffect } from "./sound-effect.js";

let dir: string;
let net: FakeProviderNetwork;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibe-output-dirs-"));
  net = createFakeProviderNetwork().on("POST", "api.elevenlabs.io", /^\/v1\/sound-generation/, () =>
    bytesResponse(Buffer.from([0xff, 0xfb, 0x90, 0x00]), "audio/mpeg")
  );
  net.install();
});

afterEach(() => {
  net.uninstall();
  rmSync(dir, { recursive: true, force: true });
});

describe("generators write into a directory that does not exist yet", () => {
  it("music", async () => {
    const output = join(dir, "assets", "music.mp3");
    const result = await executeMusic({ prompt: "soft piano", provider: "elevenlabs", duration: 5, output, apiKey: "test" });

    expect(result).toMatchObject({ success: true, outputPath: output });
    expect(existsSync(output)).toBe(true);
  });

  it("sound effect", async () => {
    const output = join(dir, "sfx", "door.mp3");
    const result = await executeSoundEffect({ prompt: "door creak", output, apiKey: "test" });

    expect(result).toMatchObject({ success: true, outputPath: output });
    expect(existsSync(output)).toBe(true);
  });
});
