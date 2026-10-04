/**
 * The CLI's fake provider network: the shared harness from
 * `@vibeframe/ai-providers/testing` plus default happy-path routes for the
 * providers a project build uses.
 */

import {
  FAKE_MP3,
  FAKE_MP4,
  FAKE_PNG,
  FakeProviderNetwork,
  bytesResponse,
  jsonResponse,
} from "@vibeframe/ai-providers/testing";

export * from "@vibeframe/ai-providers/testing";

/**
 * Default happy-path routes for the providers a project build uses:
 * ElevenLabs (narration, music), OpenAI images, ImgBB uploads, fal
 * (Seedance queue protocol), Runway, and a CDN for media downloads.
 */
export function createFakeProviderNetwork(): FakeProviderNetwork {
  const net = new FakeProviderNetwork();
  let falRequests = 0;
  let runwayTasks = 0;
  return net
    .on("GET", "fake.media", /.*/, (req) =>
      req.path.endsWith(".png") ? bytesResponse(FAKE_PNG, "image/png") : bytesResponse(FAKE_MP4, "video/mp4")
    )
    .on("POST", "api.elevenlabs.io", /^\/v1\/text-to-speech\//, () => bytesResponse(FAKE_MP3, "audio/mpeg"))
    .on("POST", "api.elevenlabs.io", /^\/v1\/music/, () => bytesResponse(FAKE_MP3, "audio/mpeg"))
    .on("POST", "api.openai.com", /^\/v1\/images\/(generations|edits)$/, () =>
      jsonResponse({ data: [{ b64_json: FAKE_PNG.toString("base64") }] })
    )
    .on("POST", "api.imgbb.com", /^\/1\/upload$/, () =>
      jsonResponse({ success: true, data: { url: "https://fake.media/upload.png" } })
    )
    .on("POST", "queue.fal.run", /.*/, () => jsonResponse({ request_id: `fal-${++falRequests}` }))
    .on("GET", "queue.fal.run", /\/requests\/[^/]+\/status$/, () => jsonResponse({ status: "COMPLETED" }))
    // fal's client reads the request id of a result from this header.
    .on("GET", "queue.fal.run", /\/requests\/[^/]+$/, (req) =>
      jsonResponse({ video: { url: "https://fake.media/seedance.mp4" } }, 200, {
        "x-fal-request-id": req.path.split("/").at(-1) ?? "",
      })
    )
    .on("POST", "api.dev.runwayml.com", /^\/v1\/(image|text)_to_video$/, () =>
      jsonResponse({ id: `runway-${++runwayTasks}` })
    );
}
