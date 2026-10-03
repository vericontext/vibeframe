import { afterEach, describe, expect, it, vi } from "vitest";

import { OMNI_MODEL, OmniProvider, findOmniVideo } from "./gemini-omni.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("OmniProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the documented interactions request and waits for the video file", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          id: "v1_abc",
          status: "completed",
          steps: [
            { type: "user_input", content: [{ type: "text", text: "boat" }] },
            {
              type: "model_output",
              content: [{ type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/f123" }],
            },
          ],
        })
      )
      .mockResolvedValueOnce(json({ state: "ACTIVE" }));
    vi.stubGlobal("fetch", fetchMock);

    const omni = new OmniProvider();
    await omni.initialize({ apiKey: "key" });
    const result = await omni.generateVideo("boat", {
      prompt: "boat",
      referenceImage: "data:image/jpeg;base64,AAAA",
      aspectRatio: "9:16",
      resolution: "360p",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init.headers["x-goog-api-key"]).toBe("key");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: OMNI_MODEL,
      input: [
        { type: "image", data: "AAAA", mime_type: "image/jpeg" },
        { type: "text", text: "boat" },
      ],
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "360p", delivery: "uri" },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://generativelanguage.googleapis.com/v1beta/files/f123");
    expect(result).toEqual({
      id: "v1_abc",
      status: "completed",
      videoUrl: "https://generativelanguage.googleapis.com/download/v1beta/files/f123:download?alt=media",
    });
    expect(result.videoUrl).not.toContain("key=");
  });

  it("sends a bare text input for text-to-video", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ id: "v1", status: "failed", error: { message: "blocked" } }));
    vi.stubGlobal("fetch", fetchMock);

    const omni = new OmniProvider();
    await omni.initialize({ apiKey: "key" });
    const result = await omni.generateVideo("a pond", { prompt: "a pond" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).input).toBe("a pond");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("blocked");
  });

  it("surfaces HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: { message: "Unknown parameter 'inputs'." } }, 400)));
    const omni = new OmniProvider();
    await omni.initialize({ apiKey: "key" });
    const result = await omni.generateVideo("x", { prompt: "x" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("HTTP 400");
  });

  it("finds the video in steps or the SDK-style output_video field", () => {
    expect(findOmniVideo({ output_video: { type: "video", uri: "files/x" } })?.uri).toBe("files/x");
    expect(findOmniVideo({ steps: [{ type: "thought", content: [{ type: "video", uri: "no" }] }] })).toBeUndefined();
  });
});
