"use strict";
/**
 * Op-keyed stage hub for MetaApp publish/update progress. Daemon handlers
 * publish stage events under a caller-chosen op id; SSE subscribers replay
 * the buffered sequence and then follow live events until a terminal
 * `done`/`error` stage arrives. In-memory by design: per-op buffers, a short
 * TTL, and an op cap keep it bounded.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetaAppStageHub = createMetaAppStageHub;
const DEFAULT_BUFFER_SIZE = 20;
const DEFAULT_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_OPS = 200;
const TERMINAL_STAGES = new Set(['done', 'error']);
function createMetaAppStageHub(input) {
    const now = input?.now ?? Date.now;
    const bufferSize = Math.max(1, input?.bufferSize ?? DEFAULT_BUFFER_SIZE);
    const ttlMs = Math.max(1, input?.ttlMs ?? DEFAULT_TTL_MS);
    const maxOps = Math.max(1, input?.maxOps ?? DEFAULT_MAX_OPS);
    // Insertion order doubles as least-recently-used order (see touch()).
    const ops = new Map();
    // Listeners registered before their op's first event; they move onto the
    // op state at the first publish so subscriptions alone never create ops or
    // evict anything.
    const pending = new Map();
    const prune = () => {
        const at = now();
        for (const [op, state] of ops) {
            if (at - state.touchedAt >= ttlMs)
                ops.delete(op);
        }
        while (ops.size > maxOps) {
            const oldest = ops.keys().next();
            if (oldest.done)
                break;
            ops.delete(oldest.value);
        }
    };
    const touch = (op) => {
        const existing = ops.get(op);
        if (existing) {
            existing.touchedAt = now();
            ops.delete(op);
            ops.set(op, existing);
            return existing;
        }
        const created = { events: [], listeners: new Set(), touchedAt: now(), terminal: false };
        ops.set(op, created);
        return created;
    };
    return {
        publish(op, event) {
            const key = op.trim();
            if (!key)
                return;
            const state = touch(key);
            // A terminal op is sealed: op ids are single-run by contract, so late
            // duplicate publishes must not reopen the stream.
            if (state.terminal)
                return;
            const { stage, ...detail } = event;
            const record = { op: key, stage, at: now(), ...detail };
            state.events.push(record);
            if (state.events.length > bufferSize) {
                state.events.splice(0, state.events.length - bufferSize);
            }
            const waiting = pending.get(key);
            if (waiting) {
                pending.delete(key);
                for (const listener of waiting) {
                    state.listeners.add(listener);
                }
            }
            for (const listener of state.listeners) {
                listener(record);
            }
            if (TERMINAL_STAGES.has(record.stage)) {
                // The stream is over: detach live listeners (the SSE route closes
                // itself) but keep the buffer so a late subscriber can still replay.
                state.terminal = true;
                state.listeners.clear();
            }
            prune();
        },
        subscribe(op, listener) {
            const key = op.trim();
            if (!key)
                return () => undefined;
            // The listener may live in the pending set or on the op state (pending
            // listeners move at the op's first publish), so detach from both.
            const unsubscribe = () => {
                const current = ops.get(key);
                if (current)
                    current.listeners.delete(listener);
                const waiting = pending.get(key);
                if (waiting) {
                    waiting.delete(listener);
                    if (waiting.size === 0)
                        pending.delete(key);
                }
            };
            const state = ops.get(key);
            if (!state) {
                // Nothing buffered yet: wait for the op's first publish.
                let waiting = pending.get(key);
                if (!waiting) {
                    waiting = new Set();
                    pending.set(key, waiting);
                }
                waiting.add(listener);
                return unsubscribe;
            }
            for (const event of state.events) {
                listener(event);
            }
            if (state.terminal) {
                // The op already finished: the replay is the whole stream.
                return () => undefined;
            }
            state.listeners.add(listener);
            return unsubscribe;
        },
    };
}
