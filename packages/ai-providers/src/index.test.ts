/**
 * AI Providers package smoke tests
 * Verifies the exported provider interface
 */

import { describe, it, expect } from "vitest";
import type { AIProvider } from "./index.js";

describe("@vibeframe/ai-providers", () => {
  describe("provider interface", () => {
    it("should have correct AIProvider interface structure", () => {
      const mockProvider: AIProvider = {
        id: "mock",
        name: "Mock Provider",
        description: "A mock provider for testing",
        capabilities: ["speech-to-text", "text-to-image"],
        isAvailable: true,
        isConfigured: () => false,
        initialize: async () => {},
      };

      expect(mockProvider.id).toBe("mock");
      expect(mockProvider.name).toBe("Mock Provider");
      expect(mockProvider.description).toBe("A mock provider for testing");
      expect(mockProvider.capabilities).toContain("speech-to-text");
      expect(mockProvider.isAvailable).toBe(true);
      expect(mockProvider.isConfigured()).toBe(false);
    });
  });
});
