import type { ChainWriteNetwork } from '../writePin';
import type { ChainAdapter, ChainAdapterRegistry } from './types';

/**
 * Create a ChainAdapterRegistry from an array of adapter instances.
 * Each adapter's `network` property is used as the registry key.
 */
export function createChainAdapterRegistry(adapters: ChainAdapter[]): ChainAdapterRegistry {
  const registry: ChainAdapterRegistry = new Map();
  for (const adapter of adapters) {
    registry.set(adapter.network, adapter);
  }
  return registry;
}

/**
 * Get the list of supported chain network names from the registry.
 * Useful for CLI validation without hardcoding chain names.
 */
export function getSupportedChains(registry: ChainAdapterRegistry): ChainWriteNetwork[] {
  return Array.from(registry.keys());
}
