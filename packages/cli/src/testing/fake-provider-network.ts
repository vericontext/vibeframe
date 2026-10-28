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
 * A Scribe (`POST /v1/speech-to-text`) reply: two sentences, a filler word,
 * and the spacing tokens between words. "Um, so the paper boat drifts. It
 * floats away."
 */
export const FAKE_SCRIBE_TRANSCRIPT = {
  language_code: "eng",
  language_probability: 0.98,
  text: "Um, so the paper boat drifts. It floats away.",
  words: [
    ["Um,", 0.0, 0.3],
    ["so", 0.4, 0.6],
    ["the", 0.65, 0.8],
    ["paper", 0.85, 1.2],
    ["boat", 1.25, 1.5],
    ["drifts.", 1.55, 2.0],
    ["It", 2.6, 2.75],
    ["floats", 2.8, 3.2],
    ["away.", 3.25, 3.7],
  ].flatMap(([text, start, end], i, all) => {
    const token = { text, type: "word", start, end, speaker_id: "speaker_0", logprob: -0.05 };
    const next = all[i + 1];
    return next ? [token, { text: " ", type: "spacing", start: end, end: next[1], speaker_id: "speaker_0", logprob: 0 }] : [token];
  }),
};

/** A Whisper (`POST /v1/audio/transcriptions`, verbose_json) reply for the same speech. */
export const FAKE_WHISPER_TRANSCRIPT = {
  text: "Um, so the paper boat drifts. It floats away.",
  language: "english",
  segments: [
    { id: 0, start: 0, end: 2.0, text: " Um, so the paper boat drifts." },
    { id: 1, start: 2.6, end: 3.7, text: " It floats away." },
  ],
  words: [
    { word: "Um", start: 0.0, end: 0.3 },
    { word: "so", start: 0.4, end: 0.6 },
    { word: "the", start: 0.65, end: 0.8 },
    { word: "paper", start: 0.85, end: 1.2 },
    { word: "boat", start: 1.25, end: 1.5 },
    { word: "drifts", start: 1.55, end: 2.0 },
    { word: "It", start: 2.6, end: 2.75 },
    { word: "floats", start: 2.8, end: 3.2 },
    { word: "away", start: 3.25, end: 3.7 },
  ],
};

/**
 * Default happy-path routes for the providers a project build uses:
 * ElevenLabs (narration, music, Scribe transcription), OpenAI images and
 * Whisper transcription, ImgBB uploads, fal
 * (Seedance queue protocol and storage uploads), Runway (submit and
 * polling), and a CDN for media downloads.
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
    .on("POST", "api.elevenlabs.io", /^\/v1\/speech-to-text$/, () => jsonResponse(FAKE_SCRIBE_TRANSCRIPT))
    .on("POST", "api.openai.com", /^\/v1\/audio\/transcriptions$/, () => jsonResponse(FAKE_WHISPER_TRANSCRIPT))
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
    // fal storage: local frames are uploaded before a Seedance submit.
    .on("POST", "rest.fal.ai", /^\/storage\/upload\/initiate$/, () =>
      jsonResponse({ upload_url: "https://fake.media/fal-upload", file_url: "https://fake.media/fal-frame.png" })
    )
    .on("PUT", "fake.media", /^\/fal-upload$/, () => new Response(null, { status: 200 }))
    .on("POST", "api.dev.runwayml.com", /^\/v1\/(image|text)_to_video$/, () =>
      jsonResponse({ id: `runway-${++runwayTasks}` })
    )
    .on("GET", "api.dev.runwayml.com", /^\/v1\/tasks\/[^/]+$/, (req) =>
      jsonResponse({ id: req.path.split("/").at(-1), status: "SUCCEEDED", output: ["https://fake.media/runway.mp4"] })
    );
}
