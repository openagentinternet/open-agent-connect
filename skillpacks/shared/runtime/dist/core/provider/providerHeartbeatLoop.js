"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS = void 0;
exports.createProviderHeartbeatLoop = createProviderHeartbeatLoop;
const chainHeartbeatDirectory_1 = require("../discovery/chainHeartbeatDirectory");
exports.DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS = 60_000;
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function buildHeartbeatPayload(input) {
    return {
        providerGlobalMetaId: normalizeText(input.identity.globalMetaId),
        providerAddress: normalizeText(input.identity.mvcAddress),
        heartbeatAt: Math.floor(input.nowMs / 1000),
    };
}
function createProviderHeartbeatLoop(input) {
    const intervalMs = Number.isFinite(input.intervalMs)
        ? Math.max(1, Math.floor(input.intervalMs))
        : exports.DEFAULT_PROVIDER_HEARTBEAT_INTERVAL_MS;
    const now = input.now ?? (() => Date.now());
    let intervalId = null;
    let runningPromise = null;
    async function runOnce() {
        if (runningPromise) {
            return runningPromise;
        }
        runningPromise = (async () => {
            const presenceState = await input.presenceStore.read();
            if (!presenceState.enabled) {
                return false;
            }
            const identity = await input.getIdentity();
            if (!identity || !normalizeText(identity.globalMetaId) || !normalizeText(identity.mvcAddress)) {
                return false;
            }
            const nowMs = now();
            const payload = buildHeartbeatPayload({
                identity,
                nowMs,
            });
            const result = await input.signer.writePin({
                operation: 'create',
                path: chainHeartbeatDirectory_1.CHAIN_HEARTBEAT_PROTOCOL_PATH,
                payload: JSON.stringify(payload),
                contentType: 'application/json',
                network: 'mvc',
            });
            await input.presenceStore.update((current) => ({
                ...current,
                lastHeartbeatAt: nowMs,
                lastHeartbeatPinId: normalizeText(result.pinId) || null,
                lastHeartbeatTxid: normalizeText(result.txids?.[0]) || null,
            }));
            return true;
        })().finally(() => {
            runningPromise = null;
        });
        return runningPromise;
    }
    return {
        async start() {
            if (intervalId != null) {
                return;
            }
            await runOnce();
            intervalId = setInterval(() => {
                void runOnce().catch(() => {
                    // Keep the loop alive; provider surfaces can inspect the last successful heartbeat metadata.
                });
            }, intervalMs);
            intervalId.unref?.();
        },
        stop() {
            if (intervalId != null) {
                clearInterval(intervalId);
                intervalId = null;
            }
        },
        runOnce,
        isRunning() {
            return intervalId != null;
        },
    };
}
