"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySurfRunStats = exports.SURF_SEEN_MAX_ROWS_PER_BOT = exports.SURF_SEEN_RETENTION_DAYS = exports.SEEN_ACTION_RANK = void 0;
exports.createMetawebSurfStore = createMetawebSurfStore;
exports.isoNow = isoNow;
// MetaWeb surf ("AI 冲浪") persistence, ported from IDBots
// src/main/metawebSurfStore.ts onto the file layout (storage layout v2
// amendment 2026-09-15): `.runtime/surf/` holds `runs.json`,
// `protocol-state.json`, `seen-pins.json`. Writes go through atomic
// write-then-rename plus a per-store serialized write queue (same pattern as
// the schedule store), so in-process traffic (daemon surf runner + daemon
// HTTP handlers sharing one store instance per profile) can never interleave
// read-modify-write cycles.
//
// Three datasets behind the autonomous surf loop:
//
// - `runs.json`: one record per surf run, including the structured surf
//   report shown in the UI (like dream records) and fed into the same
//   night's dream prompt. This file is run history only; learned content
//   lives in the bot's knowledge bases / knowledge store, never duplicated.
// - `protocol-state.json`: per-protocol watermark (last-seen chain
//   timestamp + pin id + opaque backlog cursor) so each surf fetches only
//   content published after the previous surf.
// - `seen-pins.json`: per-bot seen-pin ledger with the strongest action
//   taken so far — briefing de-dup and the "never interact with the same
//   pin twice" rule both read from here.
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
/** Exported for the surf interaction guard (duplicate-interaction checks rank actions). */
exports.SEEN_ACTION_RANK = {
    presented: 0,
    skipped: 1,
    read: 2,
    saved: 3,
    liked: 4,
    commented: 5,
    answered: 6,
    posted: 7,
    challenged: 8,
};
exports.SURF_SEEN_RETENTION_DAYS = 90;
exports.SURF_SEEN_MAX_ROWS_PER_BOT = 5000;
/** A run record keeps at most this many characters of rendered report. */
const MAX_REPORT_MARKDOWN_CHARS = 20_000;
const MAX_REPORT_JSON_CHARS = 40_000;
/** Run history kept per bot (matches the IDBots listRuns hard cap). */
const MAX_RUNS_PER_BOT = 200;
const emptySurfRunStats = () => ({
    fetched: 0,
    deepRead: 0,
    savedToKb: 0,
    knowledgePoints: 0,
    liked: 0,
    commented: 0,
    answered: 0,
    posted: 0,
    challenged: 0,
    inboxHandled: 0,
    discoveredProtocols: 0,
    tasksScheduled: 0,
});
exports.emptySurfRunStats = emptySurfRunStats;
const RUNS_FILE_VERSION = 1;
const PROTOCOL_STATE_FILE_VERSION = 1;
const SEEN_PINS_FILE_VERSION = 1;
const SURF_TRIGGERS = new Set(['manual-chat', 'manual-ui', 'pre-dream']);
const SURF_RUN_STATUSES = new Set(['running', 'done', 'failed']);
const SURF_SEEN_ACTIONS = new Set(Object.keys(exports.SEEN_ACTION_RANK));
let atomicWriteSequence = 0;
function normalizeStats(raw) {
    const empty = (0, exports.emptySurfRunStats)();
    if (!raw || typeof raw !== 'object')
        return empty;
    const record = raw;
    const out = (0, exports.emptySurfRunStats)();
    for (const key of Object.keys(out)) {
        const value = Number(record[key]);
        if (Number.isFinite(value) && value >= 0)
            out[key] = Math.floor(value);
    }
    return out;
}
function normalizeRun(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const startedAt = typeof record.startedAt === 'string' ? record.startedAt : '';
    if (!id || !startedAt)
        return null;
    const trigger = typeof record.trigger === 'string' && SURF_TRIGGERS.has(record.trigger)
        ? record.trigger
        : 'manual-ui';
    const status = typeof record.status === 'string' && SURF_RUN_STATUSES.has(record.status)
        ? record.status
        : 'failed';
    return {
        id,
        trigger,
        status,
        stats: normalizeStats(record.stats),
        reportMarkdown: typeof record.reportMarkdown === 'string' && record.reportMarkdown ? record.reportMarkdown : null,
        reportJson: typeof record.reportJson === 'string' && record.reportJson ? record.reportJson : null,
        error: typeof record.error === 'string' && record.error ? record.error : null,
        startedAt,
        finishedAt: typeof record.finishedAt === 'string' && record.finishedAt ? record.finishedAt : null,
        createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : startedAt,
        updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : startedAt,
    };
}
function normalizeProtocolState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const protocolKey = typeof record.protocolKey === 'string' ? record.protocolKey.trim() : '';
    if (!protocolKey)
        return null;
    const lastSeenTs = Number(record.lastSeenTs);
    return {
        protocolKey,
        lastSeenTs: Number.isFinite(lastSeenTs) ? Math.floor(lastSeenTs) : null,
        lastPinId: typeof record.lastPinId === 'string' && record.lastPinId ? record.lastPinId : null,
        backlogCursor: typeof record.backlogCursor === 'string' && record.backlogCursor ? record.backlogCursor : null,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    };
}
function normalizeSeenPin(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const pinId = typeof record.pinId === 'string' ? record.pinId.trim() : '';
    const firstSeenAt = typeof record.firstSeenAt === 'string' ? record.firstSeenAt : '';
    const action = typeof record.action === 'string' && SURF_SEEN_ACTIONS.has(record.action)
        ? record.action
        : null;
    if (!pinId || !firstSeenAt || !action)
        return null;
    return { pinId, firstSeenAt, action };
}
function isoNow(nowMs) {
    return new Date(nowMs).toISOString();
}
function parseIsoMs(value) {
    if (!value)
        return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
}
/** Create the per-bot surf store bound to `paths.surf*` (`.runtime/surf/`). */
function createMetawebSurfStore(paths) {
    const runsPath = paths.surfRunsPath;
    const protocolStatePath = paths.surfProtocolStatePath;
    const seenPinsPath = paths.surfSeenPinsPath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function writeJsonAtomic(filePath, file) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    async function readJsonFile(filePath, normalize, empty) {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const value = JSON.parse(raw);
            if (!value || typeof value !== 'object' || Array.isArray(value))
                return empty();
            return normalize(value) ?? empty();
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return empty();
            // Corrupt files behave like an empty store; writes recreate the file.
            if (error instanceof SyntaxError)
                return empty();
            throw error;
        }
    }
    const readRuns = () => readJsonFile(runsPath, (value) => {
        const record = value;
        const runs = Array.isArray(record.runs)
            ? record.runs.map(normalizeRun).filter((run) => run !== null)
            : [];
        return { version: RUNS_FILE_VERSION, runs };
    }, () => ({ version: RUNS_FILE_VERSION, runs: [] }));
    const readProtocolStates = () => readJsonFile(protocolStatePath, (value) => {
        const record = value;
        const states = Array.isArray(record.states)
            ? record.states.map(normalizeProtocolState).filter((state) => state !== null)
            : [];
        return { version: PROTOCOL_STATE_FILE_VERSION, states };
    }, () => ({ version: PROTOCOL_STATE_FILE_VERSION, states: [] }));
    const readSeenPins = () => readJsonFile(seenPinsPath, (value) => {
        const record = value;
        const pins = Array.isArray(record.pins)
            ? record.pins.map(normalizeSeenPin).filter((pin) => pin !== null)
            : [];
        return { version: SEEN_PINS_FILE_VERSION, pins };
    }, () => ({ version: SEEN_PINS_FILE_VERSION, pins: [] }));
    /** Newest first (createdAt DESC, stable on equal stamps via id). */
    const sortRunsNewestFirst = (runs) => [...runs].sort((left, right) => {
        const byCreated = parseIsoMs(right.createdAt) - parseIsoMs(left.createdAt);
        return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
    });
    const pruneRuns = (runs) => sortRunsNewestFirst(runs).slice(0, MAX_RUNS_PER_BOT);
    return {
        async createRun(input) {
            const created = {
                id: input.id,
                trigger: input.trigger,
                status: 'running',
                stats: (0, exports.emptySurfRunStats)(),
                reportMarkdown: null,
                reportJson: null,
                error: null,
                startedAt: input.nowIso,
                finishedAt: null,
                createdAt: input.nowIso,
                updatedAt: input.nowIso,
            };
            await enqueue(async () => {
                const file = await readRuns();
                file.runs.push(created);
                file.runs = pruneRuns(file.runs);
                await writeJsonAtomic(runsPath, file);
            });
            return created;
        },
        async finishRun(id, outcome) {
            return enqueue(async () => {
                const file = await readRuns();
                const run = file.runs.find((entry) => entry.id === id);
                if (!run)
                    return false;
                run.status = outcome.status;
                run.stats = normalizeStats(outcome.stats);
                run.reportMarkdown = outcome.reportMarkdown
                    ? outcome.reportMarkdown.slice(0, MAX_REPORT_MARKDOWN_CHARS)
                    : null;
                run.reportJson = outcome.reportJson
                    ? outcome.reportJson.slice(0, MAX_REPORT_JSON_CHARS)
                    : null;
                run.error = outcome.error ?? null;
                run.finishedAt = outcome.finishedAtIso;
                run.updatedAt = outcome.finishedAtIso;
                await writeJsonAtomic(runsPath, file);
                return true;
            });
        },
        async getRun(id) {
            const file = await readRuns();
            return file.runs.find((entry) => entry.id === id) ?? null;
        },
        async listRuns(limit = 50) {
            const capped = Math.max(1, Math.min(200, Math.floor(limit) || 50));
            const file = await readRuns();
            return sortRunsNewestFirst(file.runs).slice(0, capped);
        },
        async getLatestFinishedRun() {
            const file = await readRuns();
            let latest = null;
            for (const run of file.runs) {
                if (run.status !== 'done' || !run.finishedAt)
                    continue;
                if (!latest || parseIsoMs(run.finishedAt) > parseIsoMs(latest.finishedAt))
                    latest = run;
            }
            return latest;
        },
        async hasRunningRun() {
            const file = await readRuns();
            return file.runs.some((run) => run.status === 'running');
        },
        async failStaleRunningRuns(input) {
            return enqueue(async () => {
                const file = await readRuns();
                let changed = 0;
                for (const run of file.runs) {
                    if (run.status !== 'running')
                        continue;
                    if (input.excludeId && run.id === input.excludeId)
                        continue;
                    run.status = 'failed';
                    run.error = input.error;
                    run.finishedAt = input.nowIso;
                    run.updatedAt = input.nowIso;
                    changed += 1;
                }
                if (changed > 0)
                    await writeJsonAtomic(runsPath, file);
                return changed;
            });
        },
        async getProtocolState(protocolKey) {
            const file = await readProtocolStates();
            return file.states.find((state) => state.protocolKey === protocolKey) ?? null;
        },
        async listProtocolStates() {
            const file = await readProtocolStates();
            return [...file.states].sort((left, right) => left.protocolKey.localeCompare(right.protocolKey));
        },
        async advanceProtocolState(protocolKey, input) {
            await enqueue(async () => {
                const file = await readProtocolStates();
                const existing = file.states.find((state) => state.protocolKey === protocolKey);
                const nextTs = typeof input.lastSeenTs === 'number'
                    ? (existing?.lastSeenTs != null
                        ? Math.max(existing.lastSeenTs, Math.floor(input.lastSeenTs))
                        : Math.floor(input.lastSeenTs))
                    : (existing?.lastSeenTs ?? null);
                const nextPinId = input.lastPinId !== undefined ? input.lastPinId : (existing?.lastPinId ?? null);
                const nextCursor = input.backlogCursor !== undefined
                    ? input.backlogCursor
                    : (existing?.backlogCursor ?? null);
                const next = {
                    protocolKey,
                    lastSeenTs: nextTs,
                    lastPinId: nextPinId,
                    backlogCursor: nextCursor,
                    updatedAt: input.nowIso,
                };
                if (existing) {
                    file.states[file.states.indexOf(existing)] = next;
                }
                else {
                    file.states.push(next);
                }
                await writeJsonAtomic(protocolStatePath, file);
            });
        },
        async getSeenAction(pinId) {
            const normalized = pinId.trim();
            if (!normalized)
                return null;
            const file = await readSeenPins();
            return file.pins.find((row) => row.pinId === normalized)?.action ?? null;
        },
        async markSeen(pinId, action, nowIso) {
            await this.markSeenBatch([{ pinId, action }], nowIso);
        },
        async markSeenBatch(entries, nowIso) {
            const strongest = new Map();
            for (const entry of entries) {
                const pinId = String(entry.pinId || '').trim();
                if (!pinId)
                    continue;
                const current = strongest.get(pinId);
                if (!current || exports.SEEN_ACTION_RANK[entry.action] > exports.SEEN_ACTION_RANK[current]) {
                    strongest.set(pinId, entry.action);
                }
            }
            if (strongest.size === 0)
                return;
            await enqueue(async () => {
                const file = await readSeenPins();
                const byPinId = new Map(file.pins.map((row) => [row.pinId, row]));
                let dirty = false;
                for (const [pinId, action] of strongest) {
                    const stored = byPinId.get(pinId);
                    if (!stored) {
                        const row = { pinId, firstSeenAt: nowIso, action };
                        file.pins.push(row);
                        byPinId.set(pinId, row);
                        dirty = true;
                    }
                    else if (exports.SEEN_ACTION_RANK[action] > exports.SEEN_ACTION_RANK[stored.action]) {
                        stored.action = action;
                        dirty = true;
                    }
                }
                if (dirty)
                    await writeJsonAtomic(seenPinsPath, file);
            });
        },
        async filterUnseen(pinIds) {
            const candidates = pinIds.map((id) => String(id || '').trim()).filter(Boolean);
            if (candidates.length === 0)
                return [];
            const file = await readSeenPins();
            const seen = new Set(file.pins.map((row) => row.pinId));
            return candidates.filter((id) => !seen.has(id));
        },
        async pruneSeenPins(nowIso) {
            await enqueue(async () => {
                const file = await readSeenPins();
                const cutoffMs = Date.parse(nowIso) - exports.SURF_SEEN_RETENTION_DAYS * 24 * 60 * 60 * 1000;
                let pins = file.pins;
                if (Number.isFinite(cutoffMs)) {
                    const cutoffIso = new Date(cutoffMs).toISOString();
                    pins = pins.filter((row) => row.firstSeenAt >= cutoffIso);
                }
                if (pins.length > exports.SURF_SEEN_MAX_ROWS_PER_BOT) {
                    pins = [...pins]
                        .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt))
                        .slice(pins.length - exports.SURF_SEEN_MAX_ROWS_PER_BOT);
                }
                if (pins.length !== file.pins.length) {
                    file.pins = pins;
                    await writeJsonAtomic(seenPinsPath, file);
                }
            });
        },
    };
}
