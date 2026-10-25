/**
 * Paid MCP generations without an `output`: the result still lands on disk
 * under the working directory, never over an earlier one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeProviderNetwork, type FakeProviderNetwork } from "../../testing/fake-provider-network.js";
import { manifest } from "./index.js";

let net: FakeProviderNetwork;
let cwd: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  Object.assign(process.env, { OPENAI_API_KEY: "test-openai", FAL_API_KEY: "test-fal" });
  cwd = mkdtempSync(join(tmpdir(), "vibe-generate-output-"));
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  rmSync(cwd, { recursive: true, force: true });
});

async function runTool(name: string, args: Record<string, unknown>) {
  const tool = manifest.find((entry) => entry.name === name)!;
  return tool.execute(tool.schema.parse(args), { workingDirectory: cwd, surface: "mcp" });
}

describe("generate tools without an output path", () => {
  it("generate_image saves to image.png, then the next free name", async () => {
    writeFileSync(join(cwd, "image.png"), "an earlier image");

    const result = await runTool("generate_image", { prompt: "a paper boat", provider: "openai" });

    expect(result).toMatchObject({ success: true, data: { outputPath: join(cwd, "image-2.png") } });
    expect(existsSync(join(cwd, "image-2.png"))).toBe(true);
    expect(result.humanLines?.join("\n")).not.toContain("undefined");
  });

  it("generate_video downloads to video.mp4 instead of leaving only the provider URL", async () => {
    const result = await runTool("generate_video", { prompt: "a paper boat", provider: "seedance" });

    expect(result).toMatchObject({ success: true, data: { outputPath: join(cwd, "video.mp4") } });
    expect(existsSync(join(cwd, "video.mp4"))).toBe(true);
  });
});
