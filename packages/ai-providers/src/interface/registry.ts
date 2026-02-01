import type { AIProvider, AIProviderRegistry, AICapability } from "./types.js";

/**
 * Default implementation of the AI Provider Registry
 */
class ProviderRegistryImpl implements AIProviderRegistry {
  private providers: Map<string, AIProvider> = new Map();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.id)) {
      console.warn(`Provider with id "${provider.id}" already registered. Overwriting.`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  getByCapability(capability: AICapability): AIProvider[] {
    return this.getAll().filter((provider) =>
      provider.capabilities.includes(capability)
    );
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }
}

/** Singleton instance of the provider registry */
export const providerRegistry: AIProviderRegistry = new ProviderRegistryImpl();

/** Helper to get the best provider for a capability */
export function getBestProviderForCapability(
  capability: AICapability
): AIProvider | undefined {
  const providers = providerRegistry.getByCapability(capability);
  // Return first available and configured provider
  return providers.find((p) => p.isAvailable && p.isConfigured());
}
