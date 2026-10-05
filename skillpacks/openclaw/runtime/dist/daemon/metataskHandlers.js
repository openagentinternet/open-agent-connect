"use strict";
/**
 * MetaTask daemon handler group: owns the system-level projection store
 * (~/.metabot/runtime/metatask — chain truth is global, so the cache is shared
 * across profiles) and the single refresher instance. Read verbs serve the
 * board / task / replay views; `refresh` sweeps the chain (the daemon tick
 * calls it with bypassMinInterval so its own cadence is never deferred by
 * tool-triggered coalescing).
 *
 * All replay logic lives in core/metatask/engine; this file is wiring +
 * input normalization only, mirroring grouptaskHandlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMetaTaskDaemonHandlers = createMetaTaskDaemonHandlers;
const commandResult_1 = require("../core/contracts/commandResult");
const engine_1 = require("../core/metatask/engine/engine");
const estimate_1 = require("../core/metatask/engine/estimate");
const constants_1 = require("../core/metatask/engine/constants");
const drafts_1 = require("../core/metatask/drafts");
const metaIdSearchApi_1 = require("../core/metaid/metaIdSearchApi");
const watch_1 = require("../core/metatask/watch");
const refresher_1 = require("../core/metatask/refresher");
const store_1 = require("../core/metatask/store");
const writer_1 = require("../core/metatask/writer");
const metabotProfileManager_1 = require("../core/bot/metabotProfileManager");
const paths_1 = require("../core/state/paths");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readBool(value) {
    return value === true || value === 'true';
}
/** Compact replay view used by `metabot metatask replay` / the UI chain table. */
function replaySummaryOf(projection) {
    return {
        rootPinId: projection.rootPinId,
        title: projection.title,
        policy: projection.policy,
        nodes: Object.values(projection.nodeStates).map((node) => ({
            id: node.id,
            title: node.title,
            status: node.status,
            disputed: node.disputed,
            holder: node.holder?.claimant ?? null,
            submitter: node.submission?.submitter ?? null,
            passVotes: node.passVotes,
            failVotes: node.failVotes,
            weight: node.weight,
        })),
        progress: projection.progress,
        taskComplete: projection.taskComplete,
        settlement: projection.settlement,
        estimation: projection.settlement ? null : (0, estimate_1.estimateMetaTaskShares)(projection),
        ignoredEvents: projection.ignoredEvents,
        freshness: projection.freshness,
    };
}
/**
 * Build the MetaTask handler group: one system-level store, one refresher
 * (ordinary HTTP callers coalesce to one sweep per 60s), and the local-roster
 * resolver that feeds board myRoles/myStats and display identities.
 */
function createMetaTaskDaemonHandlers(input) {
    const daemonPaths = (0, paths_1.resolveMetabotDaemonPaths)(input.systemHomeDir);
    let profileNames = new Map();
    let rosterIds = [];
    const loadRoster = async () => {
        const profiles = await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => []);
        profileNames = new Map();
        rosterIds = [];
        for (const profile of profiles) {
            if (!profile.globalMetaId)
                continue;
            rosterIds.push(profile.globalMetaId);
            profileNames.set(profile.globalMetaId, profile.name || profile.slug || profile.globalMetaId);
        }
        return rosterIds;
    };
    const store = (0, store_1.createMetaTaskStore)(`${daemonPaths.runtimeRoot}/metatask`, {
        // Local roster first (the manager's profile registry), then the so.metaid.io
        // detail endpoint for the rest; the store throttles the remote tier
        // (6h refresh horizon, 64 per sweep). Failures degrade to the raw metaId.
        resolveIdentities: async (metaIds) => {
            const out = {};
            const remote = [];
            for (const metaId of metaIds) {
                const name = profileNames.get(metaId);
                if (name) {
                    out[metaId] = { metaId, name, avatar: null };
                }
                else {
                    remote.push(metaId);
                }
            }
            await Promise.all(remote.map(async (metaId) => {
                try {
                    const detail = await (0, metaIdSearchApi_1.getMetaIdDetail)(metaId, { timeoutMs: 6_000 });
                    if (detail?.name || detail?.avatarId) {
                        out[metaId] = {
                            metaId,
                            name: detail?.name || null,
                            avatar: detail?.avatarId ? `metafile://${detail.avatarId}` : null,
                        };
                    }
                }
                catch {
                    // unresolved identities display as their raw metaId
                }
            }));
            return out;
        },
    });
    const refresher = new refresher_1.MetaTaskRefresher({
        store: () => store,
        rosterMetaIds: () => rosterIds,
        minIntervalMs: input.minIntervalMs ?? 60_000,
    });
    // The watch heartbeat shares the refresher's store and roster: alerts are
    // display-only rows in the same board payload both UIs read.
    const watcher = new watch_1.MetaTaskWatchService({
        store: () => store,
        rosterMetaIds: async () => {
            await loadRoster();
            return rosterIds;
        },
        onAlerts: (alerts) => {
            input.log?.(`[metatask] ${alerts.length} new alert(s): ${alerts.map((alert) => alert.kind).join(', ')}`);
        },
    });
    // The H_ACT3 write gate reads the boundary block from the same refresh state
    // the board reports; refreshed lazily per write call.
    let activationBoundaryCache = null;
    const syncActivationBoundary = async () => {
        activationBoundaryCache = (await store.refreshInfo()).boundaryBlock;
    };
    /**
     * Resolve the acting profile for a write verb: `from` slug, else the single
     * available on-chain-initialized profile (ambiguous rosters must name one).
     * Returns the signer seams the writer needs.
     */
    const resolveWriteSeams = async (rawInput) => {
        if (!input.createSignerForProfileHome) {
            return {
                ok: false,
                failure: (0, commandResult_1.commandFailed)('not_implemented', 'MetaTask write handlers are not configured (no signer factory).'),
            };
        }
        // Every write reads the CURRENT roster (publish roster decisions and the
        // same-side review check both derive from it).
        await loadRoster();
        const fromSlug = normalizeText(rawInput.from);
        let profile = null;
        if (fromSlug) {
            profile = await (0, metabotProfileManager_1.getMetabotProfile)(input.systemHomeDir, fromSlug).catch(() => null);
            if (!profile) {
                return { ok: false, failure: (0, commandResult_1.commandFailed)('profile_not_found', `MetaBot profile not found: ${fromSlug}`) };
            }
        }
        else {
            const profiles = (await (0, metabotProfileManager_1.listMetabotProfiles)(input.systemHomeDir).catch(() => [])).filter((candidate) => candidate.globalMetaId);
            if (profiles.length !== 1) {
                return {
                    ok: false,
                    failure: (0, commandResult_1.commandFailed)('actor_required', `Pass --from <bot-slug> to pick the acting MetaBot (${profiles.length} local profiles carry a globalMetaId).`),
                };
            }
            profile = profiles[0];
        }
        if (!profile.globalMetaId) {
            return {
                ok: false,
                failure: (0, commandResult_1.commandFailed)('actor_not_on_chain', `MetaBot ${profile.slug} has no globalMetaId yet — it must be initialized on-chain before participating in MetaTasks.`),
            };
        }
        const signer = await input.createSignerForProfileHome(profile.homeDir);
        const writeRequest = (pathValue, payload) => ({
            operation: 'create',
            path: pathValue,
            encryption: '0',
            version: '1.1.0',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            encoding: 'utf-8',
            network: 'mvc',
        });
        const seams = {
            actorGlobalMetaId: profile.globalMetaId,
            localRosterMetaIds: () => rosterIds,
            loadEvents: () => store.loadEvents(),
            getProjection: (rootPinId) => store.getProjection(rootPinId),
            activation: () => ({ hAct3: constants_1.H_ACT3, boundaryBlock: activationBoundaryCache }),
            writeProtocolPin: async (subpath, payload, origin) => {
                input.log?.(`[metatask] write ${subpath} as ${profile?.slug} (${origin})`);
                const write = await signer.writePin(writeRequest(`/protocols/metatask/${subpath}`, payload));
                return { pinId: write.pinId, txids: write.txids, totalCost: write.totalCost };
            },
            writeRawPin: async (protocolPath, payload, origin) => {
                input.log?.(`[metatask] write ${protocolPath} as ${profile?.slug} (${origin})`);
                const write = await signer.writePin(writeRequest(protocolPath, payload));
                return { pinId: write.pinId, txids: write.txids, totalCost: write.totalCost };
            },
            refreshInBackground: (reason) => {
                void refresher.refreshOnce(reason).catch(() => undefined);
            },
        };
        return { ok: true, seams };
    };
    const runWrite = async (rawInput, verb) => {
        try {
            const actor = await resolveWriteSeams(rawInput);
            if (!actor.ok)
                return actor.failure;
            const outcome = await verb(actor.seams);
            if (outcome.ok === false) {
                return (0, commandResult_1.commandFailed)('metatask_refused', outcome.refusal);
            }
            return (0, commandResult_1.commandSuccess)(outcome.data);
        }
        catch (error) {
            return (0, commandResult_1.commandFailed)('metatask_write_failed', error instanceof Error ? error.message : 'MetaTask write failed.');
        }
    };
    const runWatchTick = async () => {
        try {
            await loadRoster();
            await watcher.run(Date.now());
            return (0, commandResult_1.commandSuccess)({ ok: true });
        }
        catch (error) {
            input.log?.(`[metatask] watch tick failed: ${error instanceof Error ? error.message : String(error)}`);
            return (0, commandResult_1.commandFailed)('metatask_watch_failed', error instanceof Error ? error.message : 'MetaTask watch tick failed.');
        }
    };
    return {
        board: async (rawInput) => {
            try {
                await loadRoster();
                if (readBool(rawInput.refresh)) {
                    const result = await refresher.refreshOnce('board-refresh');
                    if (!result.ok) {
                        return (0, commandResult_1.commandFailed)('metatask_refresh_failed', result.error ?? 'MetaTask refresh failed.');
                    }
                }
                return (0, commandResult_1.commandSuccess)(await refresher.board());
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('metatask_board_failed', error instanceof Error ? error.message : 'Failed to read the MetaTask board.');
            }
        },
        task: async (rawInput) => {
            const rootPinId = normalizeText(rawInput.root);
            if (!rootPinId)
                return (0, commandResult_1.commandFailed)('invalid_input', 'A --root task pin id is required.');
            try {
                await loadRoster();
                if (readBool(rawInput.refresh)) {
                    await refresher.refreshOnce('task-refresh');
                }
                const projection = await refresher.detail(rootPinId);
                if (!projection) {
                    return (0, commandResult_1.commandFailed)('metatask_not_found', `No cached projection for task root ${rootPinId}. Run a refresh first.`);
                }
                const openNodes = Object.values(projection.nodeStates)
                    .filter((node) => node.status !== 'verified')
                    .map((node) => ({
                    id: node.id,
                    title: node.title,
                    status: node.status,
                    kind: node.kind,
                    weight: node.weight,
                    deps: node.deps,
                }));
                return (0, commandResult_1.commandSuccess)({
                    ...projection,
                    estimation: projection.settlement ? null : (0, estimate_1.estimateMetaTaskShares)(projection),
                    openNodes,
                });
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('metatask_task_failed', error instanceof Error ? error.message : 'Failed to read the MetaTask projection.');
            }
        },
        replay: async (rawInput) => {
            const rootPinId = normalizeText(rawInput.root);
            if (!rootPinId)
                return (0, commandResult_1.commandFailed)('invalid_input', 'A --root task pin id is required.');
            try {
                const events = await store.loadEvents();
                return (0, commandResult_1.commandSuccess)(replaySummaryOf((0, engine_1.replayMetaTask)(events, { rootPinId })));
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('metatask_replay_failed', error instanceof Error ? error.message : 'Failed to replay the MetaTask event set.');
            }
        },
        refresh: async (rawInput) => {
            try {
                await loadRoster();
                const reason = normalizeText(rawInput.reason) || 'http-refresh';
                const result = await refresher.refreshOnce(reason, {
                    bypassMinInterval: readBool(rawInput.bypassMinInterval),
                });
                if (!result.ok) {
                    return (0, commandResult_1.commandFailed)('metatask_refresh_failed', result.error ?? 'MetaTask refresh failed.');
                }
                return (0, commandResult_1.commandSuccess)(result.board);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('metatask_refresh_failed', error instanceof Error ? error.message : 'MetaTask refresh failed.');
            }
        },
        claim: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.claimMetaTaskNode)(seams, {
                rootPinId: normalizeText(rawInput.root),
                node: normalizeText(rawInput.node),
            }));
        },
        submit: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.submitMetaTaskWork)(seams, {
                rootPinId: normalizeText(rawInput.root),
                node: normalizeText(rawInput.node),
                result: (rawInput.result && typeof rawInput.result === 'object' && !Array.isArray(rawInput.result)
                    ? rawInput.result
                    : {}),
                contentType: normalizeText(rawInput.contentType) || undefined,
                attachment: normalizeText(rawInput.attachment) || undefined,
                claimPinId: normalizeText(rawInput.claimPinId) || undefined,
                childIds: Array.isArray(rawInput.childIds) ? rawInput.childIds.map(String) : undefined,
                parentRefs: (rawInput.parentRefs && typeof rawInput.parentRefs === 'object' && !Array.isArray(rawInput.parentRefs)
                    ? rawInput.parentRefs
                    : undefined),
                supersedePinId: normalizeText(rawInput.supersedePinId) || undefined,
            }));
        },
        verify: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.verifyMetaTaskSubmission)(seams, {
                targetPinId: normalizeText(rawInput.targetPinId),
                verdict: rawInput.verdict === 'fail' ? 'fail' : 'pass',
                method: normalizeText(rawInput.method),
                semanticCheck: normalizeText(rawInput.semanticCheck),
                failReason: normalizeText(rawInput.failReason) || undefined,
                evidence: normalizeText(rawInput.evidence) || undefined,
            }));
        },
        release: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.releaseMetaTaskClaim)(seams, {
                rootPinId: normalizeText(rawInput.root),
                node: normalizeText(rawInput.node),
                claimPinId: normalizeText(rawInput.claimPinId),
            }));
        },
        publish: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.publishMetaTask)(seams, {
                title: normalizeText(rawInput.title) || undefined,
                brief: normalizeText(rawInput.brief) || undefined,
                nodes: Array.isArray(rawInput.nodes) ? rawInput.nodes : undefined,
                spec: (rawInput.spec && typeof rawInput.spec === 'object' && !Array.isArray(rawInput.spec)
                    ? rawInput.spec
                    : undefined),
                policy: (rawInput.policy && typeof rawInput.policy === 'object' && !Array.isArray(rawInput.policy)
                    ? rawInput.policy
                    : undefined),
                tags: Array.isArray(rawInput.tags) ? rawInput.tags.map(String) : undefined,
                allowPreActivation: rawInput.allowPreActivation === true || rawInput.allowPreActivation === 'true',
                draftsFile: normalizeText(rawInput.draftsFile) || undefined,
                taskId: normalizeText(rawInput.taskId) || undefined,
                specPinByKey: (rawInput.specPinByKey && typeof rawInput.specPinByKey === 'object' && !Array.isArray(rawInput.specPinByKey)
                    ? rawInput.specPinByKey
                    : undefined),
            }));
        },
        publishSpec: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.publishMetaTaskSpec)(seams, {
                name: normalizeText(rawInput.name) || undefined,
                lang: normalizeText(rawInput.lang) || undefined,
                entry: normalizeText(rawInput.entry) || undefined,
                script: typeof rawInput.script === 'string' ? rawInput.script : undefined,
                input: rawInput.input,
                output: rawInput.output,
                workspace: (rawInput.workspace && typeof rawInput.workspace === 'object' && !Array.isArray(rawInput.workspace)
                    ? rawInput.workspace
                    : undefined),
                validation: (rawInput.validation && typeof rawInput.validation === 'object' && !Array.isArray(rawInput.validation)
                    ? rawInput.validation
                    : undefined),
                enforceHAct2Validation: rawInput.enforceHAct2Validation === false || rawInput.enforceHAct2Validation === 'false'
                    ? false
                    : undefined,
                draftsFile: normalizeText(rawInput.draftsFile) || undefined,
                specKey: normalizeText(rawInput.specKey) || undefined,
            }));
        },
        amend: (rawInput) => {
            void syncActivationBoundary();
            return runWrite(rawInput, (seams) => (0, writer_1.amendMetaTask)(seams, {
                rootPinId: normalizeText(rawInput.root),
                ops: Array.isArray(rawInput.ops) ? rawInput.ops : [],
            }));
        },
        watch: () => runWatchTick(),
        draft: async (rawInput) => {
            const rootPinId = normalizeText(rawInput.root);
            if (!rootPinId)
                return (0, commandResult_1.commandFailed)('invalid_input', 'A --root task pin id is required.');
            const lang = normalizeText(rawInput.lang) === 'zh' ? 'zh' : 'en';
            try {
                await loadRoster();
                let projection = await refresher.detail(rootPinId);
                if (!projection) {
                    await refresher.refreshOnce('draft-miss');
                    projection = await refresher.detail(rootPinId);
                }
                if (!projection) {
                    return (0, commandResult_1.commandFailed)('metatask_not_found', `No cached projection for task root ${rootPinId}.`);
                }
                const draft = (0, drafts_1.buildParticipateDraft)(projection, { lang });
                return (0, commandResult_1.commandSuccess)(draft);
            }
            catch (error) {
                return (0, commandResult_1.commandFailed)('metatask_draft_failed', error instanceof Error ? error.message : 'Failed to build the participation draft.');
            }
        },
    };
}
