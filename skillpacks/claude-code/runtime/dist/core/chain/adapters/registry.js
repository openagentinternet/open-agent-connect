"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChainAdapterRegistry = createChainAdapterRegistry;
exports.getSupportedChains = getSupportedChains;
/**
 * Create a ChainAdapterRegistry from an array of adapter instances.
 * Each adapter's `network` property is used as the registry key.
 */
function createChainAdapterRegistry(adapters) {
    const registry = new Map();
    for (const adapter of adapters) {
        registry.set(adapter.network, adapter);
    }
    return registry;
}
/**
 * Get the list of supported chain network names from the registry.
 * Useful for CLI validation without hardcoding chain names.
 */
function getSupportedChains(registry) {
    return Array.from(registry.keys());
}
