import { describe, expect, it, vi } from "vitest";
import { makeElicitFn, type ElicitCapableServer } from "./elicit.js";

function fakeServer(capabilities: { elicitation?: object } | undefined): ElicitCapableServer & {
  elicitInput: ReturnType<typeof vi.fn>;
} {
  return {
    getClientCapabilities: () => capabilities,
    elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { narration: "kokoro" } }),
  };
}

describe("makeElicitFn", () => {
  it("returns undefined when the client never declared the capability", () => {
    expect(makeElicitFn(fakeServer(undefined), {})).toBeUndefined();
    expect(makeElicitFn(fakeServer({}), {})).toBeUndefined();
  });

  it("delegates to server.elicitInput with form mode and a generous timeout", async () => {
    const server = fakeServer({ elicitation: { form: {} } });
    const elicit = makeElicitFn(server, {});
    expect(elicit).toBeDefined();

    const form = {
      message: "Choose",
      requestedSchema: { type: "object" as const, properties: { narration: { type: "string" } } },
    };
    const result = await elicit!(form);
    expect(result).toEqual({ action: "accept", content: { narration: "kokoro" } });
    expect(server.elicitInput).toHaveBeenCalledWith(
      { mode: "form", message: "Choose", requestedSchema: form.requestedSchema },
      { timeout: 600_000 }
    );
  });

  it("honors the VIBE_MCP_ELICIT=off kill switch", () => {
    const server = fakeServer({ elicitation: {} });
    expect(makeElicitFn(server, { VIBE_MCP_ELICIT: "off" })).toBeUndefined();
    expect(makeElicitFn(server, { VIBE_MCP_ELICIT: "OFF" })).toBeUndefined();
    expect(makeElicitFn(server, { VIBE_MCP_ELICIT: "on" })).toBeDefined();
  });
});
