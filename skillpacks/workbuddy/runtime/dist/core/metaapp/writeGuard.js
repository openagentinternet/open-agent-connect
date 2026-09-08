"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS = void 0;
exports.stableMetaAppWriteHash = stableMetaAppWriteHash;
exports.createMetaAppWriteGuard = createMetaAppWriteGuard;
/**
 * Idempotency window + per-app write serialization for MetaApp chain writes.
 * Ported from the IDBots metaAppOwnerService behavior: a 60 s idempotency
 * window keyed on a stable hash of the write short-circuits double-clicks
 * and LLM retries (two same-semantics calls must not each hit the chain and
 * create duplicate root pins), and per-app mutexes serialize modify/revoke
 * writes against one root pin. In-memory by design: the window only covers
 * immediate retries inside the daemon process.
 */
const node_crypto_1 = require("node:crypto");
const commandResult_1 = require("../contracts/commandResult");
exports.METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS = 60_000;
function stableMetaAppWriteHash(kind, parts) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(JSON.stringify([kind, ...parts.map((part) => (part ?? '').trim())]), 'utf8')
        .digest('hex');
}
function createMetaAppWriteGuard(input) {
    const now = input?.now ?? Date.now;
    const windowMs = input?.windowMs ?? exports.METAAPP_WRITE_IDEMPOTENCY_WINDOW_MS;
    const recent = new Map();
    const locks = new Map();
    const prune = () => {
        const at = now();
        for (const [key, entry] of recent) {
            if (at - entry.at >= windowMs)
                recent.delete(key);
        }
    };
    const replay = (entry) => {
        const { result } = entry;
        if (!result.ok || result.state !== 'success' || !result.data || typeof result.data !== 'object') {
            return result;
        }
        return (0, commandResult_1.commandSuccess)({ ...result.data, idempotent: true });
    };
    const lookup = (idemKey) => {
        prune();
        const entry = recent.get(idemKey);
        return entry ? replay(entry) : null;
    };
    const runLocked = async (lockKey, fn) => {
        if (!lockKey)
            return fn();
        const previous = locks.get(lockKey) ?? Promise.resolve();
        let release = () => { };
        const current = new Promise((resolve) => { release = resolve; });
        const tail = previous.then(() => current);
        locks.set(lockKey, tail);
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
            if (locks.get(lockKey) === tail)
                locks.delete(lockKey);
        }
    };
    return {
        run: async ({ idemKey, lockKey, fn }) => {
            const cached = lookup(idemKey);
            if (cached)
                return cached;
            return runLocked(lockKey, async () => {
                // Re-check after waiting on the app lock: the call we queued behind
                // may have been the identical retry, already written by the holder.
                const awaited = lookup(idemKey);
                if (awaited)
                    return awaited;
                const result = await fn();
                if (result.ok && result.state === 'success') {
                    recent.set(idemKey, { at: now(), result });
                }
                return result;
            });
        },
    };
}
