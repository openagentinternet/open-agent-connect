"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChainAdapterRegistry = createChainAdapterRegistry;
exports.createDefaultChainAdapterRegistry = createDefaultChainAdapterRegistry;
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
 * Creates the default adapter registry with all supported chains pre-registered.
 */
function createDefaultChainAdapterRegistry() {
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
function getSupportedChains(registry) {
    return Array.from(registry.keys());
}
