"use strict";
/**
 * MetaTask projection store (M3 — JSON redesign of the IDBots SQLite store).
 *
 * Everything here is a REBUILDABLE cache of the chain replay — the chain is
 * the only source of truth. Deleting this directory costs exactly one full
 * re-collect; nothing here is authoritative.
 *
 * Layout (system-level, shared across profiles — chain truth is global):
 *   ~/.metabot/runtime/metatask/version.json         { "version": 3 }
 *   ~/.metabot/runtime/metatask/events/<segment>.jsonl  raw chain events, one
 *     JSON per line, append-only; load-time dedupe by pinId (last row wins)
 *   ~/.metabot/runtime/metatask/projections/<rootPinId>.json  one file per
 *     task root: { dirtyKey, savedAtMs, projection } (atomic rename per write)
 *   ~/.metabot/runtime/metatask/refresh-state.json   last/ok/error/boundary/
 *     refreshing/seq
 *   ~/.metabot/runtime/metatask/watch-state.json     per (root,node) statuses
 *   ~/.metabot/runtime/metatask/alerts.json          display-only alerts
 *   ~/.metabot/runtime/metatask/identities.json      metaId → display identity
 *
 * Semantics ported from the IDBots SQLite store one-for-one:
 *  - no-degrade upsert: an event whose body failed to parse ({}) never
 *    overwrites a cached good body, while every other field still refreshes;
 *  - projection writes are batched in memory first — a mid-batch failure
 *    leaves no partial files on disk;
 *  - the projection format version salts the dirty key (see engine), so a
 *    format upgrade invalidates every cached projection exactly once.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetaTaskStore = createMetaTaskStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("./engine/constants");
const engine_1 = require("./engine/engine");
const estimate_1 = require("./engine/estimate");
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeJsonFileAtomic(filePath, value) {
    await writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
async function writeTextFileAtomic(filePath, text) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await node_fs_1.promises.writeFile(tmpPath, text, 'utf8');
    await node_fs_1.promises.rename(tmpPath, filePath);
}
const safeFileSegment = (segment) => segment.replace(/[^a-z0-9-]/gi, '_');
const eventsEqual = (a, b) => a.pinId === b.pinId
    && a.path === b.path
    && a.author === b.author
    && a.height === b.height
    && a.txIndex === b.txIndex
    && a.timestampMs === b.timestampMs
    && JSON.stringify(a.body) === JSON.stringify(b.body);
const GOOD_BODY = (body) => Object.keys(body).length > 0;
function createMetaTaskStore(root, options = {}) {
    const eventsDir = node_path_1.default.join(root, 'events');
    const projectionsDir = node_path_1.default.join(root, 'projections');
    /** events by pinId — the effective (last-wins) view of the jsonl files. */
    const eventsByPin = new Map();
    // Lazy init (mkdir + version stamp + event-file load): every method awaits
    // it, so the factory stays synchronous for the daemon handler assembly.
    const ready = (async () => {
        await node_fs_1.promises.mkdir(eventsDir, { recursive: true });
        await node_fs_1.promises.mkdir(projectionsDir, { recursive: true });
        await writeJsonFileAtomic(node_path_1.default.join(root, 'version.json'), { version: engine_1.PROJECTION_FORMAT_VERSION });
        await loadAllEvents();
    })();
    const segmentFile = (segment) => node_path_1.default.join(eventsDir, `${safeFileSegment(segment)}.jsonl`);
    async function loadEventSegment(file) {
        let raw;
        try {
            raw = await node_fs_1.promises.readFile(file, 'utf8');
        }
        catch {
            return;
        }
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object' && typeof parsed.pinId === 'string') {
                    eventsByPin.set(parsed.pinId, parsed);
                }
            }
            catch {
                // a torn trailing line (crash mid-append) is dropped; the next sweep re-appends
            }
        }
    }
    async function loadAllEvents() {
        let names = [];
        try {
            names = await node_fs_1.promises.readdir(eventsDir);
        }
        catch {
            return;
        }
        for (const name of names) {
            if (name.endsWith('.jsonl'))
                await loadEventSegment(node_path_1.default.join(eventsDir, name));
        }
    }
    const readRefreshState = async () => (await readJsonFile(node_path_1.default.join(root, 'refresh-state.json'))) ?? {
        lastRefreshAtMs: null,
        lastOkAtMs: null,
        lastError: null,
        boundaryBlock: -1,
        refreshing: false,
        seq: 0,
    };
    const projectionFile = (rootPinId) => node_path_1.default.join(projectionsDir, `${rootPinId.replace(/[^a-z0-9._-]/gi, '_')}.json`);
    const listProjectionRoots = async () => {
        let names = [];
        try {
            names = await node_fs_1.promises.readdir(projectionsDir);
        }
        catch {
            return [];
        }
        return names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
    };
    /** Every metaId a projection displays (publisher, participants, node actors, voters). */
    const actorsOf = (projection) => {
        const actors = new Set([projection.publisher]);
        for (const participant of projection.participants ?? [])
            actors.add(participant.metaId);
        for (const node of Object.values(projection.nodeStates ?? {})) {
            if (node.holder)
                actors.add(node.holder.claimant);
            if (node.submission)
                actors.add(node.submission.submitter);
            for (const vote of node.votes ?? [])
                actors.add(vote.voter);
        }
        if (projection.settlement) {
            for (const share of projection.settlement.shares)
                actors.add(share.metaId);
        }
        actors.delete('');
        return actors;
    };
    const readIdentities = async () => (await readJsonFile(node_path_1.default.join(root, 'identities.json'))) ?? { identities: {} };
    const store = {
        root,
        async upsertEvents(events) {
            await ready;
            if (events.length === 0)
                return 0;
            // Merge the whole batch in memory first: an anti-downgrade row keeps the
            // cached body, everything else refreshes; identical rows cost no write.
            const appended = new Map();
            for (const event of events) {
                const cached = eventsByPin.get(event.pinId);
                if (!cached) {
                    eventsByPin.set(event.pinId, event);
                    appended.set(event.pinId, event);
                    continue;
                }
                const effective = {
                    ...event,
                    body: GOOD_BODY(event.body) || !GOOD_BODY(cached.body) ? event.body : cached.body,
                };
                if (eventsEqual(cached, effective))
                    continue;
                eventsByPin.set(event.pinId, effective);
                appended.set(event.pinId, effective);
            }
            if (appended.size === 0)
                return 0;
            // One append per segment per batch — the JSON-store analog of the
            // single-transaction batch write.
            const bySegment = new Map();
            for (const event of appended.values()) {
                const list = bySegment.get(event.path) ?? [];
                list.push(event);
                bySegment.set(event.path, list);
            }
            for (const [segment, list] of bySegment) {
                const lines = list.map((event) => JSON.stringify(event)).join('\n');
                await node_fs_1.promises.appendFile(segmentFile(segment), `${lines}\n`, 'utf8');
            }
            return appended.size;
        },
        async loadEvents() {
            await ready;
            return Array.from(eventsByPin.values());
        },
        async saveProjections(projections, saveOptions = {}) {
            // Serialize the whole batch before touching the disk: a mid-batch
            // failure (e.g. an unserializable projection) leaves no partial writes.
            const keep = new Set(saveOptions.liveRootIds ?? projections.map((projection) => projection.rootPinId));
            const dirtyKeys = saveOptions.dirtyKeys ?? {};
            const files = [];
            const now = Date.now();
            for (const projection of projections) {
                files.push({
                    filePath: projectionFile(projection.rootPinId),
                    text: `${JSON.stringify({
                        dirtyKey: dirtyKeys[projection.rootPinId] ?? '',
                        savedAtMs: now,
                        projection,
                    }, null, 2)}\n`,
                });
            }
            for (const file of files) {
                await writeTextFileAtomic(file.filePath, file.text);
            }
            // Stale roots (task pins no longer returned by the sweep) drop out.
            const existing = await listProjectionRoots();
            const keepFiles = new Set(Array.from(keep).map((rootPinId) => node_path_1.default.basename(projectionFile(rootPinId), '.json')));
            for (const name of existing) {
                if (!keepFiles.has(name)) {
                    await node_fs_1.promises.rm(node_path_1.default.join(projectionsDir, `${name}.json`), { force: true });
                }
            }
        },
        async projectionSweepState() {
            const roots = await listProjectionRoots();
            const out = [];
            for (const name of roots) {
                const file = await readJsonFile(node_path_1.default.join(projectionsDir, `${name}.json`));
                if (!file?.projection || typeof file.projection !== 'object')
                    continue;
                out.push({ rootPinId: file.projection.rootPinId, dirtyKey: String(file.dirtyKey ?? ''), projection: file.projection });
            }
            return out;
        },
        async getProjection(rootPinId) {
            const file = await readJsonFile(projectionFile(rootPinId));
            return file?.projection ?? null;
        },
        async enrichIdentities(projections) {
            const actors = new Set();
            for (const projection of projections) {
                for (const actor of actorsOf(projection))
                    actors.add(actor);
            }
            const identitiesFile = await readIdentities();
            const merged = {};
            for (const metaId of actors) {
                const cached = identitiesFile.identities[metaId];
                if (cached)
                    merged[metaId] = { metaId, name: cached.name, avatar: cached.avatar };
            }
            const missing = Array.from(actors).filter((metaId) => !merged[metaId]);
            if (missing.length > 0 && options.resolveIdentities) {
                try {
                    const resolved = await options.resolveIdentities(missing);
                    const rows = Object.values(resolved).filter((identity) => identity && identity.metaId);
                    for (const identity of rows) {
                        merged[identity.metaId] = identity;
                        identitiesFile.identities[identity.metaId] = {
                            ...identity,
                            source: 'local',
                            resolvedAtMs: Date.now(),
                        };
                    }
                    await writeJsonFileAtomic(node_path_1.default.join(root, 'identities.json'), identitiesFile);
                }
                catch {
                    // identity enrichment is best-effort display sugar; never fail the sweep
                }
            }
            for (const projection of projections) {
                const scoped = {};
                for (const actor of actorsOf(projection)) {
                    if (merged[actor])
                        scoped[actor] = merged[actor];
                }
                projection.identities = scoped;
            }
        },
        async board(localRosterMetaIds) {
            const roster = new Set(localRosterMetaIds.filter(Boolean));
            const rows = await store.projectionSweepState();
            const tasks = [];
            const identities = {};
            const projections = rows
                .map((row) => row.projection)
                .sort((a, b) => (b.lastActivityMs ?? 0) - (a.lastActivityMs ?? 0)
                || (a.rootPinId < b.rootPinId ? -1 : 1));
            for (const projection of projections) {
                const myRoles = [];
                if (roster.has(projection.publisher))
                    myRoles.push('publisher');
                // "Participating" means actual recorded activity — a publisher that
                // only authored the root is not also a participant.
                const mine = (projection.participants ?? []).filter((participant) => roster.has(participant.metaId)
                    && participant.effectiveClaims + participant.submissions + participant.verifiedContrib + participant.reviewVotes > 0);
                if (mine.length > 0)
                    myRoles.push('participant');
                // Mid-task "if it settled now" estimate: it equals the manifest exactly
                // on a completed task, so estShareBP is safe either way — the renderer
                // prefers the settled shareBP when a manifest exists.
                const estimation = (0, estimate_1.estimateMetaTaskShares)(projection);
                const myStats = mine.length
                    ? {
                        claimed: mine.reduce((sum, p) => sum + p.effectiveClaims, 0),
                        submitted: mine.reduce((sum, p) => sum + p.submissions, 0),
                        verified: mine.reduce((sum, p) => sum + p.verifiedContrib, 0),
                        reviewVotes: mine.reduce((sum, p) => sum + p.reviewVotes, 0),
                        shareBP: projection.settlement
                            ? projection.settlement.shares
                                .filter((share) => roster.has(share.metaId))
                                .reduce((sum, share) => sum + share.shareBP, 0)
                            : 0,
                        estShareBP: estimation.shares
                            .filter((share) => roster.has(share.metaId))
                            .reduce((sum, share) => sum + share.shareBP, 0),
                    }
                    : null;
                tasks.push({
                    rootPinId: projection.rootPinId,
                    title: projection.title,
                    brief: projection.brief,
                    publisher: projection.publisher,
                    tags: projection.tags ?? [],
                    mode: projection.policy?.mode === 'competitive' ? 'competitive' : 'tree',
                    taskComplete: projection.taskComplete,
                    progress: projection.progress,
                    participantCount: (projection.participants ?? []).length,
                    lastActivityMs: projection.lastActivityMs ?? 0,
                    freshness: {
                        boundaryBlock: projection.freshness?.boundaryBlock ?? -1,
                        evaluatedAtMs: projection.freshness?.evaluatedAtMs ?? 0,
                        eventCount: projection.freshness?.eventCount ?? 0,
                    },
                    myRoles,
                    myStats,
                    settlementFinalized: Boolean(projection.settlement),
                });
                Object.assign(identities, projection.identities ?? {});
            }
            return {
                localRosterMetaIds: localRosterMetaIds.filter(Boolean),
                tasks,
                identities,
                alerts: await store.listAlerts(),
                activation: { hAct2: constants_1.H_ACT2, hAct3: constants_1.H_ACT3 },
                refresh: await store.refreshInfo(),
            };
        },
        async getWatchStatuses() {
            const file = (await readJsonFile(node_path_1.default.join(root, 'watch-state.json'))) ?? { entries: [] };
            return file.entries.map((entry) => ({ root: entry.root, node: entry.node, status: entry.status }));
        },
        async setWatchStatuses(entries) {
            const file = (await readJsonFile(node_path_1.default.join(root, 'watch-state.json'))) ?? { entries: [] };
            const byKey = new Map(file.entries.map((entry) => [`${entry.root}\u0000${entry.node}`, entry]));
            const now = Date.now();
            for (const entry of entries) {
                byKey.set(`${entry.root}\u0000${entry.node}`, { ...entry, updatedAtMs: now });
            }
            file.entries = Array.from(byKey.values());
            await writeJsonFileAtomic(node_path_1.default.join(root, 'watch-state.json'), file);
        },
        async appendAlerts(alerts) {
            if (alerts.length === 0)
                return;
            const file = (await readJsonFile(node_path_1.default.join(root, 'alerts.json'))) ?? { alerts: [] };
            file.alerts.push(...alerts);
            await writeJsonFileAtomic(node_path_1.default.join(root, 'alerts.json'), file);
        },
        async pruneAlerts(olderThanMs, nowMs) {
            const file = (await readJsonFile(node_path_1.default.join(root, 'alerts.json'))) ?? { alerts: [] };
            file.alerts = file.alerts.filter((alert) => alert.createdAtMs >= nowMs - olderThanMs);
            await writeJsonFileAtomic(node_path_1.default.join(root, 'alerts.json'), file);
        },
        async listAlerts(limit = 30) {
            const file = (await readJsonFile(node_path_1.default.join(root, 'alerts.json'))) ?? { alerts: [] };
            return file.alerts.slice(-limit).reverse();
        },
        async refreshInfo() {
            const state = await readRefreshState();
            return {
                lastRefreshAtMs: state.lastRefreshAtMs,
                lastOkAtMs: state.lastOkAtMs,
                lastError: state.lastError,
                boundaryBlock: state.boundaryBlock >= 0 ? state.boundaryBlock : null,
                refreshing: state.refreshing,
            };
        },
        async setRefreshing(refreshing) {
            const state = await readRefreshState();
            state.refreshing = refreshing;
            state.lastRefreshAtMs = Date.now();
            await writeJsonFileAtomic(node_path_1.default.join(root, 'refresh-state.json'), state);
        },
        async markRefreshDone(ok, error, boundaryBlock) {
            const state = await readRefreshState();
            if (ok)
                state.lastOkAtMs = Date.now();
            state.lastError = error;
            state.boundaryBlock = boundaryBlock;
            state.refreshing = false;
            await writeJsonFileAtomic(node_path_1.default.join(root, 'refresh-state.json'), state);
        },
        async bumpSeq() {
            const state = await readRefreshState();
            state.seq += 1;
            await writeJsonFileAtomic(node_path_1.default.join(root, 'refresh-state.json'), state);
            return state.seq;
        },
    };
    return store;
}
