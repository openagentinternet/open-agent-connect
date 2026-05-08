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
 * Creates the default adapter registry with all supported chains pre-registered.
 */
export function createDefaultChainAdapterRegistry(): ChainAdapterRegistry {
  // Use require() for all adapters to avoid forcing runtime deps through static imports.
  // Each adapter module depends on heavy packages (bitcoinjs-lib, ecpair, etc.)
  // that should only load when the registry is actually constructed at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mvcChainAdapter } = require('./mvc');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { btcChainAdapter } = require('./btc');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dogeChainAdapter } = require('./doge');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { opcatChainAdapter } = require('./opcat');
  return createChainAdapterRegistry([
    mvcChainAdapter,
    btcChainAdapter,
    dogeChainAdapter,
    opcatChainAdapter,
  ]);
}

/**
 * Get the list of supported chain network names from the registry.
 * Useful for CLI validation without hardcoding chain names.
 */
export function getSupportedChains(registry: ChainAdapterRegistry): ChainWriteNetwork[] {
  return Array.from(registry.keys());
}
