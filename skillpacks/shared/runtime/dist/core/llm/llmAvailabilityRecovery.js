"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLM_AVAILABILITY_RECOVERY_DISABLED_ENV = void 0;
exports.createLlmAvailabilityRecovery = createLlmAvailabilityRecovery;
const llmRuntimeStore_1 = require("./llmRuntimeStore");
const llmRuntimeDiscovery_1 = require("./llmRuntimeDiscovery");
// Kill switch (spec R4.6): tests and constrained environments set this to '1'.
exports.LLM_AVAILABILITY_RECOVERY_DISABLED_ENV = 'METABOT_LLM_AVAILABILITY_RECOVERY_DISABLED';
const DEFAULT_INTERVAL_MS = 60_000;
// Every probe is a real CLI turn that can surface in the provider's session
// history, so the background trickle stays deliberately slow: the first
// retry waits 10 minutes and the exponential schedule is capped at 2 hours.
// Interactive recovery does not wait — chat paths that find no selectable
// runtime call requestSoon, which bypasses backoff.
const DEFAULT_BASE_BACKOFF_MS = 10 * 60_000;
const DEFAULT_MAX_BACKOFF_MS = 2 * 60 * 60_000;
const DEFAULT_GLOBAL_CONCURRENCY = 2;
// One probe per store per cycle (spec R4.4): availability recovery is a
// background trickle, never a burst competing with interactive turns.
const PER_STORE_PROBE_LIMIT = 1;
// Whole-cycle budget across every target store: a machine with many Bot
// profiles must not walk all of its stale runtimes in one burst.
const DEFAULT_MAX_PROBES_PER_CYCLE = 2;
function parseIsoMs(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
// Recovery candidates (spec R4.2): detected/degraded runtimes, plus
// unavailable ones whose cooldown is missing or already expired.
function isRecoveryCandidate(runtime, nowMs) {
    if (runtime.provider === 'custom')
        return false;
    if (runtime.health === 'detected' || runtime.health === 'degraded')
        return true;
    if (runtime.health === 'unavailable') {
        const until = parseIsoMs(runtime.unavailableUntil);
        return until === null || until <= nowMs;
    }
    return false;
}
function createLlmAvailabilityRecovery(input) {
    const env = input.env ?? process.env;
    const storeForHome = input.storeForHome ?? ((homeDir) => (0, llmRuntimeStore_1.createLlmRuntimeStore)(homeDir));
    const probe = input.probe ?? llmRuntimeDiscovery_1.testLlmRuntimeReadiness;
    const now = input.now ?? (() => Date.now());
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
    const baseBackoffMs = input.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    const maxBackoffMs = input.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    const globalConcurrency = Math.max(1, Math.floor(input.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY));
    const maxProbesPerCycle = Math.max(1, Math.floor(input.maxProbesPerCycle ?? DEFAULT_MAX_PROBES_PER_CYCLE));
    const logger = input.logger ?? (() => undefined);
    // In-memory per-runtime backoff (spec R4.3): the persisted healthCheckedAt
    // stays the probe timestamp; only the failure counter lives here, so a
    // daemon restart simply re-probes on the next cycle.
    const backoffByRuntimeId = new Map();
    const pendingSoonHomes = new Set();
    const inFlightHomes = new Set();
    let timer = null;
    let cycleRunning = false;
    const isDisabled = () => env[exports.LLM_AVAILABILITY_RECOVERY_DISABLED_ENV] === '1';
    const backoffAllows = (runtimeId, nowMs) => {
        const record = backoffByRuntimeId.get(runtimeId);
        return !record || nowMs >= record.nextAttemptAt;
    };
    const recordProbeOutcome = (runtime, healthy, failedAt) => {
        if (healthy) {
            backoffByRuntimeId.delete(runtime.id);
            return;
        }
        const record = backoffByRuntimeId.get(runtime.id);
        const failures = (record?.failures ?? 0) + 1;
        const delay = Math.min(baseBackoffMs * 2 ** (failures - 1), maxBackoffMs);
        backoffByRuntimeId.set(runtime.id, { failures, nextAttemptAt: failedAt + delay });
    };
    const runCycleForHome = async (homeDir, options) => {
        if (input.isStoreBusy?.(homeDir))
            return false;
        if (inFlightHomes.has(homeDir))
            return false;
        inFlightHomes.add(homeDir);
        try {
            const store = storeForHome(homeDir);
            const state = await store.read();
            const nowMs = now();
            const candidates = state.runtimes
                .filter((runtime) => isRecoveryCandidate(runtime, nowMs)
                && (options?.ignoreBackoff || backoffAllows(runtime.id, nowMs)))
                .slice(0, PER_STORE_PROBE_LIMIT);
            for (const candidate of candidates) {
                try {
                    const probed = await probe(candidate);
                    await store.upsertRuntime(probed);
                    recordProbeOutcome(candidate, probed.health === 'healthy', now());
                }
                catch (error) {
                    logger(`[llm availability recovery] probe failed for ${candidate.id}`, error);
                    recordProbeOutcome(candidate, false, now());
                }
            }
            return candidates.length > 0;
        }
        finally {
            inFlightHomes.delete(homeDir);
        }
    };
    const runCycleOnce = async () => {
        if (isDisabled() || cycleRunning)
            return;
        cycleRunning = true;
        try {
            const homes = await input.listTargetHomes();
            let probesThisCycle = 0;
            // Small worker pool: at most `globalConcurrency` stores probed at once.
            let nextIndex = 0;
            const workers = Array.from({ length: Math.min(globalConcurrency, homes.length) }, async () => {
                while (nextIndex < homes.length) {
                    const homeDir = homes[nextIndex];
                    nextIndex += 1;
                    if (probesThisCycle >= maxProbesPerCycle)
                        continue;
                    // Claim the slot before awaiting so concurrent workers cannot
                    // collectively overshoot the budget; release it when the store
                    // turns out to have no probeable candidate.
                    probesThisCycle += 1;
                    let probed = false;
                    try {
                        probed = await runCycleForHome(homeDir);
                    }
                    catch (error) {
                        logger(`[llm availability recovery] cycle failed for ${homeDir}`, error);
                    }
                    if (!probed)
                        probesThisCycle -= 1;
                }
            });
            await Promise.all(workers);
        }
        finally {
            cycleRunning = false;
        }
    };
    return {
        start() {
            if (isDisabled() || timer)
                return;
            timer = setInterval(() => {
                void runCycleOnce().catch((error) => {
                    logger('[llm availability recovery] cycle failed', error);
                });
            }, intervalMs);
            timer.unref?.();
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
        runCycleOnce,
        requestSoon(homeDir) {
            if (isDisabled() || !homeDir)
                return;
            if (pendingSoonHomes.has(homeDir))
                return;
            pendingSoonHomes.add(homeDir);
            setImmediate(() => {
                pendingSoonHomes.delete(homeDir);
                void runCycleForHome(homeDir, { ignoreBackoff: true }).catch((error) => {
                    logger(`[llm availability recovery] requested cycle failed for ${homeDir}`, error);
                });
            });
        },
    };
}
