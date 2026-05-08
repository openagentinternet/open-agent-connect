import type { ChainWriteNetwork } from '../writePin';
import type { ChainAdapter, ChainAdapterRegistry } from './types';
/**
 * Create a ChainAdapterRegistry from an array of adapter instances.
 * Each adapter's `network` property is used as the registry key.
 */
export declare function createChainAdapterRegistry(adapters: ChainAdapter[]): ChainAdapterRegistry;
/**
 * Creates the default adapter registry with all supported chains pre-registered.
 */
export declare function createDefaultChainAdapterRegistry(): ChainAdapterRegistry;
/**
 * Get the list of supported chain network names from the registry.
 * Useful for CLI validation without hardcoding chain names.
 */
export declare function getSupportedChains(registry: ChainAdapterRegistry): ChainWriteNetwork[];
