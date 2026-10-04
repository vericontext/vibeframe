import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeVideoContract } from "../video/contract.testkit.js";
import { FAKE_MP4, FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { OmniProvider, findOmniVideo } from "./gemini-omni.js";

const HOST = "generativelanguage.googleapis.com";
const VIDEO_STEP = {
  type: "model_output",
  content: [{ type: "video", mime_type: "video/mp4", uri: `https://${HOST}/v1beta/files/file-1:download?alt=media` }],
};

/** Accepted, one in-progress poll, then `final`; the file is ACTIVE unless told otherwise. */
function scriptInteraction(net: FakeProviderNetwork, final: Record<string, unknown>, fileStates = ["ACTIVE"]): void {
  let polls = 0;
  net
    .on("POST", HOST, /^\/v1beta\/interactions$/, () => jsonResponse({ id: "int-1", status: "in_progress" }))
    .on("GET", HOST, /^\/v1beta\/interactions\/int-1$/, () =>
      jsonResponse(++polls < 2 ? { id: "int-1", status: "in_progress" } : { id: "int-1", ...final })
    )
    .on("POST", HOST, /^\/v1beta\/interactions\/int-1\/cancel$/, () => jsonResponse({ id: "int-1", status: "cancelled" }))
    .on("GET", HOST, /^\/v1beta\/files\/file-1$/, () => jsonResponse({ state: fileStates.shift() ?? "ACTIVE" }))
    .on("GET", HOST, /^\/download\/v1beta\/files\/file-1:download$/, () => new Response(new Uint8Array(FAKE_MP4)));
}

async function create() {
  const provider = new OmniProvider();
  await provider.initialize({ apiKey: "test-google" });
  return provider;
}

describeVideoContract("OmniProvider", {
  create,
  request: { prompt: "A paper boat drifts", aspectRatio: "16:9" },
  defaultModel: "gemini-omni-1.1-flash",
  scriptSuccess: (net) => {
    scriptInteraction(net, { status: "completed", steps: [VIDEO_STEP] });
    // The contract suite downloads from fake.media; Omni's real URL is the Files API.
    net.on("GET", HOST, /^\/download\//, () => new Response(new Uint8Array(FAKE_MP4)));
  },
  scriptJobFailure: (net, reason) =>
    scriptInteraction(
      net,
      reason === "moderation"
        ? { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "I can't make that." }] }] }
        : { status: "failed", error: { code: 500, status: "INTERNAL", message: "Internal error encountered." } }
    ),
  scriptSubmitError: (net, status, body) =>
    net.on("POST", HOST, /^\/v1beta\/interactions$/, () => jsonResponse(body, status)),
  cancel: true,
  continuations: ["edit", "extend"],
  videoUrl: `https://${HOST}/download/v1beta/files/file-1:download?alt=media`,
});

describe("OmniProvider requests", () => {
  let net: FakeProviderNetwork;
  const submitted = () =>
    net.requests.filter((r) => r.method === "POST" && r.path === "/v1beta/interactions").at(-1)!.body as Record<string, unknown>;

  beforeEach(() => {
    net = new FakeProviderNetwork();
    net.install();
    scriptInteraction(net, { status: "completed", steps: [VIDEO_STEP] });
  });

  afterEach(() => net.uninstall());

  it("submits text-to-video in the background with a bare text input and uri delivery", async () => {
    const omni = await create();
    await omni.submitVideo({ prompt: "a paper boat", aspectRatio: "9:16", resolution: "1080p" });

    expect(submitted()).toEqual({
      model: "gemini-omni-1.1-flash",
      input: "a paper boat",
      background: true,
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "1080p", delivery: "uri" },
    });
    expect(net.requests[0].headers["x-goog-api-key"]).toBe("test-google");
    expect(net.requests[0].url).not.toContain("key=");
  });

  it("sends first and last frames inline before the text", async () => {
    const omni = await create();
    await omni.submitVideo({ prompt: "p", image: "data:image/jpeg;base64,AAA", lastFrame: "data:image/png;base64,BBB" });

    expect(submitted().input).toEqual([
      { type: "image", mime_type: "image/jpeg", data: "AAA" },
      { type: "image", mime_type: "image/png", data: "BBB" },
      { type: "text", text: "p" },
    ]);
  });

  it("refuses an image URL, since Omni only takes inline frames", async () => {
    const omni = await create();
    await expect(omni.submitVideo({ prompt: "p", image: "https://fake.media/a.png" })).rejects.toMatchObject({
      kind: "invalid-request",
    });
    expect(net.requests).toHaveLength(0);
  });

  it.each(["edit", "extend"] as const)("chains a %s onto the earlier interaction", async (kind) => {
    const omni = await create();
    const first = await omni.submitVideo({ prompt: "a paper boat" });
    await omni.submitVideo({ prompt: "make it night", from: { job: first, kind } });

    expect(submitted()).toMatchObject({ previous_interaction_id: "int-1" });
    expect(String(submitted().input)).toContain("make it night");
  });

  it("keeps polling while the finished video's file is still processing", async () => {
    net.uninstall();
    net = new FakeProviderNetwork();
    net.install();
    scriptInteraction(net, { status: "completed", steps: [VIDEO_STEP] }, ["PROCESSING", "ACTIVE"]);
    const omni = await create();
    const job = await omni.submitVideo({ prompt: "p" });
    const states: string[] = [];
    for (let i = 0; i < 4; i++) states.push((await omni.getVideoJob(job)).status);

    expect(states).toEqual(["processing", "processing", "completed", "completed"]);
  });

  it("finds the video in steps or the SDK-style output_video field", () => {
    expect(findOmniVideo({ steps: [VIDEO_STEP] })?.uri).toContain("file-1");
    expect(findOmniVideo({ output_video: { type: "video", uri: "x" } })?.uri).toBe("x");
    expect(findOmniVideo({ steps: [] })).toBeUndefined();
  });
});
