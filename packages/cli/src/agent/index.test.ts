import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentExecutor } from "./index.js";

const mocks = vi.hoisted(() => ({
  createAdapter: vi.fn(),
  initialize: vi.fn(),
  setModel: vi.fn(),
}));

vi.mock("./adapters/index.js", () => ({
  createAdapter: mocks.createAdapter,
}));

vi.mock("./tools/index.js", () => {
  class ToolRegistry {
    size = 0;
    getDefinitions() {
      return [];
    }
  }

  return {
    ToolRegistry,
    registerAllTools: vi.fn(),
  };
});

describe("AgentExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdapter.mockResolvedValue({
      provider: "evolink",
      initialize: mocks.initialize,
      isInitialized: () => true,
      setModel: mocks.setModel,
      chat: vi.fn(),
    });
  });

  it("passes configured model overrides into the adapter before initialization", async () => {
    const agent = new AgentExecutor({
      provider: "evolink",
      apiKey: "test-key",
      model: "claude-sonnet-4-6",
    });

    await agent.initialize();

    expect(mocks.createAdapter).toHaveBeenCalledWith("evolink");
    expect(mocks.setModel).toHaveBeenCalledWith("claude-sonnet-4-6");
    expect(mocks.initialize).toHaveBeenCalledWith("test-key");
    expect(mocks.setModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.initialize.mock.invocationCallOrder[0],
    );
  });
});
