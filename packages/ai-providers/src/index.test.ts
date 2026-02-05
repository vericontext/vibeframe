/**
 * AI Providers package smoke tests
 * Verifies exports and basic functionality
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  providerRegistry,
  getBestProviderForCapability,
  type AIProvider,
  type AICapability,
} from "./index.js";

describe("@vibeframe/ai-providers", () => {
  describe("exports", () => {
    it("should export providerRegistry", () => {
      expect(providerRegistry).toBeDefined();
      expect(typeof providerRegistry.register).toBe("function");
      expect(typeof providerRegistry.get).toBe("function");
      expect(typeof providerRegistry.getAll).toBe("function");
      expect(typeof providerRegistry.getByCapability).toBe("function");
    });

    it("should export getBestProviderForCapability", () => {
      expect(getBestProviderForCapability).toBeDefined();
      expect(typeof getBestProviderForCapability).toBe("function");
    });
  });

  describe("providerRegistry", () => {
    // Create a mock provider for testing
    const createMockProvider = (
      id: string,
      capabilities: AICapability[] = ["speech-to-text"]
    ): AIProvider => ({
      id,
      name: `Test Provider ${id}`,
      description: `Test provider for ${id}`,
      capabilities,
      isAvailable: true,
      isConfigured: () => true,
      initialize: async () => {},
    });

    beforeEach(() => {
      // Clean up any test providers (leave real providers)
      const testIds = providerRegistry
        .getAll()
        .filter((p) => p.id.startsWith("test-"))
        .map((p) => p.id);
      testIds.forEach((id) => providerRegistry.unregister(id));
    });

    it("should register a provider", () => {
      const provider = createMockProvider("test-provider-1");
      providerRegistry.register(provider);

      const retrieved = providerRegistry.get("test-provider-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("test-provider-1");
    });

    it("should get all providers", () => {
      const provider1 = createMockProvider("test-provider-2");
      const provider2 = createMockProvider("test-provider-3");

      providerRegistry.register(provider1);
      providerRegistry.register(provider2);

      const all = providerRegistry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(2);

      const testProviders = all.filter((p) => p.id.startsWith("test-provider-"));
      expect(testProviders.length).toBe(2);
    });

    it("should get providers by capability", () => {
      const speechProvider = createMockProvider("test-speech", [
        "speech-to-text",
      ]);
      const imageProvider = createMockProvider("test-image", ["text-to-image"]);

      providerRegistry.register(speechProvider);
      providerRegistry.register(imageProvider);

      const speechProviders =
        providerRegistry.getByCapability("speech-to-text");
      const imageProviders = providerRegistry.getByCapability("text-to-image");

      expect(
        speechProviders.some((p) => p.id === "test-speech")
      ).toBe(true);
      expect(imageProviders.some((p) => p.id === "test-image")).toBe(true);
    });

    it("should unregister a provider", () => {
      const provider = createMockProvider("test-provider-4");
      providerRegistry.register(provider);

      expect(providerRegistry.get("test-provider-4")).toBeDefined();

      const result = providerRegistry.unregister("test-provider-4");
      expect(result).toBe(true);
      expect(providerRegistry.get("test-provider-4")).toBeUndefined();
    });

    it("should return false when unregistering non-existent provider", () => {
      const result = providerRegistry.unregister("non-existent-provider");
      expect(result).toBe(false);
    });
  });

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
