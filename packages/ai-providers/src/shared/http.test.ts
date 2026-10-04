import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeProviderNetwork, jsonResponse } from "../testing/fake-provider-network.js";
import { ProviderError } from "./errors.js";
import { parseErrorBody, providerRequest } from "./http.js";

let net: FakeProviderNetwork;

beforeEach(() => {
  net = new FakeProviderNetwork();
  net.install();
});

afterEach(() => net.uninstall());

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    return error as ProviderError;
  }
  throw new Error("expected a rejection");
}

describe("providerRequest", () => {
  it("retries rate limits and 5xx, honouring Retry-After", async () => {
    const statuses = [429, 503];
    net.on("GET", "api.test", /\/jobs$/, () => {
      const status = statuses.shift();
      return status
        ? new Response("busy", { status, headers: status === 429 ? { "retry-after": "0" } : {} })
        : jsonResponse({ ok: true });
    });

    const response = await providerRequest("test", "https://api.test/jobs", {}, { backoffMs: 1 });

    expect(await response.json()).toEqual({ ok: true });
    expect(net.requests).toHaveLength(3);
  });

  it("throws a classified error once retries are spent", async () => {
    net.on("GET", "api.test", /\/jobs$/, () => new Response("busy", { status: 503 }));

    const error = await rejection(providerRequest("test", "https://api.test/jobs", {}, { backoffMs: 1, attempts: 2 }));

    expect(error).toMatchObject({ kind: "provider", status: 503, retryable: true });
    expect(error.message).toBe("GET /jobs -> 503: busy");
    expect(net.requests).toHaveLength(2);
  });

  it("does not retry a client error, and keeps the provider's message and code", async () => {
    net.on("POST", "api.test", /\/jobs$/, () =>
      jsonResponse({ detail: [{ msg: "likenesses of real people", type: "content_policy_violation" }] }, 422)
    );

    const error = await rejection(providerRequest("test", "https://api.test/jobs?key=secret", { method: "POST" }));

    expect(error).toMatchObject({ kind: "likeness", status: 422, retryable: false });
    // The path is reported without the query string, so keys never leak into messages.
    expect(error.message).toBe("POST /jobs -> 422: likenesses of real people");
    expect(net.requests).toHaveLength(1);
  });

  it("reports a network failure as retryable", async () => {
    const error = await rejection(providerRequest("test", "https://unrouted.test/x", {}, { backoffMs: 1, attempts: 2 }));
    expect(error).toMatchObject({ kind: "network", retryable: true });
  });
});

describe("parseErrorBody", () => {
  it("reads the common JSON error shapes", () => {
    expect(parseErrorBody('{"error":"bad key"}')).toEqual({ message: "bad key" });
    expect(parseErrorBody('{"error":{"message":"slow down","code":"rate_limited"}}')).toEqual({
      message: "slow down",
      code: "rate_limited",
    });
    expect(parseErrorBody('{"message":"nope","failureCode":"SAFETY.INPUT.IMAGE"}')).toEqual({
      message: "nope",
      code: "SAFETY.INPUT.IMAGE",
    });
    expect(parseErrorBody("<html>502</html>")).toEqual({ message: "<html>502</html>" });
  });
});
