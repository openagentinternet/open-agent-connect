"use strict";
/**
 * Per-session mail queue (local session adapters P2a).
 *
 * Durable inbox for local agent sessions, persisted at
 * `<systemHome>/.metabot/sessions/session-mail.json` (0600, atomic
 * write-then-rename, serialized writes — same discipline as the session
 * registry). P2a exposes it over the daemon API and the `metabot mcp` pull
 * tier; P2b wires the real inbound flow (handleInboundMessage router) into
 * `enqueue`.
 *
 * Semantics (reason-network discipline):
 * - mail waits for its session for MAIL_TTL_MS (24h), then expires;
 * - `checkInbox` long-polls and hands over unread entries, marking them
 *   delivered; the session acks with `ackRead` once it has really seen them;
 * - `status` reports content-free per-id stages (queued/delivered/read/
 *   expired) so senders get receipts without reading bodies.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CHECK_WAIT_SECS = exports.MAIL_TTL_MS = void 0;
exports.createSessionMailQueue = createSessionMailQueue;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.MAIL_TTL_MS = 24 * 60 * 60_000;
/** Long-poll ceiling: the daemon must answer well inside client timeouts. */
exports.MAX_CHECK_WAIT_SECS = 25;
const MAX_ENTRIES = 500;
const STATE_FILE_MODE = 0o600;
function emptyState() {
    return { version: 1, updatedAt: new Date(0).toISOString(), entries: [] };
}
function entryId(nowMs) {
    const random = Math.random().toString(36).slice(2, 10);
    return `mail-${nowMs}-${random}`;
}
function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return emptyState();
    }
    const state = raw;
    if (state.version !== 1 || !Array.isArray(state.entries)) {
        return emptyState();
    }
    const entries = state.entries
        .filter((item) => {
        if (!item || typeof item !== 'object')
            return false;
        const entry = item;
        return typeof entry.id === 'string'
            && typeof entry.sessionKey === 'string'
            && typeof entry.from === 'string'
            && typeof entry.body === 'string';
    })
        .map((entry) => ({ ...entry }));
    return { version: 1, updatedAt: new Date().toISOString(), entries };
}
function receiptOf(entry) {
    return {
        id: entry.id,
        sessionKey: entry.sessionKey,
        status: entry.expiredAt
            ? 'expired'
            : entry.readAt
                ? 'read'
                : entry.deliveredAt
                    ? 'delivered'
                    : 'queued',
        createdAt: entry.createdAt,
        deliveredAt: entry.deliveredAt,
        readAt: entry.readAt,
        expiredAt: entry.expiredAt,
    };
}
function createSessionMailQueue(input) {
    const statePath = input.statePath;
    const now = input.now ?? Date.now;
    let writeChain = Promise.resolve();
    function serialized(operation) {
        const run = writeChain.then(operation, operation);
        writeChain = run.catch(() => undefined);
        return run;
    }
    async function readState() {
        let raw;
        try {
            raw = await node_fs_1.promises.readFile(statePath, 'utf8');
        }
        catch {
            return emptyState();
        }
        try {
            return normalizeState(JSON.parse(raw));
        }
        catch {
            return emptyState();
        }
    }
    async function writeState(state) {
        state.updatedAt = new Date(now()).toISOString();
        const parent = node_path_1.default.dirname(statePath);
        await node_fs_1.promises.mkdir(parent, { recursive: true });
        const tmpPath = node_path_1.default.join(parent, `.session-mail.${process.pid}.tmp`);
        await node_fs_1.promises.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: STATE_FILE_MODE });
        await node_fs_1.promises.rename(tmpPath, statePath);
    }
    /** Expire stale mail and bound the store; returns true when state changed. */
    function prune(state) {
        const timestamp = now();
        let changed = false;
        for (const entry of state.entries) {
            if (!entry.expiredAt && !entry.readAt && timestamp - entry.createdAt > exports.MAIL_TTL_MS) {
                entry.expiredAt = timestamp;
                changed = true;
            }
        }
        const kept = state.entries.filter((entry) => !(entry.expiredAt && timestamp - entry.expiredAt > exports.MAIL_TTL_MS)
            && !(entry.readAt && timestamp - entry.readAt > exports.MAIL_TTL_MS));
        if (kept.length !== state.entries.length) {
            state.entries = kept;
            changed = true;
        }
        if (state.entries.length > MAX_ENTRIES) {
            state.entries = state.entries.slice(state.entries.length - MAX_ENTRIES);
            changed = true;
        }
        return changed;
    }
    const queue = {
        async enqueue(mailInput) {
            const sessionKey = mailInput.sessionKey.trim();
            const from = mailInput.from.trim();
            const body = typeof mailInput.body === 'string' ? mailInput.body : '';
            if (!sessionKey || !from || !body.trim()) {
                throw new Error('sessionKey, from and a non-empty body are required');
            }
            return serialized(async () => {
                const state = await readState();
                prune(state);
                const entry = {
                    id: entryId(now()),
                    sessionKey,
                    from,
                    body,
                    fromName: mailInput.fromName?.trim() || undefined,
                    createdAt: now(),
                };
                state.entries.push(entry);
                await writeState(state);
                return entry;
            });
        },
        async checkInbox(checkInput) {
            const sessionKey = checkInput.sessionKey.trim();
            if (!sessionKey) {
                throw new Error('sessionKey is required');
            }
            const waitMs = Math.min(Math.max(Math.floor(checkInput.waitSecs ?? 0), 0), exports.MAX_CHECK_WAIT_SECS) * 1_000;
            const deadline = now() + waitMs;
            const pollIntervalMs = 250;
            for (;;) {
                const handed = await serialized(async () => {
                    const state = await readState();
                    prune(state);
                    const unread = state.entries.filter((entry) => entry.sessionKey === sessionKey && !entry.deliveredAt && !entry.expiredAt);
                    if (unread.length) {
                        const timestamp = now();
                        for (const entry of unread) {
                            entry.deliveredAt = timestamp;
                        }
                        await writeState(state);
                    }
                    return unread;
                });
                if (handed.length || now() >= deadline) {
                    return handed;
                }
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
        },
        async ackRead(sessionKey, ids) {
            const normalizedKey = sessionKey.trim();
            const wanted = new Set(ids.filter((id) => typeof id === 'string' && id.trim()));
            if (!normalizedKey || !wanted.size) {
                return [];
            }
            return serialized(async () => {
                const state = await readState();
                prune(state);
                const timestamp = now();
                const receipts = [];
                for (const entry of state.entries) {
                    if (entry.sessionKey === normalizedKey && wanted.has(entry.id) && !entry.readAt) {
                        entry.readAt = timestamp;
                    }
                    if (wanted.has(entry.id)) {
                        receipts.push(receiptOf(entry));
                    }
                }
                await writeState(state);
                return receipts;
            });
        },
        async markDelivered(id) {
            const normalizedId = id.trim();
            if (!normalizedId) {
                return null;
            }
            return serialized(async () => {
                const state = await readState();
                prune(state);
                const entry = state.entries.find((candidate) => candidate.id === normalizedId);
                if (!entry) {
                    return null;
                }
                if (!entry.deliveredAt && !entry.expiredAt) {
                    entry.deliveredAt = now();
                    await writeState(state);
                }
                return receiptOf(entry);
            });
        },
        async status(ids) {
            const wanted = new Set(ids.filter((id) => typeof id === 'string' && id.trim()));
            if (!wanted.size) {
                return [];
            }
            return serialized(async () => {
                const state = await readState();
                if (prune(state)) {
                    await writeState(state);
                }
                const receipts = [];
                for (const entry of state.entries) {
                    if (wanted.has(entry.id)) {
                        receipts.push(receiptOf(entry));
                    }
                }
                return receipts;
            });
        },
        async pendingCount(sessionKey) {
            const normalizedKey = sessionKey.trim();
            if (!normalizedKey) {
                return 0;
            }
            return serialized(async () => {
                const state = await readState();
                if (prune(state)) {
                    await writeState(state);
                }
                return state.entries.filter((entry) => entry.sessionKey === normalizedKey && !entry.deliveredAt && !entry.expiredAt).length;
            });
        },
    };
    return queue;
}
