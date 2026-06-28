"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withWalletSpendQueue = withWalletSpendQueue;
exports.resolveWalletSpendQueueKey = resolveWalletSpendQueueKey;
exports.__clearWalletSpendQueuesForTests = __clearWalletSpendQueuesForTests;
const walletSpendQueues = new Map();
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
async function withWalletSpendQueue(key, run) {
    const previous = walletSpendQueues.get(key) ?? Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => {
        releaseCurrent = resolve;
    });
    const currentChain = previous.catch(() => undefined).then(() => current);
    walletSpendQueues.set(key, currentChain);
    await previous.catch(() => undefined);
    try {
        return await run();
    }
    finally {
        releaseCurrent();
        if (walletSpendQueues.get(key) === currentChain) {
            walletSpendQueues.delete(key);
        }
    }
}
async function resolveWalletSpendQueueKey(input) {
    let address = normalizeText(input.fallbackAddress);
    try {
        address = normalizeText(await input.adapter.deriveAddress(input.mnemonic, input.path)) || address;
    }
    catch {
        // Fall back to the derivation path so failed address derivation does not remove spend serialization.
    }
    return [
        input.adapter.network,
        address || normalizeText(input.path) || 'default',
    ].join(':');
}
function __clearWalletSpendQueuesForTests() {
    walletSpendQueues.clear();
}
