/**
 * End-to-end `vibe build --stage assets` against a fake provider network.
 *
 * Unlike scene-build.test.ts, nothing above `fetch` is mocked: real provider
 * classes, the video executor, upload hosts, file writes, and the build
 * report all run. Only local tools (ffprobe) are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../utils/audio.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/audio.js")>()),
  getAudioDuration: vi.fn(async () => 2.5),
}));

import { createFakeProviderNetwork, jsonResponse, type FakeProviderNetwork } from "../../testing/fake-provider-network.js";
import { __setFfmpegToolsForTests } from "./ffmpeg-gate.js";
import { executeSceneBuild } from "./scene-build.js";

const KEYS = {
  ELEVENLABS_API_KEY: "test-elevenlabs",
  OPENAI_API_KEY: "test-openai",
  FAL_API_KEY: "test-fal",
  RUNWAY_API_SECRET: "test-runway",
  IMGBB_API_KEY: "test-imgbb",
  VIBE_UPLOAD_PROVIDER: "imgbb",
};

function storyboard(beatYaml: string): string {
  return `---
project: network-test
providers:
  tts: elevenlabs
  image: openai
  video: seedance
  music: elevenlabs
---

## Beat pond — Pond

\`\`\`yaml
duration: 4
${beatYaml}
\`\`\`
`;
}

let projectDir: string;
let net: FakeProviderNetwork;
const savedEnv = { ...process.env };

beforeEach(() => {
  __setFfmpegToolsForTests(true);
  Object.assign(process.env, KEYS);
  projectDir = mkdtempSync(join(tmpdir(), "scene-build-network-"));
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  writeFileSync(join(projectDir, "DESIGN.md"), "# Design\n");
  net = createFakeProviderNetwork();
  net.install();
});

afterEach(() => {
  net.uninstall();
  process.env = { ...savedEnv };
  rmSync(projectDir, { recursive: true, force: true });
});

describe("vibe build --stage assets over the provider network", () => {
  it("generates narration, backdrop, video, and music into a fresh project", async () => {
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      storyboard(`narration: "A paper boat drifts."
backdrop: "Calm pond at dusk"
video: "Slow push-in on the boat"
music: "Soft piano"`)
    );

    const report = await executeSceneBuild({ projectDir, stage: "assets" });

    expect(report.success).toBe(true);
    const beat = report.beats[0];
    expect(beat.narrationStatus).toBe("generated");
    expect(beat.backdropStatus).toBe("generated");
    expect(beat.videoStatus).toBe("generated");
    // The assets/ directory did not exist before the build: every writer
    // has to create it (a missing mkdir lost a paid video once).
    expect(readFileSync(join(projectDir, "assets/backdrop-pond.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(existsSync(join(projectDir, "assets/video-pond.mp4"))).toBe(true);

    const tts = net.to("api.elevenlabs.io").find((r) => r.path.startsWith("/v1/text-to-speech/"));
    expect(tts?.headers["xi-api-key"]).toBe("test-elevenlabs");
    const image = net.to("api.openai.com")[0];
    expect((image.body as { model: string }).model).toBe("gpt-image-2.5-sunburst");
    const seedance = net.to("queue.fal.run").find((r) => r.method === "POST");
    expect(seedance?.path).toBe("/bytedance/seedance-2.0/text-to-video");
    expect((seedance?.body as { duration: string }).duration).toBe("4");
    expect(net.to("api.elevenlabs.io").some((r) => r.path.startsWith("/v1/music"))).toBe(true);
  });

  it("saves the clip when video is the only asset, so nothing else created assets/", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`video: "Slow push-in on the boat"`));

    const report = await executeSceneBuild({ projectDir, stage: "assets" });

    expect(report.beats[0].videoStatus).toBe("generated");
    expect(existsSync(join(projectDir, "assets/video-pond.mp4"))).toBe(true);
  });

  it("records the video job with its handle before waiting, then marks it completed", async () => {
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`video: "Slow push-in on the boat"`));

    await executeSceneBuild({ projectDir, stage: "assets" });

    const jobsDir = join(projectDir, ".vibeframe", "jobs");
    const records = readdirSync(jobsDir).map((f) => JSON.parse(readFileSync(join(jobsDir, f), "utf-8")));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      jobType: "generate-video",
      provider: "seedance",
      status: "completed",
      beatId: "pond",
      providerJob: { provider: "seedance", model: "seedance-2.0", meta: { endpoint: "bytedance/seedance-2.0/text-to-video" } },
    });
  });

  it("falls back to Runway when Seedance rejects a keyframe for a real person's likeness", async () => {
    net.on("POST", "queue.fal.run", /image-to-video$/, () =>
      jsonResponse(
        { detail: [{ msg: "The images or videos provided may contain likenesses of real people", type: "content_policy_violation" }] },
        422
      )
    );
    writeFileSync(
      join(projectDir, "STORYBOARD.md"),
      storyboard(`keyframe: "Close-up of a fisherman smiling"
video: "He looks up at the camera"`)
    );

    const report = await executeSceneBuild({ projectDir, stage: "assets" });

    expect(net.to("queue.fal.run").some((r) => r.path.endsWith("/image-to-video"))).toBe(true);
    const runway = net.to("api.dev.runwayml.com").find((r) => r.method === "POST");
    expect(runway?.path).toBe("/v1/image_to_video");
    expect((runway?.body as { model: string }).model).toBe("gen4.5");
    expect(report.beats[0].videoStatus).not.toBe("failed");
  });

  it("reports a provider error on the beat instead of crashing the build", async () => {
    net.on("POST", "api.elevenlabs.io", /^\/v1\/text-to-speech\//, () =>
      jsonResponse({ detail: { message: "invalid api key" } }, 401)
    );
    writeFileSync(join(projectDir, "STORYBOARD.md"), storyboard(`narration: "Hello."`));

    const report = await executeSceneBuild({ projectDir, stage: "assets" });

    expect(report.success).toBe(false);
    expect(report.beats[0].narrationStatus).toBe("failed");
    expect(report.beats[0].narrationError ?? report.error).toMatch(/401|invalid api key/i);
  });
});
