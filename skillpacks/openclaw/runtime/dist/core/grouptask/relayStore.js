"use strict";
/**
 * Source-session relay store: milestone rows the DSH host drains and injects
 * back into the chat that originated the task ("哪里发起哪里结束"). Rows carry
 * the origin DSH session id; rows without one are never emitted. Layout:
 * `.runtime/grouptask/relay.json` under the CHAIR profile's runtime root.
 * The daemon is the only writer; the CLI `grouptask relay drain` verb returns
 * pending rows and marks them drained in one step.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGroupTaskRelayPath = resolveGroupTaskRelayPath;
exports.createGroupTaskRelayStore = createGroupTaskRelayStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/** Drained rows older than this are pruned on the next drain. */
const RELAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Upper bound on retained rows; the oldest drained rows go first. */
const RELAY_MAX_ROWS = 200;
function emptyState() {
    return { seq: 0, rows: [] };
}
/**
 * Bounded retention for the relay file: drop drained rows past the 30-day
 * window, then cap the total, always evicting the oldest drained rows first
 * and never a pending one.
 */
function pruneRelayRows(rows, nowMs) {
    const cutoff = nowMs - RELAY_RETENTION_MS;
    const kept = rows.filter((row) => row.drainedAt == null || row.drainedAt >= cutoff);
    if (kept.length <= RELAY_MAX_ROWS)
        return kept;
    const pending = kept.filter((row) => row.drainedAt == null);
    const drained = kept
        .filter((row) => row.drainedAt != null)
        .sort((left, right) => (left.drainedAt - right.drainedAt) || (left.id - right.id));
    const room = Math.max(0, RELAY_MAX_ROWS - pending.length);
    return [...pending, ...drained.slice(drained.length - room)].sort((left, right) => left.id - right.id);
}
function resolveGroupTaskRelayPath(paths) {
    return node_path_1.default.join(paths.runtimeRoot, 'grouptask', 'relay.json');
}
function createGroupTaskRelayStore(paths) {
    const statePath = resolveGroupTaskRelayPath(paths);
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function readState() {
        try {
            const raw = await node_fs_1.promises.readFile(statePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                seq: Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0,
                rows: Array.isArray(parsed.rows) ? parsed.rows : [],
            };
        }
        catch {
            return emptyState();
        }
    }
    async function writeState(state) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(statePath), { recursive: true });
        const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now()}`;
        await node_fs_1.promises.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await node_fs_1.promises.rename(tmpPath, statePath);
    }
    return {
        root: node_path_1.default.dirname(statePath),
        add: (input) => enqueue(async () => {
            const state = await readState();
            state.seq += 1;
            const row = {
                id: state.seq,
                taskId: input.taskId,
                groupId: input.groupId ?? null,
                sessionId: input.sessionId.trim(),
                kind: input.kind,
                title: input.title.trim().slice(0, 200),
                text: input.text.trim().slice(0, 2000),
                createdAt: Date.now(),
                drainedAt: null,
            };
            state.rows.push(row);
            await writeState(state);
            return row;
        }),
        listPending: async () => {
            const state = await readState();
            return state.rows.filter((row) => row.drainedAt == null);
        },
        drain: () => enqueue(async () => {
            const state = await readState();
            const pending = state.rows.filter((row) => row.drainedAt == null);
            const now = Date.now();
            for (const row of pending)
                row.drainedAt = now;
            const pruned = pruneRelayRows(state.rows, now);
            if (pending.length === 0 && pruned.length === state.rows.length)
                return [];
            state.rows = pruned;
            await writeState(state);
            return pending;
        }),
    };
}
