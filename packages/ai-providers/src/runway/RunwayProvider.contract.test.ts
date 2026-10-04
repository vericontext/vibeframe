import { describeVideoContract } from "../video/contract.testkit.js";
import { jsonResponse, type FakeProviderNetwork } from "../testing/fake-provider-network.js";
import { RunwayProvider } from "./RunwayProvider.js";

const HOST = "api.dev.runwayml.com";

function scriptJob(net: FakeProviderNetwork, final: Record<string, unknown>): void {
  let polls = 0;
  net
    .on("POST", HOST, /^\/v1\/(text|image)_to_video$/, () => jsonResponse({ id: "task-1" }))
    .on("GET", HOST, /^\/v1\/tasks\/task-1$/, () =>
      jsonResponse(++polls < 2 ? { id: "task-1", status: "RUNNING", progress: 0.4 } : { id: "task-1", ...final })
    )
    .on("DELETE", HOST, /^\/v1\/tasks\/task-1$/, () => new Response(null, { status: 204 }));
}

describeVideoContract("RunwayProvider", {
  async create() {
    const provider = new RunwayProvider();
    await provider.initialize({ apiKey: "test-runway" });
    return provider;
  },
  request: { prompt: "A paper boat drifts", aspectRatio: "16:9", durationSec: 5 },
  defaultModel: "gen4.5",
  scriptSuccess: (net) => scriptJob(net, { status: "SUCCEEDED", output: ["https://fake.media/out.mp4"] }),
  scriptJobFailure: (net, reason) =>
    scriptJob(
      net,
      reason === "moderation"
        ? { status: "FAILED", failure: "Input rejected", failureCode: "SAFETY.INPUT.TEXT" }
        : { status: "FAILED", failure: "An unexpected error occurred", failureCode: "INTERNAL" }
    ),
  scriptSubmitError: (net, status, body) =>
    net.on("POST", HOST, /^\/v1\/(text|image)_to_video$/, () => jsonResponse(body, status)),
  cancel: true,
  continuations: [],
});
